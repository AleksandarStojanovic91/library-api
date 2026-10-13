import { Inject, Injectable } from '@nestjs/common';
import { blocksBookDeletion, type Book, type BookPatch, type NewBook } from '../../domain/catalog/catalog';
import { isValidIsbn13 } from '../../domain/catalog/isbn';
import { DomainError } from '../../domain/shared/domain-error';
import {
  decodeCursor,
  decodeCursorVariant,
  encodeCursor,
  isDecimalText,
  isInteger,
  isLiteral,
  isString,
  isUuid,
} from '../../domain/shared/cursor';
import type { Page } from '../../domain/shared/page';
import type { AuthorRepository, BookFilter, BookKey, BookOrder, BookRepository, CopyRepository, LoanRepository } from '../ports/repositories';
import type { BookCache } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { toPage } from '../shared/pagination';

export type BookSort = 'title' | '-publishedYear';

export interface ListBooksQuery extends BookFilter {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly q?: string | undefined;
  readonly sort: BookSort;
}

/** Version precondition from If-Match: a list of acceptable versions, or '*' for "any existing version". */
export type ExpectedVersion = readonly number[] | '*';

const MIN_TRIGRAM_QUERY_LENGTH = 3;

@Injectable()
export class BookCatalog {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.AuthorRepository) private readonly authors: AuthorRepository,
    @Inject(TOKENS.CopyRepository) private readonly copies: CopyRepository,
    @Inject(TOKENS.LoanRepository) private readonly loans: LoanRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
  ) {}

  async list(query: ListBooksQuery): Promise<Page<Book>> {
    const filter: BookFilter = { authorId: query.authorId, tag: query.tag, available: query.available };
    const q = query.q?.trim();
    if (q) {
      return this.search(q, filter, query);
    }
    const order: BookOrder = query.sort === '-publishedYear' ? { kind: 'year' } : { kind: 'title' };
    const after = query.cursor === undefined ? null : decodeSortCursor(order.kind, query.cursor);
    const rows = await this.books.findPage(filter, order, after, query.limit + 1);
    return toPage(rows, query.limit, encodeBookKey);
  }

  /**
   * Full-text search ranked by relevance; only when it finds nothing does a typo-tolerant trigram search on
   * the title run. The cursor remembers which of the two produced the first page.
   */
  private async search(q: string, filter: BookFilter, query: ListBooksQuery): Promise<Page<Book>> {
    if (query.cursor !== undefined) {
      const after = decodeSearchCursor(query.cursor);
      const order: BookOrder = after.kind === 'fts' ? { kind: 'fts', q } : { kind: 'trgm', q };
      return toPage(await this.books.findPage(filter, order, after, query.limit + 1), query.limit, encodeBookKey);
    }
    let rows = await this.books.findPage(filter, { kind: 'fts', q }, null, query.limit + 1);
    if (rows.length === 0 && q.length >= MIN_TRIGRAM_QUERY_LENGTH) {
      rows = await this.books.findPage(filter, { kind: 'trgm', q }, null, query.limit + 1);
    }
    return toPage(rows, query.limit, encodeBookKey);
  }

  /** Cache-aside read; `cache` tells the caller whether Redis served it (X-Cache). */
  async get(id: string): Promise<{ book: Book; cache: 'HIT' | 'MISS' }> {
    const cached = await this.cache.get(id);
    if (cached) {
      return { book: cached, cache: 'HIT' };
    }
    const book = await this.books.findById(id);
    if (!book) {
      throw DomainError.notFound('Book');
    }
    await this.cache.put(book);
    return { book, cache: 'MISS' };
  }

  async create(input: NewBook): Promise<Book> {
    assertValidIsbn(input.isbn);
    return this.tx.run(async () => {
      await this.assertAuthorsExist(input.authorIds);
      const id = await this.books.insert(input);
      return this.mustFind(id);
    });
  }

  async update(id: string, patch: BookPatch, expected: ExpectedVersion): Promise<Book> {
    return this.tx.run(async () => {
      const current = await this.books.lockForUpdate(id);
      if (!current) {
        throw DomainError.notFound('Book');
      }
      if (expected !== '*' && !expected.includes(current.version)) {
        throw new DomainError('precondition-failed', `The book was changed by someone else; its current ETag is "${current.version}".`);
      }
      if (patch.authorIds) {
        await this.assertAuthorsExist(patch.authorIds);
      }
      await this.books.update(id, patch);
      this.tx.afterCommit(() => this.cache.evict(id));
      return this.mustFind(id);
    });
  }

  async delete(id: string): Promise<void> {
    await this.tx.run(async () => {
      // FOR UPDATE on the book waits for in-flight borrows (their loan insert holds a KEY SHARE lock on it).
      if (!(await this.books.lockForUpdate(id))) {
        throw DomainError.notFound('Book');
      }
      const statuses = await this.copies.lockAllOfBook(id);
      if (statuses.some(blocksBookDeletion)) {
        throw new DomainError('book-has-active-loans', 'The book has copies on loan or held for a reservation.');
      }
      // Lending history is kept, so a book that was ever lent stays (SPEC, Decisions 1).
      if (await this.loans.existsForBook(id)) {
        throw new DomainError('book-has-loan-history', 'The book has loan history and cannot be deleted.');
      }
      await this.books.delete(id);
      this.tx.afterCommit(() => this.cache.evict(id));
    });
  }

  private async assertAuthorsExist(authorIds: readonly string[]): Promise<void> {
    const missing = await this.authors.findMissingIds(authorIds);
    if (missing.length > 0) {
      throw DomainError.validation([{ field: 'authorIds', message: `Unknown author id(s): ${missing.join(', ')}` }]);
    }
  }

  private async mustFind(id: string): Promise<Book> {
    const book = await this.books.findById(id);
    if (!book) {
      throw new Error(`Book ${id} vanished inside its own transaction`);
    }
    return book;
  }
}

function assertValidIsbn(isbn: string): void {
  if (!isValidIsbn13(isbn)) {
    throw DomainError.validation([{ field: 'isbn', message: 'Must be an ISBN-13 with a valid check digit' }]);
  }
}

// ---- cursor shapes ------------------------------------------------------------------------------------------

type TitleCursor = { t: string; id: string };
type YearCursor = { y: number; id: string };
type FtsCursor = { m: 'fts'; r: string; id: string };
type TrgmCursor = { m: 'trgm'; s: string; id: string };

function encodeBookKey(key: BookKey): string {
  switch (key.kind) {
    case 'title':
      return encodeCursor({ t: key.title, id: key.id } satisfies TitleCursor);
    case 'year':
      return encodeCursor({ y: key.year, id: key.id } satisfies YearCursor);
    case 'fts':
      return encodeCursor({ m: 'fts', r: key.rank, id: key.id } satisfies FtsCursor);
    case 'trgm':
      return encodeCursor({ m: 'trgm', s: key.score, id: key.id } satisfies TrgmCursor);
  }
}

function decodeSortCursor(kind: 'title' | 'year', cursor: string): BookKey {
  if (kind === 'title') {
    const { t, id } = decodeCursor<TitleCursor>(cursor, { t: isString, id: isUuid });
    return { kind, title: t, id };
  }
  const { y, id } = decodeCursor<YearCursor>(cursor, { y: isInteger, id: isUuid });
  return { kind, year: y, id };
}

function decodeSearchCursor(cursor: string): Extract<BookKey, { kind: 'fts' | 'trgm' }> {
  const decoded = decodeCursorVariant<FtsCursor | TrgmCursor>(cursor, [
    { m: isLiteral('fts'), r: isDecimalText, id: isUuid },
    { m: isLiteral('trgm'), s: isDecimalText, id: isUuid },
  ]);
  return decoded.m === 'fts'
    ? { kind: 'fts', rank: decoded.r, id: decoded.id }
    : { kind: 'trgm', score: decoded.s, id: decoded.id };
}
