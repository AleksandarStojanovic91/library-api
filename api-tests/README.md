# Shared API test suite

One black-box suite, run unchanged against the Java service (`:8081`) and the TypeScript service (`:8082`).
If both pass, they behave the same as far as any client can tell. The suite knows nothing about either
implementation: it speaks HTTP, reads `contract/openapi.yaml` and follows `docs/SPEC.md`.

Built with Playwright Test, API only (no browsers are installed or started).

## Three layers of checking

| Layer | Where | What it checks | When |
|---|---|---|---|
| Explicit assertions | `tests/**` | the behaviour each test is about (status, codes, business rules) | per test |
| Contract conformance | `src/contract/contract.ts` | status is documented for the operation, Content-Type matches, JSON body validates against the OpenAPI schema (JSON Schema 2020-12 via Ajv), documented headers (`Location`, `ETag`, `Deprecation`, ...) are present, no undeclared fields | **every response** |
| SPEC invariants | `src/contract/spec-invariants.ts` | `X-Request-Id` echoed or generated, `RateLimit-*` headers, `WWW-Authenticate` on 401, `Retry-After` on 429, v1 deprecation headers, problem details (`type` URI, `status`, `instance`, `requestId`, code/HTTP status pairing, exact title per code from the SPEC table, no stack traces), millisecond UTC timestamps | **every response** |

The second and third layer run inside the API client (`src/client/http.ts`), so a test that only checks
`expect(res).toHaveStatus(201)` still fails if the body has the wrong shape or a header is missing. That is how
259 tests per implementation cover far more than 259 assertions.

Two details of the contract check:

- **Closed schemas.** Response objects may not carry fields the contract does not declare
  (`additionalProperties: false` is added at load time, `Problem` excepted because RFC 9457 allows extension
  members). Both implementations must return exactly the documented shape. `CONTRACT_ALLOW_EXTRA_FIELDS=1`
  relaxes this.
- **Nullable fields are always present** (SPEC "Decisions" 5): every property typed `[x, 'null']` is treated as
  required in response schemas, so `{"description": null}` passes and a missing `description` fails.
- **Contract gaps.** When an operation returns an error status the contract does not list (since the 429/400
  decision, essentially only a 400 for a malformed path id), the body must still be a valid `Problem`, and the test gets a `contract-gap`
  annotation in the HTML report instead of failing. `CONTRACT_STRICT_STATUS=1` turns gaps into failures. An
  undocumented *success* status always fails.

The validator has its own offline tests (`tests/unit/`), so "everything passes" cannot mean "the validator
accepts everything".

## Running

```bash
npm ci                                     # no `playwright install` needed: API tests use no browser
npm run typecheck                          # regenerates src/generated/openapi.d.ts, then tsc
npx playwright test --project=unit         # offline self-tests, no server needed

# needs the stack: `make up` from the repo root (uses docker-compose.test.yml, see "Rate limit" below)
npx playwright test --project=java         # or: make api-test-java
npx playwright test --project=ts           # or: make api-test-ts
npx playwright test --project=java --project=ts    # both, in parallel

BASE_URL=http://staging:9000 npx playwright test --project=java   # any URL, using that project's settings
npx playwright show-report
```

| Project | Target | Notes |
|---|---|---|
| `unit` | none | self-tests of the validator, invariants and data generators |
| `java` / `ts` | `BASE_URL` or `:8081` / `:8082` | the shared suite (`tests/api`) |
| `java-time-travel` / `ts-time-travel` | `BASE_URL` + `OVERDUE_BASE_URL` | overdue fees and reservation expiry (`tests/time-travel`); skipped unless `OVERDUE_BASE_URL` is set |

### Time travel

Overdue loans and expiring reservations depend on time passing. Each service computes "now" as
`server time + CLOCK_OFFSET_SECONDS` for business logic. `docker-compose.test.yml` defines a second instance per
implementation (`api-java-future` on `:8091`, `api-ts-future` on `:8092`) on **the same database** with the clock
15.5 days ahead. A test borrows on the normal instance and reads, returns or waits on the future one:

```bash
make api-test-time-travel-java      # starts api-java-future, then:
OVERDUE_BASE_URL=http://localhost:8091 npx playwright test --project=java-time-travel
```

With the default offset a loan is 1.5 days late: `overdueDays = floor(1.5) = 1`, fee = `ceil(1.5) = 2` started
days × 50 cents = `"1.00"` (SPEC "Decisions" 3). The offset shifts business time only; JWT `iat`/`exp` use real
time, so tokens work across both instances (SPEC "Decisions" 8, tested).
If you change `OVERDUE_OFFSET_SECONDS` for the service, pass the same value to the suite.

Start the future instance only after the main suite has finished. Its background worker expires every READY
reservation in the shared database (they are all 48 h old from its point of view), which would break
reservation tests still running against the normal instance. CI runs the steps in that order.

### Rate limit

The main instances run with `RATE_LIMIT_PER_MINUTE=100000` (from `docker-compose.test.yml`): all workers share
the seeded librarian and one IP, so the default 120/min would fail the run. The headers are still checked on every
response. The 429 test needs a small limit and only runs with `RATE_LIMIT_TEST=1`:

```bash
RATE_LIMIT_TEST=1 BASE_URL=http://localhost:8091 npx playwright test --project=java --grep @rate-limit-429
```

CI runs it against the time-travel instance, which keeps the default limit.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | per project | URL of the implementation under test |
| `OVERDUE_BASE_URL` | unset | time-travel instance; enables the `*-time-travel` projects |
| `OVERDUE_OFFSET_SECONDS` | `1339200` (15.5 days) | must match that instance's `CLOCK_OFFSET_SECONDS` |
| `RATE_LIMIT_TEST` | unset | `1` runs the 429 test |
| `JWT_SECRET` | compose default | lets the auth tests forge an expired token; skipped if it does not match |
| `LOAN_DAYS`, `FEE_CENTS_PER_DAY`, `RESERVATION_HOLD_HOURS` | 14, 50, 48 | must match the service |
| `CONTRACT_STRICT_STATUS` | unset | `1` fails on undocumented error statuses |
| `CONTRACT_ALLOW_EXTRA_FIELDS` | unset | `1` allows undeclared response fields |
| `PW_REPORT_DIR` | `playwright-report` | HTML and JUnit output |

## Layout

```
src/
  config.ts                env, seed data ids
  generated/openapi.d.ts   types generated from the contract (npm run generate; CI fails if stale)
  contract/contract.ts     OpenAPI response validation (Ajv, JSON Schema 2020-12)
  contract/spec-invariants.ts   SPEC rules checked on every response
  client/http.ts           request wrapper: request ids, parsing, both checks
  client/library-api.ts    typed client: books, copies, authors, members, loans (v1/v2), reservations, ops
  data/generators.ts       ISBN-13 with check digit, barcodes, e-mails, search words, tags
  data/factory.ts          creates isolated test data through the API
  data/jwt.ts              forging tokens for the auth tests
  fixtures.ts              anon / librarian / member clients, factory, time-travel clients
  matchers.ts              toHaveStatus, toBeProblem (print the whole exchange on failure)
tests/api/                 the shared suite
tests/time-travel/         needs OVERDUE_BASE_URL
tests/unit/                offline self-tests
```

## What is covered (per implementation)

| Area | File | Tests |
|---|---|---|
| Auth: token, claims, no user enumeration, forged / expired / `alg: none` / tampered tokens | `auth.spec.ts` | 13 |
| Authorization: 401 on all 21 protected routes, 403 for librarian-only routes, 404-not-403 for other members' data | `authorization.spec.ts` | 31 |
| Books: create/read, validation (every field listed, JSON pointers), ISBN pattern and check digit, duplicate 409, delete (204, `book-has-active-loans`, `book-has-loan-history`) | `books.spec.ts` | 24 |
| ETag: 304 / 412 / 428, version bump, 5 concurrent PATCHes → one wins; merge patch semantics; Redis cache HIT/MISS and eviction | `books-etag-and-patch.spec.ts` | 19 |
| Search: full text over title/author/description, ranking, websearch syntax, trigram fallback; filters and sorting | `search.spec.ts` | 17 |
| Cursor pagination: no duplicates or gaps, ties, NULLS LAST, inserts between pages; documented 400 for bad limit/cursor on all six list endpoints | `pagination.spec.ts` | 36 |
| Copies, authors, members | `copies-authors-members.spec.ts` | 19 |
| Member status: `PUT /members/{id}/status` (librarian only, 403, 404, validation); suspended members can read and return but get `member-suspended` on borrow (v1, v2, on behalf) and reserve | `members-status.spec.ts` | 17 |
| Loans: v1 vs v2 shapes, deprecation headers, due date, return, loan limit, no copy available, filters | `loans.spec.ts` | 19 |
| Reservations: FIFO positions, READY hold, only the holder can borrow, cancel passes the hold on | `reservations.spec.ts` | 13 |
| Idempotency: replay, stored response, 422 on reuse, per-member scope, stored 4xx, 5 concurrent duplicates | `idempotency.spec.ts` | 8 |
| Concurrency: 10 borrows for 2 copies → exactly 2, loan limit under parallel borrows, parallel returns, reserve-vs-return race | `concurrency.spec.ts` | 5 |
| Error catalogue: each reachable problem code with its exact title, unknown route, field pointers | `errors.spec.ts` | 22 |
| Observability: X-Request-Id, health, metrics, `/openapi.yaml` equals the contract, `/docs` | `observability.spec.ts` | 13 |
| Rate limiting: headers, budget per client, documented 429 (opt-in) | `rate-limit.spec.ts` | 3 |
| **Total per implementation** | | **259** |
| Time travel: overdueDays = floor, fee = ceil(started days) × 50c (v1 and v2), SQL status filter, late fee on return, reservation expiry passes the hold on, tokens unaffected by the clock offset | `tests/time-travel` | 10 |
| Suite self-tests | `tests/unit` | 26 |

## Writing a test

```ts
import { expect, test } from '../../src/fixtures';

test('no copy available: 409 no-copy-available', async ({ factory }) => {
  const [first, second] = await factory.members(2);      // fresh members: own loan limit, own rate-limit bucket
  const { book } = await factory.book({ copies: 1 });     // unique ISBN and barcode
  await factory.loan(first, book.id);

  const res = await second.api.loans.borrow({ bookId: book.id });   // Idempotency-Key added automatically

  expect(res).toBeProblem(409, 'no-copy-available');
});
```

Rules the suite follows, so it can run fully parallel and repeatedly against the same database:

- Every test creates its own books, copies and members. Seeded data is only read, never borrowed or changed.
- Filters on unique tags or made-up search words keep other tests' data out of list assertions.
- Setup goes through `factory`, which fails with a `SetupError` and the full response if setup itself breaks.
- Every request carries an `X-Request-Id` like `pw-1a2b3c4d-4242-17`; failure messages print it, so you can
  find the request in the service logs.
- No retries. A test that passes on the second try is pointing at a race in the service.
