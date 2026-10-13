import { Injectable } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { BookFilter, BookKey, BookOrder, BookRepository, Keyed } from '../../../application/ports/repositories';
import type { AuthorRef, Book, BookPatch, NewBook } from '../../../domain/catalog/catalog';
import { DomainError } from '../../../domain/shared/domain-error';
import { isForeignKeyViolation, isUniqueViolation } from '../pg-errors';
import { bookAuthors, books } from '../schema';
import { toDate, whereAll } from '../sql-helpers';
import { DrizzleRepository } from './base.repository';

interface BookRow extends Record<string, unknown> {
  id: string;
  isbn: string;
  title: string;
  description: string | null;
  published_year: number | null;
  tags: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  authors: AuthorRef[];
  total_copies: number;
  available_copies: number;
}

interface KeyColumns {
  k_title: string;
  k_year: number | null;
  /** float4 rank/similarity as Postgres prints it, so the cursor round-trips exactly. */
  k_score: string | null;
}

/** The full Book representation in one round trip: authors in position order, copy counts as subqueries. */
const BOOK_COLUMNS = sql`
  b.id, b.isbn, b.title, b.description, b.published_year, b.tags, b.version, b.created_at, b.updated_at,
  coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY ba.position, a.name)
              FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = b.id), '[]'::json) AS authors,
  (SELECT count(*)::int FROM copies c WHERE c.book_id = b.id) AS total_copies,
  (SELECT count(*)::int FROM copies c WHERE c.book_id = b.id AND c.status = 'AVAILABLE') AS available_copies`;

/**
 * How each list order is computed. `keyColumns` always yields k_title, k_year and k_score so that one
 * outer query fits all orders. Orders and keysets reference those columns, never OFFSET.
 */
interface OrderSpec {
  readonly keyColumns: SQL;
  readonly from: SQL;
  readonly match: SQL | null;
  readonly orderBy: (prefix: '' | 'page.') => SQL;
  readonly keyset: (after: BookKey) => SQL;
}

const scoreKeyset = (after: BookKey): SQL => {
  if (after.kind !== 'fts' && after.kind !== 'trgm') {
    throw new Error('Cursor kind does not match the search order');
  }
  const score = after.kind === 'fts' ? after.rank : after.score;
  // score DESC, id DESC (SPEC Decisions 16): both descend, so one row comparison does it.
  return sql`(k_score, id) < (${score}::real, ${after.id}::uuid)`;
};

function orderSpec(order: BookOrder): OrderSpec {
  switch (order.kind) {
    case 'title':
      return {
        keyColumns: sql`lower(b.title) AS k_title, NULL::int AS k_year, NULL::real AS k_score`,
        from: sql``,
        match: null,
        orderBy: (p) => sql.raw(`${p}k_title, ${p}id`),
        keyset: (after) => {
          if (after.kind !== 'title') throw new Error('Cursor kind does not match the title order');
          return sql`(k_title, id) > (${after.title}, ${after.id}::uuid)`;
        },
      };
    case 'year':
      return {
        // Books without a year sort last via -1; the id tie-breaker descends too, so one row comparison works.
        keyColumns: sql`lower(b.title) AS k_title, coalesce(b.published_year, -1) AS k_year, NULL::real AS k_score`,
        from: sql``,
        match: null,
        orderBy: (p) => sql.raw(`${p}k_year DESC, ${p}id DESC`),
        keyset: (after) => {
          if (after.kind !== 'year') throw new Error('Cursor kind does not match the year order');
          return sql`(k_year, id) < (${after.year}, ${after.id}::uuid)`;
        },
      };
    case 'fts':
      return {
        keyColumns: sql`lower(b.title) AS k_title, NULL::int AS k_year, ts_rank(b.search, query) AS k_score`,
        from: sql`, websearch_to_tsquery('simple', ${order.q}) AS query`,
        match: sql`b.search @@ query`,
        orderBy: (p) => sql.raw(`${p}k_score DESC, ${p}id DESC`),
        keyset: scoreKeyset,
      };
    case 'trgm':
      return {
        keyColumns: sql`lower(b.title) AS k_title, NULL::int AS k_year, similarity(b.title, ${order.q}) AS k_score`,
        from: sql``,
        match: sql`b.title % ${order.q}`,
        orderBy: (p) => sql.raw(`${p}k_score DESC, ${p}id DESC`),
        keyset: scoreKeyset,
      };
  }
}

function filterConditions(filter: BookFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.authorId !== undefined) {
    conditions.push(sql`EXISTS (SELECT 1 FROM book_authors fa WHERE fa.book_id = b.id AND fa.author_id = ${filter.authorId}::uuid)`);
  }
  if (filter.tag !== undefined) {
    conditions.push(sql`b.tags @> ARRAY[${filter.tag}]::text[]`); // served by the GIN index on tags
  }
  if (filter.available !== undefined) {
    const exists = sql`EXISTS (SELECT 1 FROM copies fc WHERE fc.book_id = b.id AND fc.status = 'AVAILABLE')`;
    conditions.push(filter.available ? exists : sql`NOT ${exists}`);
  }
  return conditions;
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    description: row.description,
    publishedYear: row.published_year,
    authors: row.authors,
    tags: row.tags,
    totalCopies: row.total_copies,
    availableCopies: row.available_copies,
    version: row.version,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toKey(order: BookOrder, row: BookRow & KeyColumns): BookKey {
  switch (order.kind) {
    case 'title':
      return { kind: 'title', title: row.k_title, id: row.id };
    case 'year':
      return { kind: 'year', year: row.k_year ?? -1, id: row.id };
    case 'fts':
      return { kind: 'fts', rank: row.k_score ?? '0', id: row.id };
    case 'trgm':
      return { kind: 'trgm', score: row.k_score ?? '0', id: row.id };
  }
}

@Injectable()
export class DrizzleBookRepository extends DrizzleRepository implements BookRepository {
  async findPage(filter: BookFilter, order: BookOrder, after: BookKey | null, limit: number): Promise<Keyed<Book, BookKey>[]> {
    const spec = orderSpec(order);
    const conditions = filterConditions(filter);
    if (spec.match) {
      conditions.push(spec.match);
    }
    // The CTEs are inlined by Postgres (each is referenced once), so the keyset condition and ORDER BY can
    // use the (lower(title), id) / (published_year, id) indexes; the expensive book columns are computed
    // only for the rows of the page.
    const result = await this.db.execute<BookRow & KeyColumns>(sql`
      WITH candidates AS (
        SELECT b.id, ${spec.keyColumns} FROM books b ${spec.from} WHERE ${whereAll(conditions)}
      ), page AS (
        SELECT * FROM candidates WHERE ${after ? spec.keyset(after) : sql`TRUE`} ORDER BY ${spec.orderBy('')} LIMIT ${limit}
      )
      SELECT ${BOOK_COLUMNS}, page.k_title, page.k_year, page.k_score::text AS k_score
        FROM page JOIN books b ON b.id = page.id
       ORDER BY ${spec.orderBy('page.')}`);
    return result.rows.map((row) => ({ item: toBook(row), key: toKey(order, row) }));
  }

  async findById(id: string): Promise<Book | null> {
    const result = await this.db.execute<BookRow>(sql`SELECT ${BOOK_COLUMNS} FROM books b WHERE b.id = ${id}::uuid`);
    const row = result.rows[0];
    return row ? toBook(row) : null;
  }

  async exists(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: books.id }).from(books).where(eq(books.id, id));
    return rows.length > 0;
  }

  async lockForUpdate(id: string): Promise<{ version: number } | null> {
    const [row] = await this.db.select({ version: books.version }).from(books).where(eq(books.id, id)).for('update');
    return row ?? null;
  }

  async lockQueue(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: books.id }).from(books).where(eq(books.id, id)).for('no key update');
    return rows.length > 0;
  }

  async insert(book: NewBook): Promise<string> {
    try {
      const [row] = await this.db
        .insert(books)
        .values({
          isbn: book.isbn,
          title: book.title,
          description: book.description,
          publishedYear: book.publishedYear,
          tags: [...book.tags],
        })
        .returning({ id: books.id });
      if (!row) {
        throw new Error('INSERT … RETURNING returned no row');
      }
      await this.replaceAuthors(row.id, book.authorIds);
      return row.id;
    } catch (error) {
      if (isUniqueViolation(error, 'books_isbn_key')) {
        throw new DomainError('duplicate', `A book with ISBN ${book.isbn} already exists.`);
      }
      throw error;
    }
  }

  async update(id: string, patch: BookPatch): Promise<void> {
    await this.db
      .update(books)
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.publishedYear !== undefined && { publishedYear: patch.publishedYear }),
        ...(patch.tags !== undefined && { tags: [...patch.tags] }),
        version: sql`${books.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(books.id, id));
    if (patch.authorIds !== undefined) {
      await this.db.delete(bookAuthors).where(eq(bookAuthors.bookId, id));
      await this.replaceAuthors(id, patch.authorIds);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.delete(books).where(eq(books.id, id));
    } catch (error) {
      // Backstop for the check in BookCatalog.delete: loans reference books and copies without ON DELETE.
      if (isForeignKeyViolation(error)) {
        throw new DomainError('book-has-loan-history', 'The book has loan history and cannot be deleted.');
      }
      throw error;
    }
  }

  private async replaceAuthors(bookId: string, authorIds: readonly string[]): Promise<void> {
    if (authorIds.length > 0) {
      await this.db.insert(bookAuthors).values(authorIds.map((authorId, index) => ({ bookId, authorId, position: index + 1 })));
    }
  }
}
