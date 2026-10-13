# ADR 0005: Pessimistic row locks and SKIP LOCKED for lending

- Status: accepted
- Date: 2026-10-13

## Context

Lending is the contended part of the system:

- Two members can try to borrow the last copy of a book at the same moment.
- One member can fire several borrows at once (double click, retries), which could exceed their loan limit if
  each request counts open loans before any of them has inserted one.
- The background worker runs on every instance and must not process the same row twice.

## Decision

Use Postgres row locks inside short READ COMMITTED transactions:

- **Member limit:** `SELECT … FROM members WHERE id = ? FOR UPDATE` before counting open loans. One member's
  borrows run one after another; different members never block each other.
- **Choosing a copy:** `SELECT id FROM copies WHERE book_id = ? AND status = 'AVAILABLE'
  FOR UPDATE SKIP LOCKED LIMIT 1`. A concurrent borrower skips the copy that is already being lent and takes the
  next one, without waiting. No copy left means 409 `no-copy-available`.
- **Returns and the reservation queue:** returns, reservation creation and cancellation and the expiry job lock
  the book row first (`SELECT … FROM books WHERE id = ? FOR UPDATE`), so "hold the copy for the next in line or
  make it AVAILABLE" and "may this member reserve?" are never decided concurrently for one book. Then the loan or
  reservation, then the copy. Borrowing does not take this lock.
- **Worker jobs:** claim rows with `FOR UPDATE SKIP LOCKED`, so several instances share the work without a
  leader.
- **Safety net:** a unique partial index allows only one open loan per copy, so even a locking bug cannot lend
  one copy twice; it would surface as an error instead of corrupt data.

Book edits use optimistic locking (a `version` column and ETags) instead, because they are rare and a human can
resolve a conflict.

## Consequences

- Correct under concurrency without SERIALIZABLE isolation and retry loops. The shared suite proves it: 10
  parallel borrows of a book with 2 copies give exactly 2 loans with different copies.
- Locks are held for milliseconds (a few indexed statements), so throughput stays high.
- Every multi-row write path must follow the same lock order to avoid deadlocks. This is documented in
  `docs/architecture.md` and has to be kept in code review.

## Alternatives considered

- **SERIALIZABLE isolation:** correct, but every conflict becomes a serialization failure the code must retry,
  and hot books would retry a lot.
- **Optimistic locking on copies** (`UPDATE copies SET status = 'ON_LOAN' WHERE id = ? AND status = 'AVAILABLE'`):
  works, but under contention most borrowers pick the same copy and fail; SKIP LOCKED spreads them over the
  copies instead.
- **Redis or advisory locks:** an extra moving part, and the lock would not be part of the database transaction.
