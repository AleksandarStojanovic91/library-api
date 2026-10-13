# Notes for the maintainer (Java implementation)

**Status after SPEC round 4 (23–27):**
- 23 `RATE_LIMIT_NAMESPACE`: done.
- 25 the 72-byte password limit: done. The DTO allows 72 characters, and the hasher also rejects multi-byte
  passwords over 72 bytes.
- 26 405→404 and 415/406→400: unchanged.
- 27 `Location` headers: unchanged (already as specified).
- 24 metric names (revised): the counter is now `library.loans.borrowed`, exported as
  `library_loans_borrowed_total`. `/metrics` is Micrometer's own Prometheus scrape again; the renaming controller
  is gone.
- Items 2, 3, 5, 7, 8 and 10 below are resolved by rounds 3–4 and kept for history.

Things found while implementing the shared contract and SPEC. The shared files were not changed; each item says what
the Java service does today and what I suggest.

## Bugs or gaps in shared files

1. **Shared suite status.** Against this service, run locally with reports redirected outside the repo:
   - `java` project: 258/258 minus 1 skipped. The earlier failure, the `tags.sort()` mutation in
     `books.spec.ts:33`, was a suite bug and has been fixed by its owner.
   - The `@rate-limit-429` test passes against a 120/min instance.
   - `java-time-travel`: 10/10 with the future instance on the *same* Redis db, but 9/10 with its own db as
     SPEC decision 19 now prescribes (see item 10).

2. **Contract: passwords up to 200 characters, but bcrypt uses only 72 bytes.**
   - Spring Security 7 refuses to hash longer input, which was a 500 before I handled it.
   - Java now answers 400 `validation-failed` on `password` ("must be at most 72 bytes (bcrypt limit)") instead of
     silently truncating.
   - Suggested fix: lower `maxLength` in `MemberCreate.password` (72 ASCII characters), or document pre-hashing.

3. **Book row lock strength.** Resolved by SPEC decision 15 (`FOR NO KEY UPDATE`), which Java already used. The
   member row lock for borrows uses `FOR NO KEY UPDATE` for the same reason: notifications and loans reference the
   member through foreign keys.

4. **The lock order in decision 14 and "re-read the loan after the book" overlap.**
   - A return locks book → loan → (next reservation, SKIP LOCKED) → copy. The loan is therefore not last, as the
     order list suggests.
   - This is deadlock-free because nothing else locks an existing loan before a book.
   - Suggested fix: state the order as "book → the row you started from → everything else".

5. **`library_loans_created_total` could not be produced by Prometheus client_java 1.x**, which reserves the
   `_created` suffix. Resolved by revised decision 24 (`library_loans_borrowed_total`).

6. **`info.license` has neither `identifier` nor `url`.**
   - OpenAPI 3.1 allows that, but swagger-parser (used by openapi-generator) rejects the document unless validation
     is skipped.
   - Suggested fix: add `identifier: MIT`.

7. **No problem code for 405 / 406 / 415.** Every code is pinned to one status, so, like the TypeScript service:
   - 405 is answered as 404 `not-found`, with an `Allow` header;
   - 406 and 415 are answered as 400 `validation-failed`.

   Dedicated codes would let both services keep the real statuses.

8. **Two `Location` headers point at routes without a GET.**
   - A created copy gets `/api/v1/books/{bookId}/copies/{copyId}`.
   - A created reservation gets `/api/v1/reservations/{id}`.
   - Suggested fix: add `GET` for both, or document that `Location` is an identifier, not a fetchable URL.

9. **`api-tests` fixme vs SPEC on deleting a book that only has returned loans.**
   - The `test.fixme` expects 204; SPEC decision 1 says 409 `book-has-loan-history`. Java follows SPEC.
   - `STATUS_BY_CODE` in `spec-invariants.ts` has no entry for `book-has-loan-history`.

10. **Decision 19 (own Redis db for time-travel instances) contradicts one time-travel test.**
    - In `reservation-expiry.spec.ts:42`, the last assertion expects the *present* instance's cached book
      (`availableCopies: 0`) to be evicted when the *future* instance's worker expires the hold.
    - With separate Redis dbs, the future worker can only evict the key in its own db. The present instance keeps
      serving its cached copy until the 60 s TTL runs out, so the test fails for any implementation that follows
      SPEC.
    - Options:
      - keep one shared db and separate only the rate-limit keys, e.g. a key prefix per instance;
      - give the present instance a short `GET /books/{id}` TTL in the test compose;
      - or drop that one assertion.
    - A real multi-instance deployment shares one Redis, which is the case the eviction logic is built for.

## Behaviour the SPEC leaves open (what Java does)

- **Invalid token on a public route** (e.g. `GET /books` with an expired token): 401, the standard resource-server
  behaviour. No token is fine.
- **Unknown routes are 404 for everyone.** Spring Security lists the protected routes explicitly instead of
  default-deny. `SecurityRoutesIT` walks the contract to prove every secured operation still answers 401 without a
  token.
- **New copies while people are waiting:** a copy added by a librarian becomes AVAILABLE. It is not handed to the
  head of the queue, because only returns, cancellations and expiries hand off.
- **Borrowing with a WAITING reservation:** the member keeps their WAITING reservation for the same book (now SPEC
  decision 21). So do a member's ignored `memberId` filter (decision 20) and "Malformed JSON body" for any non-object
  body (decision 22).
- **Holds past `ready_until`:** an expired-but-not-yet-processed hold is not honoured by a borrow
  (`ready_until > now`). The worker then expires it.
- **Outbox poison messages:** they are retried on every tick and parked after 10 attempts. They stay unpublished and
  are counted in `library_outbox_backlog`, so they show up on dashboards. SPEC says "retry later" without a cap.
- **Health check keys** are `db` and `redis`, the same as the TypeScript service.
- **Idempotent replay bodies** come from a `jsonb` column, so the replayed JSON is equal but its key order may differ
  from the original bytes.
- **Search cursor:** (rank, id), as SPEC decision 16 requires. It also records the search mode, so later pages
  never switch between full-text and trigram.
- **Type errors in request bodies:** Jackson stops at the first value of the wrong JSON type, so only that field is
  reported. Every constraint violation is reported. `authorIds` is bound as strings so a malformed UUID doesn't
  hide the other errors.
- **`RATE_LIMIT` window:** epoch minutes of the business clock. With a `CLOCK_OFFSET_SECONDS` that is not a multiple
  of 60, the windows shift by the remainder; they are still one minute long.

## Repository-level suggestions (outside `java/`)

- Add a root `.dockerignore` (at least `**/node_modules`, `**/target`, `api-tests/test-results`). The Java image
  uses the repo root as build context and currently uploads `api-tests/node_modules`.
- CI can run the Java integration tests either with Docker (Testcontainers, the default) or against service
  containers, by setting `IT_DATABASE_URL` / `IT_REDIS_URL` (see `java/README.md`).
