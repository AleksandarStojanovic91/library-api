# Notes for the maintainer (TypeScript implementation)

These are points where the contract, SPEC or schema left room, where this implementation chose something
deliberately, or where I found a gap. The shared files were not changed.

## Resolved (SPEC Decisions, round 3, and ADR 0009)

- Book queue lock is `FOR NO KEY UPDATE` in both services (Decisions 15), as implemented here.
- Search orders by `ts_rank DESC, id DESC`, with the trigram fallback by `similarity DESC, id DESC`, and the
  cursor holds (score, id) (Decisions 16). This service was changed from its earlier `rank, title, id` order.
- ETag versions only the catalogue record; live copy counts are outside it (Decisions 17, ADR 0009).
- Closed reservations keep `heldCopyId: null` (Decisions 18).
- The in-place `tags.sort()` in `api-tests/tests/api/books.spec.ts` is fixed. The time-travel instances keep
  separate rate-limit counters through `RATE_LIMIT_NAMESPACE` (Decisions 19 revised, 23), implemented here.
- `memberId` passed by a member on list endpoints is ignored (20); a WAITING reservation is untouched by
  borrowing an AVAILABLE copy (21); a JSON body that is not an object is `Malformed JSON body` (22). All three
  were already this service's behaviour.
- Passwords are capped at 72 bytes (25): `maxLength: 72` plus a UTF-8 byte check, since multi-byte characters
  can exceed 72 bytes within 72 characters.
- Counters are exposed as `library_loans_borrowed_total` / `library_loans_returned_total` (24, revised). prom-client
  does not append `_total`, so those are the registered names.

## Interpretations (no action needed unless you disagree)

- **Problem codes for statuses without a code.** 405 maps to `not-found` (404). 413 and 415 map to
  `validation-failed` and are sent as **400**, because the suite pins one status per code. Malformed JSON gives
  400 with detail `Malformed JSON body`; for that, the JSON body parser raises a `DomainError` itself, since Nest
  wraps Fastify's parser error in a generic `HttpException`.
- **Metric name.** The histogram is `http_server_requests_seconds` (Prometheus base-unit suffix; Micrometer emits
  the same family name), with labels `method`, `route` and `status`. The suite matches `^http_server_requests\w*_bucket`.
- **Health check key** for Postgres is `db` (`checks: { db, redis }`).
- **Database clock for audit/retention.** `reservations.created_at` (queue order) and the idempotency key age use
  `now()` in Postgres, not the business clock. The time-travel instance (`CLOCK_OFFSET_SECONDS=1339200`) shares
  the database, and its worker would otherwise delete every idempotency key the present instance has just stored,
  and could reorder reservation queues. Worth a sentence in SPEC "Time".
- **Outbox poison messages.** After 10 failed deliveries a message is parked (`attempts >= 10`, still counted in
  `library_outbox_backlog`) instead of being retried every tick forever.
- **`trustProxy`** is off, so the anonymous rate-limit key is the socket IP. Behind a reverse proxy, enable it.
- `POST /books/{id}/copies` returns `Location: /api/v1/books/{bookId}/copies/{copyId}`, a route that does not
  exist (open question C6).

## Versions

- **NestJS 11.2.7**, as briefed. NestJS 12 (ESM-only) is out. `@nestjs/platform-fastify@11.2.7` pins
  `fastify@5.11.3`, which has published advisories, so `package.json` has an npm `overrides` entry that lifts it
  to `fastify@5.12.7` (`npm audit`: 0 vulnerabilities). Moving to Nest 12 would remove the override.
- **TypeScript 5.9.3**, not 6/7. `openapi-typescript@7` has a peer dependency on `typescript ^5`, and
  `typescript-eslint` supports `<6.1`.
- **Vitest 4.1 / dependency-cruiser 17.** npm resolved these because Vitest 5 and depcruise 18 declare
  `engines: ^22 || ^24 || >=26` and the development machine runs Node 25. Both work on Node 22, 24 and 25.
- `openapi-typescript` runs with `--default-non-nullable false`. Without it, request properties that have a
  `default` (e.g. `MemberCreate.maxActiveLoans`) are generated as required.

## Test status at hand-over

- `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`: pass.
- **The shared suite** (`api-tests`, run read-only with its output redirected outside the repository) against
  this service on PGlite, before the round-3 fixes to the suite: `ts` project 257/258 (the failure was the
  in-place `tags.sort()`), `ts-time-travel` 10/10 (with the future instance's rate limit raised locally).
- **Integration tests were not run against Postgres/Redis containers**, because Docker was not running on the
  development machine. I ran them instead against PGlite (Postgres 17 compiled to WASM, served over the wire
  protocol, with pg_trgm) and a minimal in-process Redis stand-in, using `TEST_DATABASE_URL`/`TEST_REDIS_URL`.
  All files passed there. That exercised the real SQL (keyset queries, FTS and trigram search, CTEs, `FOR UPDATE`
  syntax, migrations), but PGlite multiplexes every connection onto one backend, so **row-lock behaviour (SKIP
  LOCKED, concurrent idempotency keys, deadlock freedom) is only proven once `npm run test:integration` runs
  with Docker** (CI's `ts` job does that on GitHub runners).
- The Docker image was not built locally, for the same reason.
