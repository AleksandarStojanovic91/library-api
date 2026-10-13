# Library API — Java / Spring Boot

The Java implementation of the shared [contract](../contract/openapi.yaml) and [behaviour spec](../docs/SPEC.md).
It is interchangeable with the TypeScript service behind the same black-box suite in [`api-tests/`](../api-tests).

| | |
|---|---|
| Runtime | Java 21, Spring Boot 4.1.1 (Spring Framework 7, Spring Security 7, Jackson 3), virtual threads |
| Data | PostgreSQL 16 via `JdbcClient` (no ORM), Flyway 12 running the shared `db/migrations` |
| Cache / limits | Redis 7 via Lettuce, with fail-fast options and a small circuit breaker |
| Ops | Micrometer + Prometheus (`/metrics`), OpenTelemetry tracing (OTLP when configured), JSON logs |
| Tests | JUnit 6, AssertJ, Testcontainers 2, ArchUnit, a contract validator (JSON Schema 2020-12) |

## Running it

```bash
# whole stack from the repo root: Postgres, Redis, Java on :8081 (and the TypeScript service on :8082)
docker compose up --build api-java

# or locally, against the compose Postgres/Redis
docker compose up -d postgres redis
cd java && ./mvnw spring-boot:run
```

- **API docs:** <http://localhost:8081/docs> (Swagger UI over the shared contract, served unchanged at `/openapi.yaml`).
- **Seed users:** `librarian@library.test` / `librarian-pass-123`, `member@library.test` / `member-pass-123`.

```bash
TOKEN=$(curl -s localhost:8081/api/v1/auth/token -H 'content-type: application/json' \
  -d '{"email":"member@library.test","password":"member-pass-123"}' | jq -r .accessToken)
curl -s localhost:8081/api/v2/loans -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d '{"bookId":"20000000-0000-4000-8000-000000000001"}' | jq
```

All settings are the SPEC's environment variables:

- `PORT`, `DATABASE_URL` (as `postgres://user:pass@host:port/db`), `REDIS_URL`, `JWT_SECRET`
- `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_NAMESPACE`, `LOAN_DAYS`, `FEE_CENTS_PER_DAY`, `RESERVATION_HOLD_HOURS`
- `CLOCK_OFFSET_SECONDS`, `WORKER_INTERVAL_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT`

One addition is `WORKER_ENABLED` (default `true`).

## Tests

```bash
./mvnw verify            # unit + ArchUnit (surefire) and integration tests (failsafe, Testcontainers: needs Docker)
./mvnw -DskipITs verify  # without Docker: unit and architecture tests only
```

**Unit tests (`*Test`)** run in milliseconds with no Spring context. They cover:

- the domain policies: fees, overdue days, loan status, the ISBN-13 check digit, merge-patch semantics;
- the cursor codec and keyset `Page` logic;
- the rate-limit window, ETag comparison, request hashing, the merge-patch parser and `DATABASE_URL` parsing;
- the hexagonal layering, enforced with ArchUnit.

**Integration tests (`*IT`)** boot the whole service on a random port against real PostgreSQL 16 and Redis 7, and talk
to it over HTTP like any client would:

- borrow, return and fees (with a controllable clock), the loan limit;
- no copy → reservation → hold → borrow, cancelling holds, hold expiry by the worker;
- races:
  - 20 members against 2 copies: exactly 2 loans;
  - 10 requests with one `Idempotency-Key`: exactly 1 loan, 9 replays;
  - 6 parallel borrows against a limit of 3;
  - parallel returns, and returns racing reservations;
- ETag `304`/`412`/`428`, idempotent replay and `422`, the `401`/`403`/`404` rules;
- v1 deprecation headers, keyset pagination across pages;
- the outbox and the overdue scan, rate limiting, and running with Redis down.

`SecurityRoutesIT` walks the contract and proves that every secured operation answers `401` without a token.

Every response the ITs see is checked against `contract/openapi.yaml`. The checker uses closed schemas, so no
undeclared fields are allowed. It also checks millisecond UTC timestamps and the problem+json invariants.

To run the ITs against existing services instead of Testcontainers (e.g. CI service containers), set
`IT_DATABASE_URL` (JDBC), `IT_DATABASE_USER`, `IT_DATABASE_PASSWORD` and `IT_REDIS_URL`.

## Architecture

Hexagonal (ports and adapters). Dependencies point inwards and [`ArchitectureTest`](src/test/java/dev/stojanovic/library/architecture/ArchitectureTest.java)
fails the build if they don't:

- the domain is plain Java;
- the application layer uses Spring only for `@Service` and transactions;
- adapters never talk to each other;
- the JDBC classes are package-private behind their ports.

```mermaid
flowchart LR
    subgraph in["adapters.in (driving)"]
        WEB["web: controllers, DTOs,<br/>problem+json, filters"]
        SCHED["scheduling: BackgroundWorker"]
    end
    subgraph app["application"]
        SVC["services / use cases<br/>(transactions, ownership rules)"]
        PORTS(["ports.out: repositories, BookCache,<br/>RateCounter, IdempotencyStore,<br/>TokenIssuer, PasswordHasher, LibraryMetrics"])
    end
    subgraph dom["domain (no framework)"]
        D["Book, Loan, Reservation, Actor, Isbn, Money<br/>LoanPolicy, FeeCalculator, ReservationPolicy"]
    end
    subgraph out["adapters.out (driven)"]
        PG["persistence: JdbcClient SQL"]
        RD["cache: Redis cache, rate counter"]
        SEC["security: bcrypt, JWT issuer"]
        MET["metrics: Micrometer"]
    end
    CFG["config: composition root, Security, Jackson, Clock"]
    WEB --> SVC
    SCHED --> SVC
    SVC --> D
    SVC --> PORTS
    PG -. implements .-> PORTS
    RD -. implements .-> PORTS
    SEC -. implements .-> PORTS
    MET -. implements .-> PORTS
    PG --> DB[(PostgreSQL)]
    RD --> R[(Redis)]
    CFG -.wires.-> in & out
```

A request passes through:

1. `RequestIdFilter`;
2. `AccessLogFilter`;
3. `DeprecationHeadersFilter`;
4. `RateLimitFilter`;
5. Spring Security (JWT);
6. the controller;
7. the application service, in one transaction;
8. the ports.

The first four filters run *before* Spring Security, so 401/403 responses also carry the request id, the rate-limit
headers and the v1 deprecation headers.

## Key decisions

ADR-style notes on the Java-specific choices. Cross-cutting decisions live in [`docs/adr`](../docs/adr).

### J1. `JdbcClient` and hand-written SQL, not JPA

Most of what this service must get right is SQL:

- `FOR UPDATE SKIP LOCKED`, `FOR NO KEY UPDATE`;
- row-value keyset predicates;
- `websearch_to_tsquery` with `ts_rank`, and `pg_trgm` similarity;
- partial unique indexes as invariants;
- CTEs with `UPDATE … RETURNING`.

Hibernate would hide exactly the lock and flush timing the concurrency guarantees depend on. Every query is in the
repository that owns it, and the domain is free of persistence annotations. JPA's advantages (dirty checking,
cascades) buy little for nine small tables. The cost is more mapping code, which stays readable with records and
small `RowMapper`s.

### J2. Contract first, hand-written DTOs plus a conformance check

`openapi-generator-maven-plugin` (7.26) was tried against the 3.1 contract and rejected:

- It needs `--skip-validate-spec` (`info.license.identifier`).
- It still flags 3.1 support as beta.
- It maps `uniqueItems` to `Set`, which silently de-duplicates where the contract requires a 400.
- It models nullable fields with `JsonNullable` (an extra Jackson 2-era module).
- It would turn the required `If-Match` into a Spring 400 instead of the SPEC's 428.

DTOs are therefore Java records. The integration tests validate every response against the contract's schemas
(JSON Schema 2020-12, objects closed), which catches drift as reliably as generation would, and catches
behavioural drift too.

### J3. Locking strategy

Pessimistic row locks with a fixed lock order (SPEC, decision 14) keep the invariants. Optimistic `version` columns
would only turn races into retries.

- **Borrow.** `members … FOR NO KEY UPDATE` serialises one member's borrows, so the loan limit cannot be raced.
  Then the member's READY hold is locked, or one copy is claimed with `FOR UPDATE SKIP LOCKED`. Parallel borrows
  never wait for each other and never get the same copy. The partial unique index `ux_loans_open_copy` is the last
  line of defence.
- **Return, cancel, hold expiry, reserve.** These first lock the **book** row and then re-read their loan or
  reservation under lock. "Hold for the next in line" versus "back on the shelf" is therefore serialised with
  "join the queue", and a copy can never sit AVAILABLE while someone waits. The book is locked `FOR NO KEY UPDATE`
  (SPEC decision 15): it still serialises these four operations, but does not block the KEY SHARE lock taken by the
  foreign-key check of a concurrent borrow's loan insert.
- **Picking the next reservation.** It uses `SKIP LOCKED`, so two copies returned at the same moment go to the first
  *and* second in line (`LIMIT 1 FOR UPDATE` would return no row for the second).
- **ETag scope.** The ETag is the book `version` and covers only the catalogue fields; lending does not bump it
  (SPEC decision 17, ADR 0009).
- **PATCH.** `If-Match` is the client-facing optimistic check, but it is evaluated against the row-locked current
  version. Five parallel PATCHes with the same ETag produce exactly one 200 and four 412s.

### J4. Keyset pagination

The cursor is base64url JSON of the last row's sort key and id. The next page is a single row comparison, as
SPEC decision 13 requires: `(key, id) > (:k, :id)`, or `<` for descending sorts. It never uses `OFFSET`, so:

- the cost per page is constant, served by the matching index;
- rows inserted before the cursor do not shift later pages (`PaginationIT` proves it).

Details:

- **Timestamps.** The cursor keeps PostgreSQL's microseconds. The API prints milliseconds, and truncating the
  cursor would make rows repeat or disappear.
- **Search.** It orders by `ts_rank DESC, id DESC` (trigram fallback: `similarity DESC, id DESC`) and pages on
  (rank, id). The cursor also records the search mode, so a full-text query never "falls back" to trigrams on
  page 2.
- **Validation.** Cursors are checked against the endpoint and sort that produced them; anything else is a 400.

### J5. Idempotency

The `Idempotency-Key` row is claimed with `INSERT … ON CONFLICT DO NOTHING` in the same transaction *before* the
work. A concurrent duplicate blocks on the uncommitted row, then reads the committed response and replays it.

The work runs inside a **savepoint**:

- A business failure (4xx) rolls back only the partial writes. The key row and the stored problem survive and are
  replayed later.
- A 5xx rolls back everything, releasing the key for a retry.

The request hash is sha256 of `METHOD path canonical-json`, where canonical JSON has sorted keys and no nulls.
Whitespace or key order therefore don't matter, but switching between v1 and v2 does. A replayed problem gets the
current request's `requestId`.

### J6. Transactional outbox

Every state change writes its event (`loan.created`, `loan.returned`, `loan.overdue`, `reservation.ready`,
`reservation.expired`) in the same transaction. The worker publishes batches with `FOR UPDATE SKIP LOCKED`, so any
number of instances can run it. Each message runs in its own savepoint, so a poison message only bumps `attempts`
(it is parked after 10) instead of blocking the batch. `UNIQUE(outbox_id)` on `notifications` makes redelivery
harmless.

### J7. Redis is an optimisation, not a dependency

- **Cache-aside.** `GET /books/{id}` reads through the cache; evictions run **after commit**, so a reader cannot
  re-cache the pre-commit row.
- **Rate limiter.** One atomic Lua `INCR`+`EXPIRE` per request.
- **Fail-fast client.** Lettuce rejects commands while disconnected, and `RedisGuard` (a tiny circuit breaker)
  skips Redis for 5 s after a failure and logs once per outage. A Redis outage costs no latency and no errors:
  reads hit the database, the rate limiter fails open, and readiness reports `redis: DOWN` with HTTP 200.

### J8. Time

Business "now" is a `Clock` bean: UTC with millisecond ticks plus `CLOCK_OFFSET_SECONDS`. Domain policies take
instants, so they are unit-tested without mocks, and the ITs swap in a `MutableClock` to jump past due dates.
JWT `iat`/`exp` deliberately use real time (SPEC, decision 8).

### J9. Operations

- **Graceful shutdown.** `server.shutdown=graceful` with a 20 s phase timeout. The scheduler waits for a running
  worker tick, then the Hikari pool closes. The image runs the JVM as PID 1 (exec form) so it receives SIGTERM.
- **Logs.** JSON via Spring Boot structured logging (logstash layout). There is one `http.access` line per request
  with method, route template, status, durationMs, requestId and memberId, and `requestId` is also in the MDC of
  every other line.
- **Metrics.** `/metrics` is the actuator's Prometheus scrape of the Micrometer registry: the `http.server.requests`
  histogram plus `library_loans_borrowed_total`, `library_loans_returned_total` and `library_outbox_backlog`. It is
  public and exempt from rate limiting.
- **Tracing.** OpenTelemetry spans are always created; `OTEL_EXPORTER_OTLP_ENDPOINT` switches on OTLP export.
- **Image.** Multi-stage build with layered extraction, a non-root user, container-aware heap sizing and a
  `HEALTHCHECK` on `/health/ready`.

## Layout

```
src/main/java/dev/stojanovic/library
├── domain          model (Book, Loan, Reservation, Actor, Isbn, Money, Patch), policy, error
├── application     service (use cases), port/out, model (read models), page (Cursor, Page)
├── adapters/in     web (controllers, dto, support, filter, security, validation), scheduling
├── adapters/out    persistence (JdbcClient), cache (Redis), security (bcrypt, JWT), metrics
└── config          Spring wiring, security chain, Jackson, environment mapping
```

Questions and gaps found in the shared contract/SPEC are collected in [`NOTES-for-maintainer.md`](NOTES-for-maintainer.md).
