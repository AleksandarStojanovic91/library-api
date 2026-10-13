import type { Author, Book, BookPatch, Copy, CopyStatus, NewBook } from '../../domain/catalog/catalog';
import type { LendingEvent } from '../../domain/lending/events';
import type { Loan, LoanDetails, LoanStatus } from '../../domain/lending/loan';
import type { Reservation } from '../../domain/lending/reservation';
import type { Member, MemberStatusChange, MemberWithLoans, NewMember } from '../../domain/members/member';

/** Keyset position for lists ordered by `created_at, id`. Timestamps keep Postgres' microsecond text form. */
export interface CreatedKey {
  readonly createdAt: string;
  readonly id: string;
}

export interface Keyed<T, K> {
  readonly item: T;
  readonly key: K;
}

// ---- catalog --------------------------------------------------------------------------------------------

export type BookOrder =
  | { readonly kind: 'title' }
  | { readonly kind: 'year' }
  | { readonly kind: 'fts'; readonly q: string }
  | { readonly kind: 'trgm'; readonly q: string };

export type BookKey =
  | { readonly kind: 'title'; readonly title: string; readonly id: string }
  | { readonly kind: 'year'; readonly year: number; readonly id: string }
  | { readonly kind: 'fts'; readonly rank: string; readonly id: string }
  | { readonly kind: 'trgm'; readonly score: string; readonly id: string };

export interface BookFilter {
  readonly authorId?: string | undefined;
  readonly tag?: string | undefined;
  readonly available?: boolean | undefined;
}

export interface BookRepository {
  findPage(filter: BookFilter, order: BookOrder, after: BookKey | null, limit: number): Promise<Keyed<Book, BookKey>[]>;
  findById(id: string): Promise<Book | null>;
  exists(id: string): Promise<boolean>;
  /** Locks the book row (FOR UPDATE) and returns its current version, or null if it does not exist. */
  lockForUpdate(id: string): Promise<{ version: number } | null>;
  /**
   * Takes the book's queue lock (FOR NO KEY UPDATE on the book row). Every change to a book's reservation
   * queue holds it, so "is a copy available?" and "who is next in line?" are decided one at a time per book.
   * It does not conflict with the KEY SHARE lock that inserting a loan takes, so borrowing is not blocked.
   */
  lockQueue(id: string): Promise<boolean>;
  /** @throws DomainError `duplicate` when the ISBN exists. */
  insert(book: NewBook): Promise<string>;
  /** Applies the patch and increments the version. */
  update(id: string, patch: BookPatch): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AuthorRepository {
  findPage(after: CreatedKey | null, limit: number): Promise<Keyed<Author, CreatedKey>[]>;
  findById(id: string): Promise<Author | null>;
  insert(author: { name: string; bio: string | null }): Promise<Author>;
  /** Returns the ids from the list that do not exist. */
  findMissingIds(ids: readonly string[]): Promise<string[]>;
}

export interface CopyRepository {
  listByBook(bookId: string): Promise<Copy[]>;
  /** @throws DomainError `duplicate` when the barcode exists. */
  insert(bookId: string, barcode: string): Promise<Copy>;
  /** Locks one AVAILABLE copy with FOR UPDATE SKIP LOCKED; parallel callers get different copies or none. */
  claimAvailable(bookId: string): Promise<Copy | null>;
  lockById(id: string): Promise<Copy | null>;
  setStatus(id: string, status: CopyStatus): Promise<void>;
  hasAvailable(bookId: string): Promise<boolean>;
  /** Locks every copy of the book (FOR UPDATE) and returns their statuses. */
  lockAllOfBook(bookId: string): Promise<CopyStatus[]>;
}

// ---- members --------------------------------------------------------------------------------------------

export interface MemberRepository {
  findCredentials(email: string): Promise<{ member: Member; passwordHash: string } | null>;
  findById(id: string): Promise<MemberWithLoans | null>;
  /** SELECT … FOR UPDATE on the member row: serialises one member's borrows (loan limit check). */
  lockById(id: string): Promise<Member | null>;
  findPage(after: CreatedKey | null, limit: number): Promise<Keyed<MemberWithLoans, CreatedKey>[]>;
  /** @throws DomainError `duplicate` when the e-mail exists (case-insensitive). */
  insert(member: NewMember): Promise<MemberWithLoans>;
  /** Returns false if the member does not exist. */
  updateStatus(id: string, change: MemberStatusChange): Promise<boolean>;
}

// ---- lending --------------------------------------------------------------------------------------------

export interface LoanKey {
  readonly borrowedAt: string;
  readonly id: string;
}

export interface LoanFilter {
  readonly memberId?: string | undefined;
  readonly status?: LoanStatus | undefined;
}

export interface LoanRepository {
  countOpenByMember(memberId: string): Promise<number>;
  /** Whether any loan (open or returned) references the book: loan history is kept, never cascaded. */
  existsForBook(bookId: string): Promise<boolean>;
  insert(loan: Omit<Loan, 'id' | 'returnedAt' | 'feeCents'>): Promise<string>;
  findDetails(id: string): Promise<LoanDetails | null>;
  /** Unlocked read, used to find the book to lock first (lock order: book before loan). */
  findById(id: string): Promise<Loan | null>;
  lockById(id: string): Promise<Loan | null>;
  markReturned(id: string, returnedAt: Date, feeCents: number | null): Promise<void>;
  /** Status filtering happens in SQL against `now`, so OVERDUE pages are exact. */
  findPage(filter: LoanFilter, now: Date, after: LoanKey | null, limit: number): Promise<Keyed<LoanDetails, LoanKey>[]>;
  /** Marks up to `limit` overdue, not yet notified loans as notified (SKIP LOCKED) and returns them. */
  claimOverdue(now: Date, limit: number): Promise<Loan[]>;
}

export interface ReservationFilter {
  readonly memberId?: string | undefined;
  readonly bookId?: string | undefined;
}

export interface ReservationRepository {
  /** The member's READY reservation for the book, locked FOR UPDATE. */
  lockReady(memberId: string, bookId: string): Promise<Reservation | null>;
  hasOpen(memberId: string, bookId: string): Promise<boolean>;
  /**
   * created_at comes from the database clock, not the business clock: queue order must hold across
   * instances even when one of them runs with CLOCK_OFFSET_SECONDS.
   * @throws DomainError `already-reserved` when an open reservation exists.
   */
  insert(memberId: string, bookId: string): Promise<string>;
  findById(id: string): Promise<Reservation | null>;
  lockById(id: string): Promise<Reservation | null>;
  /** Head of the book's FIFO queue, locked FOR UPDATE (callers hold the book's queue lock). */
  lockFirstWaiting(bookId: string): Promise<Reservation | null>;
  markReady(id: string, copyId: string, readyUntil: Date): Promise<void>;
  close(id: string, status: 'FULFILLED' | 'CANCELLED' | 'EXPIRED'): Promise<void>;
  findPage(filter: ReservationFilter, after: CreatedKey | null, limit: number): Promise<Keyed<Reservation, CreatedKey>[]>;
  findExpiredReady(now: Date, limit: number): Promise<Array<{ id: string; bookId: string }>>;
}

export interface OutboxMessage {
  readonly id: number;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

export interface OutboxRepository {
  append(event: LendingEvent): Promise<void>;
  /** Locks up to `limit` unpublished messages, oldest first, with FOR UPDATE SKIP LOCKED. */
  claimUnpublished(limit: number): Promise<OutboxMessage[]>;
  markPublished(id: number): Promise<void>;
  recordFailure(id: number): Promise<void>;
  countUnpublished(): Promise<number>;
}

/** Where published events go. Here a `notifications` table; in production an e-mail service or a broker. */
export interface NotificationSink {
  deliver(message: OutboxMessage): Promise<void>;
}

// ---- idempotency ----------------------------------------------------------------------------------------

export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface IdempotencyRecord {
  readonly requestHash: string;
  readonly response: StoredResponse | null;
}

export interface IdempotencyRepository {
  /**
   * INSERT … ON CONFLICT DO NOTHING. Returns false if the key exists. If another transaction inserted the
   * same key and has not committed yet, this blocks until it does: that is how concurrent duplicates wait.
   */
  tryInsert(subject: string, key: string, requestHash: string): Promise<boolean>;
  find(subject: string, key: string): Promise<IdempotencyRecord | null>;
  saveResponse(subject: string, key: string, response: StoredResponse): Promise<void>;
  /**
   * Deletes keys older than the retention, measured on the database clock: key age is an audit fact, and a
   * time-shifted instance sharing the database must not wipe keys the others still replay.
   */
  deleteOlderThan(retentionSeconds: number): Promise<number>;
}
