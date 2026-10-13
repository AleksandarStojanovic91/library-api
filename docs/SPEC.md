# Behaviour spec (both implementations must match)

`contract/openapi.yaml` is the source of truth for paths, schemas and status codes. This file pins down the
behaviour the contract cannot express, so the Java and TypeScript services are interchangeable behind the same
black-box test suite (`api-tests/`).

## Runtime and configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 8081 (Java), 8082 (TS) | HTTP port |
| `DATABASE_URL` | `postgres://library:library@localhost:5432/library_java` (TS: `library_ts`) | PostgreSQL 16 |
| `REDIS_URL` | `redis://localhost:6379` (Java uses db 0, TS db 1) | cache + rate limiter |
| `JWT_SECRET` | `dev-only-secret-change-me-at-least-32-bytes!!` | HS256 key |
| `RATE_LIMIT_PER_MINUTE` | `120` | per client |
| `LOAN_DAYS` | `14` | loan length |
| `FEE_CENTS_PER_DAY` | `50` | overdue fee |
| `RESERVATION_HOLD_HOURS` | `48` | how long a held copy waits |
| `CLOCK_OFFSET_SECONDS` | `0` | test hook: shifts "now" for overdue/expiry logic (see Time) |
| `WORKER_INTERVAL_MS` | `5000` | outbox publisher and scheduled jobs |
| `RATE_LIMIT_NAMESPACE` | `rl` | prefix of the rate-limit keys (`<ns>:{sub or IP}:{epochMinute}`) |

Each implementation uses its own database (`library_java`, `library_ts`) and runs `db/migrations/*.sql` in
filename order on start (Java: Flyway with `filesystem:../db/migrations` or the files copied into the image;
TS: a small runner recording applied files in `schema_migrations`).

## Time

All timestamps are UTC ISO-8601 with `Z` and millisecond precision (`2026-10-13T09:15:00.000Z`).
"Now" for business logic is `server time + CLOCK_OFFSET_SECONDS`, so tests can start a service in the future
to exercise overdue loans and expired reservations. Database defaults (`now()`) are only used for audit columns.

## Auth

- `POST /api/v1/auth/token` checks the bcrypt hash; wrong email or password both give 401 `unauthorized`
  (same message, no user enumeration).
- JWT claims: `sub` = member id, `role` = `MEMBER|LIBRARIAN`, `email`, `iat`, `exp` (+3600 s), `iss` = `library-api`.
- Missing/invalid/expired token on a protected route: 401 with `WWW-Authenticate: Bearer`.
- Public routes: `GET /api/v1/books*`, `GET /api/v1/authors*`, token, health, metrics, `/docs`, `/openapi.yaml`.
- Librarian-only: creating/updating/deleting books, copies, authors, members; listing members.
- A member asking for someone else's member/loan/reservation gets **404** (not 403) to avoid leaking ids.
  403 is used when a member calls a librarian-only route, or passes `memberId` on `POST /loans`.
- `SUSPENDED` members can still log in and read, but cannot borrow or reserve (409 `member-suspended`).

## Errors

Problem `type` is `https://library.example/problems/<code>`, `title` is a fixed human sentence per code, `instance`
is the request path, `requestId` echoes `X-Request-Id`. Validation errors list every failing field
(`field` uses JSON pointer style without the leading slash, e.g. `authorIds.0`). Unknown JSON properties are rejected
(`additionalProperties: false`). Malformed JSON → 400 `validation-failed` with detail `Malformed JSON body`.
Unknown route → 404 `not-found`. Unexpected errors → 500 `internal` without stack traces.

## Pagination

- `limit` 1..100, default 20; anything else is 400.
- Cursor = base64url of a JSON object holding the sort key of the last row plus its `id`
  (e.g. `{"t":"clean code","id":"…"}`); the next page is `WHERE (sortKey, id) > (:t, :id)` (keyset, never OFFSET).
  An unparsable cursor is 400 `validation-failed`. `nextCursor` is `null` when there are no more rows
  (fetch `limit + 1` rows to know).
- Sorts: books `title` → `lower(title), id`; books `-publishedYear` → `published_year DESC NULLS LAST, id`;
  authors and members → `created_at, id`; loans → `borrowed_at DESC, id`; reservations → `created_at, id`.

## Books

- `GET /books?q=` uses `search @@ websearch_to_tsquery('simple', q)` ordered by rank, then title;
  if that finds nothing and `q` has ≥ 3 chars, fall back to trigram similarity on title (`title % q`).
  With `q` the cursor keys on (rank, id); keep it simple and correct.
- `availableCopies` counts copies with status `AVAILABLE` (RESERVED copies are not available).
- ISBN must match the pattern **and** have a valid ISBN-13 check digit (400 otherwise); duplicate ISBN → 409 `duplicate`.
- Unknown `authorIds` → 400 `validation-failed` on `authorIds`.
- ETag = `"<version>"`. `GET` with matching `If-None-Match` → 304. `PATCH` without `If-Match` → 428
  `precondition-required`; wrong version → 412 `precondition-failed`; success increments `version`.
  `PATCH` is JSON merge patch (`null` clears nullable fields; `authorIds` replaces the list).
- `DELETE`: see Decisions 1 (`book-has-active-loans`, then `book-has-loan-history`).
- Duplicate copy barcode → 409 `duplicate`.

## Caching (Redis)

- `GET /api/v1/books/{id}` is cached for 60 s under `book:{id}`; any write to the book, its copies or loans of
  it deletes the key. List endpoints are not cached. A Redis outage must not break reads (fall back to the DB,
  log a warning). Response header `X-Cache: HIT|MISS` on `GET /books/{id}`.

## Loans

`POST /loans` (v1 and v2 share the logic, only the representation differs), in one transaction:

1. Resolve the member (`sub`, or `memberId` for librarians). Not found → 404. Suspended → 409 `member-suspended`.
2. Book must exist → else 404.
3. Count the member's open loans with `SELECT … FOR UPDATE` on the member row (serialises one member's borrows);
   `>= maxActiveLoans` → 409 `loan-limit-reached`.
4. If the member has a READY reservation for this book: take its held copy, mark the reservation FULFILLED.
   Otherwise pick an AVAILABLE copy with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` (two parallel borrows never get
   the same copy and never block each other). None → 409 `no-copy-available` with
   `detail: "No copy of this book is available. You can reserve it with POST /api/v1/reservations."`.
5. Copy → ON_LOAN, insert loan (`due_at = now + LOAN_DAYS`), outbox `loan.created`, evict `book:{id}`.

Idempotency (`Idempotency-Key` required → missing is 400):
- Scope = (token `sub`, key). `request_hash` = sha256 of `METHOD path canonical-json-body`.
- First request: insert the key row (`INSERT … ON CONFLICT DO NOTHING`) **before** doing the work in the same
  transaction; store status/body/headers after. A concurrent duplicate waits on the row lock and then replays.
- Same key + same hash → replay stored status, body and `Location`, plus header `Idempotent-Replayed: true`.
- Same key + different hash → 422 `idempotency-key-reused`. Error responses (4xx) are stored too, 5xx are not.
- Keys older than 24 h are deleted by the scheduled job.

`POST /loans/{id}/return`: already returned → 409 `already-returned`. Sets `returned_at`, computes
`fee_cents = ceil(overdue seconds / 86400) * FEE_CENTS_PER_DAY` (0 → `null`). Then the copy either goes to the
first WAITING reservation for the book (copy RESERVED, reservation READY, `ready_until = now + hold`, outbox
`reservation.ready`) or back to AVAILABLE. Outbox `loan.returned`.

Status: `RETURNED` if returned; `OVERDUE` if open and `now > due_at`; else `ACTIVE`. Filtering `?status=OVERDUE`
must be done in SQL. v2 `overdueDays` = whole days late (0 if not late); `fee` = Money with 2 decimals
(`"1.50"`), computed as if returned now while the loan is open and overdue.

Deprecation (all `/api/v1/loans*` responses, including errors): `Deprecation: @1767225600` (2026-01-01),
`Sunset: Thu, 31 Dec 2026 23:59:59 GMT`, `Link: </api/v2/loans>; rel="successor-version"`.

## Reservations

- Only when the book has no AVAILABLE copy; otherwise 409 `copy-available`.
- One open (WAITING/READY) reservation per member and book → else 409 `already-reserved`.
- Suspended → 409 `member-suspended`.
- `position` = 1 + number of WAITING reservations for the book created before this one (null when not WAITING).
- Cancel: only WAITING or READY (else 409 `reservation-not-cancellable`). Cancelling a READY one passes the held
  copy to the next WAITING reservation, or makes it AVAILABLE.
- Scheduled job: READY with `ready_until < now` → EXPIRED, held copy passed on the same way; outbox `reservation.expired`.

## Background worker (both run it in-process)

Every `WORKER_INTERVAL_MS`:
1. Overdue scan: open loans with `due_at < now` and `overdue_notified_at IS NULL` → outbox `loan.overdue`, set
   `overdue_notified_at` (so each loan notifies once).
2. Expire READY reservations (above).
3. Outbox publisher: up to 100 unpublished rows `FOR UPDATE SKIP LOCKED`, insert a `notifications` row per event
   (`kind` = event type, `member_id` from payload), set `published_at`. Failures bump `attempts` and retry later.
4. Delete idempotency keys older than 24 h.
Multiple instances are safe because every step uses row locks / `SKIP LOCKED`.

## Rate limiting

Fixed window per minute in Redis, key = `rl:{sub or client IP}:{epochMinute}`. Every response sets
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds until the window ends). Over the limit → 429
`rate-limited` with `Retry-After`. Health and metrics are exempt. If Redis is down, allow the request.

## Observability

- JSON logs, one line per request: `method, path (route template), status, durationMs, requestId, memberId`.
- `X-Request-Id`: echo the client's (if 8–100 chars `[A-Za-z0-9-_]`) or generate a UUID; return it on every response.
- `/metrics` (Prometheus): `http_server_requests` (histogram by method, route template, status),
  `library_loans_borrowed_total`, `library_loans_returned_total`, `library_outbox_backlog` (gauge).
- OpenTelemetry tracing, exporting OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; off otherwise.
- `/health/live` always UP; `/health/ready` checks the DB (`SELECT 1`) and Redis (`PING`); 503 if the DB is down
  (Redis down → still 200 with `checks.redis: DOWN`, since the service degrades gracefully).

## API docs

Each service serves the contract at `/openapi.yaml` and Swagger UI at `/docs` (Java may also expose springdoc at
`/swagger-ui`, but `/docs` must show the shared contract).

## Graceful shutdown

On SIGTERM: stop accepting connections, finish in-flight requests (max 20 s), stop the worker, close pools.

## Decisions (answers to docs/OPEN-QUESTIONS.md, 2026-10-13)

1. **Deleting a book**: 409 `book-has-active-loans` if any copy is ON_LOAN or RESERVED; otherwise 409
   `book-has-loan-history` if the book has any past loans (history is kept, never cascaded); otherwise 204.
2. **Suspending members**: new librarian endpoint `PUT /api/v1/members/{memberId}/status`
   (`{"status": "SUSPENDED" | "ACTIVE", "maxActiveLoans"?: 1..10}`) returns the Member. This is how tests create
   a suspended member.
3. **overdueDays** = floor(overdue seconds / 86400) (whole days late). The **fee** uses started days:
   ceil(overdue seconds / 86400) × FEE_CENTS_PER_DAY. Both are 0 / null when not late.
4. **429 and 400**: every operation except `/health/*` and `/metrics` may return 429 `rate-limited`; every list
   endpoint may return 400 (bad `limit`/`cursor`). Both are now in the contract.
5. **Nullable fields are always present**: a field typed `[x, 'null']` is serialised as `null`, never omitted.
6. **Reservation vs return race**: `POST /reservations`, `POST /loans/{id}/return`, `DELETE /reservations/{id}` and
   the reservation-expiry job lock the **book row** (`SELECT … FROM books WHERE id = ? FOR UPDATE`) before deciding
   between "hold for the next reservation" and "make AVAILABLE", and reservation creation re-checks availability
   under that lock. Borrowing keeps `FOR UPDATE SKIP LOCKED` on copies (no book lock), so borrows of different
   copies never block each other.
7. **Problem titles are fixed per code** (both implementations use exactly these strings):

| code | status | title |
|---|---|---|
| validation-failed | 400 | Request validation failed |
| unauthorized | 401 | Authentication required |
| forbidden | 403 | Not allowed |
| not-found | 404 | Resource not found |
| conflict | 409 | Conflict |
| duplicate | 409 | Resource already exists |
| no-copy-available | 409 | No copy available |
| loan-limit-reached | 409 | Loan limit reached |
| member-suspended | 409 | Member is suspended |
| already-returned | 409 | Loan already returned |
| book-has-active-loans | 409 | Book has copies on loan or on hold |
| book-has-loan-history | 409 | Book has loan history |
| already-reserved | 409 | Book already reserved by this member |
| copy-available | 409 | A copy is available, borrow it instead |
| reservation-not-cancellable | 409 | Reservation cannot be cancelled |
| precondition-failed | 412 | Precondition failed |
| precondition-required | 428 | Precondition required |
| idempotency-key-reused | 422 | Idempotency key reused with a different request |
| rate-limited | 429 | Too many requests |
| internal | 500 | Internal server error |

8. **Clock offset** shifts only business time (due dates, overdue, fees, reservation expiry). JWT `iat`/`exp`
   use real time, so a token from one instance works on a time-shifted instance of the same implementation.

## Decisions, round 2 (2026-10-13)

9. **Malformed UUID** in a path or query parameter → 400 `validation-failed` (documented on every operation with an id).
10. **Returning a loan**: the borrower or any librarian may return it; another member gets 404.
11. **overdueDays / fees on returned loans**: for a RETURNED loan, `overdueDays` = floor((returned_at − due_at) / 1 day),
    0 if returned on time, and `fee` is the stored fee. v1 `feeCents` is only set once the loan is returned
    (null while open, even if overdue); v2 `fee` shows the projected fee for open overdue loans.
12. **`available=false`** returns books with zero AVAILABLE copies (including books with no copies at all).
13. **Keyset tie-breaker follows the sort direction**, so a single row comparison works:
    ascending sorts use `id ASC` (`(key, id) > (:k, :id)`), descending sorts use `id DESC` (`(key, id) < (:k, :id)`).
    Books `-publishedYear` sorts on `coalesce(published_year, -1) DESC, id DESC` (books without a year come last).
    Loans: `borrowed_at DESC, id DESC`.
14. **Lock order** (prevents deadlocks): always lock in this order and never the other way round:
    member row → book row → reservation rows → copy rows → loan rows. Operations that start from a reservation or a
    loan first read its `book_id` without a lock, then lock the book, then re-read the reservation/loan `FOR UPDATE`
    and re-check its state.

## Decisions, round 3 (2026-10-13)

15. **Book lock strength**: lock the book row with `FOR NO KEY UPDATE` (not `FOR UPDATE`). It is just as exclusive
    between queue operations but does not conflict with the `FOR KEY SHARE` locks that inserting loans/copies take
    through foreign keys, so borrows are never stalled by it. Both implementations use it.
16. **Search ordering** with `q`: `ts_rank DESC, id DESC`; the cursor holds (rank, id). Trigram fallback:
    `similarity DESC, id DESC`.
17. **ETag scope**: the ETag versions the catalogue record (fields a librarian edits). `totalCopies` and
    `availableCopies` are live counts outside the ETag, so a 304 can be returned while availability changed.
    This is deliberate: lending must not bump the book version (that would need a book lock on every borrow and
    turn unrelated edits into 412s). Clients that need fresh availability read `GET /books/{id}/copies` or list with
    `available=true`. Documented as an ADR.
18. **Closed reservations** keep `heldCopyId: null` (the schema clears it); which copy was used is recorded on the loan.
19. **Test isolation** (revised): the time-travel instances share the main instance's Redis database (so cache
    evictions are seen by both) but use their own rate-limit counters via `RATE_LIMIT_NAMESPACE=rl-future`.
20. A member passing `memberId` on `GET /loans` or `GET /reservations` is not an error: the filter is ignored and they
    get their own records (as the contract's parameter description says).
21. Borrowing an AVAILABLE copy does not touch the member's own WAITING reservation for that book; it stays in the
    queue until they cancel it (simple and predictable; the hold logic only reacts to READY reservations).
22. A JSON body that is not an object (or does not parse) is 400 `validation-failed` with detail `Malformed JSON body`.

## Decisions, round 4 (2026-10-13)

23. `RATE_LIMIT_NAMESPACE` (default `rl`) prefixes rate-limit keys; see 19.
24. Metrics (revised): the loan counters are `library_loans_borrowed_total` and `library_loans_returned_total`.
    (`_created` is a reserved suffix in the Prometheus/OpenMetrics model, so `library_loans_created` would be mangled
    by standard clients; renaming avoids a custom exporter.)
25. Passwords are limited to 72 bytes (bcrypt); longer → 400 `validation-failed`.
26. Unknown method on a known path → 404 `not-found`; unsupported `Content-Type` or `Accept` → 400 `validation-failed`
    (both services; kept simple on purpose, no extra problem codes).
27. `Location` after creating a copy or a reservation names the new resource (`/api/v1/books/{bookId}/copies/{id}`,
    `/api/v1/reservations/{id}`) even though only DELETE exists on the latter and the copy is read through the list;
    RFC 9110 does not require a GET handler for `Location`.
