import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Keyed, LoanFilter, LoanKey, LoanRepository } from '../../../application/ports/repositories';
import type { Loan, LoanDetails, LoanStatus } from '../../../domain/lending/loan';
import { books, copies, loans } from '../schema';
import { microsText, toDate, toNullableDate } from '../sql-helpers';
import { DrizzleRepository } from './base.repository';

const LOAN = {
  id: loans.id,
  bookId: loans.bookId,
  copyId: loans.copyId,
  memberId: loans.memberId,
  borrowedAt: loans.borrowedAt,
  dueAt: loans.dueAt,
  returnedAt: loans.returnedAt,
  feeCents: loans.feeCents,
};

const DETAILS = { ...LOAN, bookTitle: books.title, bookIsbn: books.isbn, barcode: copies.barcode };

type DetailsRow = Loan & { bookTitle: string; bookIsbn: string; barcode: string };

function toDetails({ bookTitle, bookIsbn, barcode, ...loan }: DetailsRow): LoanDetails {
  return { ...loan, book: { id: loan.bookId, title: bookTitle, isbn: bookIsbn }, copy: { id: loan.copyId, barcode } };
}

/** Status is derived from returned_at and due_at, so filtering by it is a WHERE clause, not a post-filter. */
function statusCondition(status: LoanStatus, now: Date): SQL | undefined {
  switch (status) {
    case 'RETURNED':
      return isNotNull(loans.returnedAt);
    case 'OVERDUE':
      return and(isNull(loans.returnedAt), lt(loans.dueAt, now));
    case 'ACTIVE':
      return and(isNull(loans.returnedAt), gte(loans.dueAt, now));
  }
}

interface ClaimedLoanRow extends Record<string, unknown> {
  id: string;
  book_id: string;
  copy_id: string;
  member_id: string;
  borrowed_at: Date | string;
  due_at: Date | string;
  returned_at: Date | string | null;
  fee_cents: number | null;
}

@Injectable()
export class DrizzleLoanRepository extends DrizzleRepository implements LoanRepository {
  async countOpenByMember(memberId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(loans)
      .where(and(eq(loans.memberId, memberId), isNull(loans.returnedAt)));
    return row?.count ?? 0;
  }

  async existsForBook(bookId: string): Promise<boolean> {
    const rows = await this.db.select({ id: loans.id }).from(loans).where(eq(loans.bookId, bookId)).limit(1);
    return rows.length > 0;
  }

  async insert(loan: Omit<Loan, 'id' | 'returnedAt' | 'feeCents'>): Promise<string> {
    const [row] = await this.db.insert(loans).values(loan).returning({ id: loans.id });
    if (!row) {
      throw new Error('INSERT … RETURNING returned no row');
    }
    return row.id;
  }

  async findDetails(id: string): Promise<LoanDetails | null> {
    const [row] = await this.db
      .select(DETAILS)
      .from(loans)
      .innerJoin(books, eq(books.id, loans.bookId))
      .innerJoin(copies, eq(copies.id, loans.copyId))
      .where(eq(loans.id, id));
    return row ? toDetails(row) : null;
  }

  async findById(id: string): Promise<Loan | null> {
    const [row] = await this.db.select(LOAN).from(loans).where(eq(loans.id, id));
    return row ?? null;
  }

  async lockById(id: string): Promise<Loan | null> {
    const [row] = await this.db.select(LOAN).from(loans).where(eq(loans.id, id)).for('update');
    return row ?? null;
  }

  async markReturned(id: string, returnedAt: Date, feeCents: number | null): Promise<void> {
    await this.db.update(loans).set({ returnedAt, feeCents }).where(eq(loans.id, id));
  }

  async findPage(filter: LoanFilter, now: Date, after: LoanKey | null, limit: number): Promise<Keyed<LoanDetails, LoanKey>[]> {
    const conditions: (SQL | undefined)[] = [
      filter.memberId === undefined ? undefined : eq(loans.memberId, filter.memberId),
      filter.status === undefined ? undefined : statusCondition(filter.status, now),
      // borrowed_at DESC, id DESC: both descend, so the keyset is one row comparison.
      after === null ? undefined : sql`(${loans.borrowedAt}, ${loans.id}) < (${after.borrowedAt}::timestamptz, ${after.id}::uuid)`,
    ];
    const rows = await this.db
      .select({ ...DETAILS, key: microsText(sql`${loans.borrowedAt}`).mapWith(String) })
      .from(loans)
      .innerJoin(books, eq(books.id, loans.bookId))
      .innerJoin(copies, eq(copies.id, loans.copyId))
      .where(and(...conditions))
      .orderBy(desc(loans.borrowedAt), desc(loans.id))
      .limit(limit);
    return rows.map(({ key, ...row }) => ({ item: toDetails(row), key: { borrowedAt: key, id: row.id } }));
  }

  async claimOverdue(now: Date, limit: number): Promise<Loan[]> {
    const at = now.toISOString();
    const result = await this.db.execute<ClaimedLoanRow>(sql`
      UPDATE loans l SET overdue_notified_at = ${at}::timestamptz
        FROM (SELECT id FROM loans
               WHERE returned_at IS NULL AND due_at < ${at}::timestamptz AND overdue_notified_at IS NULL
               ORDER BY due_at
               LIMIT ${limit}
                 FOR UPDATE SKIP LOCKED) due
       WHERE l.id = due.id
      RETURNING l.id, l.book_id, l.copy_id, l.member_id, l.borrowed_at, l.due_at, l.returned_at, l.fee_cents`);
    return result.rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      copyId: row.copy_id,
      memberId: row.member_id,
      borrowedAt: toDate(row.borrowed_at),
      dueAt: toDate(row.due_at),
      returnedAt: toNullableDate(row.returned_at),
      feeCents: row.fee_cents,
    }));
  }
}
