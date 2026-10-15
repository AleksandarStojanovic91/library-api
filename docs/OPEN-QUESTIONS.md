# Open questions

Contradictions and gaps found in `contract/openapi.yaml`, `docs/SPEC.md` and `db/` while building the shared
parts (test suite, perf, CI, docs). The first round was decided on 2026-10-13 in
**SPEC.md "Decisions"** (referred to below as D1–D8) and in the contract. The test suite follows those answers.

Status: **resolved** (decided; the suite tests it), **open** (still undecided; the suite's current assumption is
given), **note** (nothing to decide).

## Summary

| | Resolved | Open | Note |
|---|---|---|---|
| Contract lint (L) | L1 | L2, L3 (partly), L4 | L5 |
| Contract gaps (C) | C1, C2, C3, C5 | C4 (partly), C6, C7, C8 | |
| SPEC questions (S) | S1, S2, S3, S6, S12, S16 | S4 (partly), S5, S7, S8, S11, S13, S14, S15 | S9, S10, S17–S22 |

## 1. Contract lint (`npx @redocly/cli lint contract/openapi.yaml`, Redocly CLI 2.63.0)

Current result: **valid, 0 errors, 10 warnings** (the CI job passes).

| # | Status | Finding | Resolution / suggestion |
|---|---|---|---|
| L1 | **resolved** | `Money.amount` description: the comma in a YAML flow mapping created a stray key `e.g. "1.50"` (the only error). | fixed in the contract |
| L2 | open (warning) | `tag-description` ×7: tags have no description | add one line each |
| L3 | partly resolved (warning) | `operation-4xx-response`: `GET /api/v1/authors` now has 400 (D4); `/health/live`, `/health/ready`, `/metrics` still have no 4xx (3 warnings) | fine for ops routes; silence with a rule override in `redocly.yaml` if wanted |
| L4 | open (warning) | `info-license-strict`: license needs `url` or `identifier` | `identifier: MIT` |
| L5 | note | `no-server-example.com` ×2: localhost servers | intentional; turned off in `redocly.yaml` |

## 2. Contract gaps

The suite validates every response against the contract. An error status an operation does not list is a
`contract-gap` annotation in the Playwright report (a failure with `CONTRACT_STRICT_STATUS=1`).

| # | Status | Gap | Resolution / suite's assumption |
|---|---|---|---|
| C1 | **resolved** (D4) | 429 was not documented anywhere. | `TooManyRequests` (Problem + `Retry-After`) on every operation except `/health/*` and `/metrics`. Tests: `rate-limit.spec.ts` asserts the 429 is documented and carries `Retry-After`; offline self-tests check the contract. |
| C2 | **resolved** (D4) | 400 for bad `limit`/`cursor` was documented only on `listBooks`. | now on every list endpoint. Tests: `pagination.spec.ts` "400 on every list endpoint" (6 endpoints × 3 bad inputs, each asserted as documented). |
| C3 | **resolved** | A malformed UUID in a path (`GET /api/v1/books/not-a-uuid`): neither contract nor SPEC said 400 or 404. | SPEC "Errors" now states the rule and every operation with a path id lists **400 `validation-failed`**; the suite tests it. |
| C4 | partly resolved | Headers described only in prose. `Retry-After` is now declared on 429. Still undeclared: `X-Request-Id`, `RateLimit-*`, `WWW-Authenticate`, `Idempotent-Replayed`, `X-Cache`. | the suite checks them through the SPEC rules; declaring them in `components.headers` would help generated clients |
| C5 | **resolved** (D5) | Nullable fields could be omitted or `null`. | always present, `null` when empty. The suite treats every `[x, 'null']` property of a response schema as required, so every response checks it; `books.spec.ts` also asserts it on the raw JSON. The contract's `required` lists still omit these fields; adding them would make the contract say what D5 says. |
| C6 | open | `POST /books/{id}/copies` returns `Location`, but there is no single-copy route. | suite only checks Location ends with the copy id |
| C7 | open | `SuccessorLink` example is absolute, SPEC shows a relative `</api/v2/loans>`. | suite accepts both |
| C8 | open | `GET /members/{id}` and `DELETE /reservations/{id}` list 403, but members get 404 for other people's records. | suite expects 404; suggest removing 403 there or saying when it applies |

## 3. SPEC questions

| # | Status | Question | Resolution / suite's assumption |
|---|---|---|---|
| S1 | **resolved** (D1) | Deleting a book with loan history hit a foreign key (500). | 409 `book-has-active-loans` if a copy is ON_LOAN/RESERVED, else 409 `book-has-loan-history` if ever lent, else 204. Tests: `books.spec.ts` (history only; active + history → active wins; on loan; on hold; never lent → 204), error catalogue. The former `fixme` test is gone. |
| S2 | **resolved** (D2) | `member-suspended` could not be triggered. | `PUT /api/v1/members/{memberId}/status`. Tests: `members-status.spec.ts` (librarian only, 403/401/404, validation, limit change; a suspended member can log in, read and return; borrow v1/v2/on behalf and reserve give 409 `member-suspended`, checked before availability; works again after reactivation). |
| S3 | **resolved** (D3) | `overdueDays` rounding. | `overdueDays = floor(overdue s / 86400)`, fee = `ceil(overdue s / 86400) × 50c`. Tests: `tests/time-travel/overdue.spec.ts` computes both from the offset with `Math.floor` / `Math.ceil` (1.5 days late → `1` and `"1.00"` / `100`). |
| S4 | partly resolved (D3) | Not late → `overdueDays 0`, fee `null` (tested). Still unspecified: `overdueDays` of a **returned** late loan (days late at return, or 0?) and v1 `feeCents` of an **open** overdue loan (running fee or `null`?). | not asserted |
| S5 | open | Can a librarian return a member's loan (desk return)? Contract lists 403 on return. | owner returns; other members get 404; librarian return not tested |
| S6 | **resolved** (D7) | Problem titles per code. | exact titles from the D7 table, checked on **every** error response by the API client and explicitly in the error catalogue; an offline test checks the table covers exactly the contract's code enum. |
| S7 | open | SPEC calls the validation `field` format "JSON pointer style" but the example uses dots (`authorIds.0`). | dot notation: `authorIds.0`, `tags.1` |
| S8 | open | The generic keyset predicate `(sortKey, id) > (:t, :id)` does not fit `published_year DESC NULLS LAST, id` or `borrowed_at DESC, id`. Is `id` ascending there? | id ascending (matches `ix_books_year`); suite checks order and no duplicates/gaps across the NULL boundary |
| S9 | note | Search cursor on `(rank, id)`: `ts_rank` is float4; serialising it with less precision than Postgres compares can repeat or skip rows. | suite pages through 5 equally ranked results; suggest rounding rank in ORDER BY and cursor |
| S10 | note | Trigram fallback threshold and ordering are not specified. | suite checks a one-letter typo of a 14-letter title is found, and that the fallback is skipped when full text matches |
| S11 | open | `available=false`: no filter, or only books with no AVAILABLE copy? | only `available=true` tested |
| S12 | **resolved** (D6) | Reserve vs return race (lost wake-up). | return, reserve, cancel and expiry lock the book row; borrowing keeps SKIP LOCKED on copies. Test: `concurrency.spec.ts` (never a WAITING reservation next to an AVAILABLE copy). See the lock-order note in section 4. |
| S13 | open | Order of checks: 401 before 400; 403 (role) before 404/400 on librarian-only routes. | the suite sends valid bodies where it tests 401/403, so it only relies on auth coming before business lookups |
| S14 | open | Idempotency-Key format: contract says 8..100 chars, SPEC only "missing is 400". | a 5-char key is 400 `validation-failed` |
| S15 | open | "Canonical JSON" for `request_hash` is not defined (key order, whitespace). | not tested; suggest "keys sorted, no whitespace" |
| S16 | **resolved** (D8) | Does `CLOCK_OFFSET_SECONDS` shift JWT `iat`/`exp`? | no: business time only. Tests: a token from the normal instance works on the time-shifted one; tokens issued by the time-shifted instance have real-time `iat` and `exp - iat = 3600`. |
| S17 | note | Rate-limit and deprecation headers on **every** response, including 401s from the security layer and 404s for unknown routes. | enforced on all `/api` responses; the header filters must run before authentication |
| S18 | note | Health: SPEC names `checks.redis`; the database key is not named. | suite requires `redis` plus at least one more key, all `UP` |
| S19 | note | Metric label names are not fixed; Micrometer only emits `_bucket` series with `management.metrics.distribution.percentiles-histogram.http.server.requests=true`. | suite requires a `http_server_requests…_bucket` series and the three `library_*` metrics |
| S20 | note | May a member reserve a book they have on loan? May librarians reserve? | not tested |
| S21 | note | Unknown query parameters, unsupported `Content-Type` (415?) and wrong method (405?) have no problem code. | not tested |
| S22 | note | Is login e-mail case-insensitive (uniqueness is)? | not tested |

## 4. Notes for the implementers

- **Lock order with the book-row lock (D6).** To rule out deadlocks, queue paths (return, reserve, cancel,
  expiry) should lock the book row first (after a plain read to find the book id), then the loan or reservation,
  then the copy, then the next WAITING reservation. A borrow takes member → own READY reservation → copy and never
  the book row. Locking the reservation before the book in `cancel` while `return` locks book → reservation
  could deadlock. See `docs/architecture.md` §4.
- **Problem titles (D7)** are compared character for character on every error response.
- **Nullable fields (D5)**: Jackson needs `Include.ALWAYS` for these DTOs (not `NON_NULL`); Nest must not drop
  `undefined` properties, so map them to `null`.
- **Build context.** `docker-compose.yml` builds both images from the repository root, so the Dockerfiles can
  copy `db/migrations` and `contract/openapi.yaml`.
- **CI expectations.** `java`: `./mvnw -B -ntp verify` in `java/`. `ts`: `npm ci`, `npm run lint`,
  `npm run typecheck`, `npm test` in `ts/` (needs those scripts and a lockfile). Both jobs get Postgres 16 and
  Redis 7 service containers with `DATABASE_URL` / `REDIS_URL`; Testcontainers also works.
- **Time-travel instance.** `docker-compose.test.yml` starts a second instance on the same database with
  `CLOCK_OFFSET_SECONDS=1339200` and `WORKER_INTERVAL_MS=1000`. Migrations must be safe when it starts against an
  already-migrated database (Flyway is; the TS runner should take `pg_advisory_lock`).
- **Rate limit in tests.** The override sets `RATE_LIMIT_PER_MINUTE=100000` on the main instances.
- **`/openapi.yaml`** must serve the shared file; the suite compares it with `contract/openapi.yaml`.
- **Closed response schemas.** No fields beyond the contract (except problem extension members).
- **Timestamps** need exactly three fractional digits and `Z`. Java's default `Instant` serialisation drops
  trailing zeros, so it needs a fixed formatter.
- **304 responses** should repeat the `ETag` header (RFC 9110 §15.4.5); the suite checks it.

## Round 2 resolutions (2026-10-13)

All items still open above are now decided in `docs/SPEC.md` → "Decisions, round 2": malformed UUIDs (9),
who may return a loan (10), overdueDays/fees on returned loans and v1 `feeCents` (11), `available=false` (12),
keyset tie-breaker direction (13) and the global lock order (14).
