# Implementation notes (TypeScript)

Where the contract and [docs/SPEC.md](../docs/SPEC.md) leave room, this is what the NestJS service does and why.
Contract gaps found along the way are tracked in [docs/OPEN-QUESTIONS.md](../docs/OPEN-QUESTIONS.md).

## Behaviour shared with the Java service

- **Book queue lock** is `FOR NO KEY UPDATE` (SPEC decision 15).
- **Search** orders by `ts_rank DESC, id DESC`, with the trigram fallback ordered by `similarity DESC, id DESC`, and
  the cursor holds (score, id) (decision 16).
- **ETag** versions only the catalogue record; live copy counts are outside it (decision 17,
  [ADR 0009](../docs/adr/0009-etag-scope.md)).
- **Closed reservations** keep `heldCopyId: null` (decision 18).
- A member's `memberId` filter on list endpoints is ignored (20); a WAITING reservation is untouched by borrowing an
  AVAILABLE copy (21); a JSON body that is not an object is `Malformed JSON body` (22).
- **Passwords** are capped at 72 bytes (25): `maxLength: 72` plus a UTF-8 byte check, since multi-byte characters
  can exceed 72 bytes within 72 characters.
- **Counters** are `library_loans_borrowed_total` / `library_loans_returned_total` (24). prom-client does not append
  `_total`, so those are the registered names.

## Interpretations

- **Statuses without a problem code.** 405 maps to `not-found` (404); 413 and 415 map to `validation-failed` and are
  sent as 400, because the suite pins one status per code. Malformed JSON gives 400 `Malformed JSON body`: the JSON
  body parser raises a `DomainError` itself, since Nest wraps Fastify's parser error in a generic `HttpException`.
- **Latency histogram** is `http_server_requests_seconds` (the Prometheus base-unit suffix; Micrometer emits the same
  family name) with labels `method`, `route` and `status`.
- **Health check keys** are `db` and `redis`.
- **Database clock for audit and retention.** `reservations.created_at` (queue order) and the idempotency-key age use
  Postgres `now()`, not the business clock. The time-travel instance (`CLOCK_OFFSET_SECONDS=1339200`) shares the
  database; with the business clock its worker would delete every idempotency key the present instance had just
  stored and could reorder reservation queues.
- **Outbox poison messages** are parked after 10 failed deliveries (`attempts >= 10`, still counted in
  `library_outbox_backlog`) instead of being retried every tick forever.
- **`trustProxy` is off**, so the anonymous rate-limit key is the socket IP. Behind a reverse proxy, turn it on.
- `POST /books/{id}/copies` returns `Location: /api/v1/books/{bookId}/copies/{copyId}`, a route without a GET
  (open question C6).

## Versions

- **NestJS 11.2.7.** `@nestjs/platform-fastify@11.2.7` pins `fastify@5.11.3`, which has published advisories, so
  `package.json` has an npm `overrides` entry that lifts it to `fastify@5.12.7` (`npm audit`: 0 vulnerabilities).
  Moving to NestJS 12 (ESM-only) would remove the override.
- **TypeScript 5.9**, not 6 or 7: `openapi-typescript@7` has a peer dependency on `typescript ^5`, and
  `typescript-eslint` supports `<6.1`.
- `openapi-typescript` runs with `--default-non-nullable false`; without it, request properties that have a
  `default` (for example `MemberCreate.maxActiveLoans`) are generated as required.
