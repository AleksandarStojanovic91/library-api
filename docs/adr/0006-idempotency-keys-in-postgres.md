# ADR 0006: Idempotency keys stored in Postgres, in the same transaction

- Status: accepted
- Date: 2026-10-13

## Context

Borrowing is not naturally idempotent. A client that times out cannot know whether the loan was created; if it
retries, the member may end up with two loans. Clients need a way to retry safely.

## Decision

`POST /loans` requires an `Idempotency-Key` header (missing is 400).

- The key is scoped to the caller: primary key `(subject, key)`, where subject is the token's `sub`.
- `request_hash` = sha256 of `METHOD path canonical-JSON-body`.
- In the same transaction as the borrow, the key row is inserted **first**
  (`INSERT … ON CONFLICT DO NOTHING`), then the work is done, then the response status, body and relevant headers
  (`Location`) are stored on the row. Business changes and the stored response commit together.
- A retry with the same key and hash gets the stored response replayed, with `Idempotent-Replayed: true`.
- The same key with a different hash (another body, or the same body on another path such as v1 vs v2) is 422
  `idempotency-key-reused`.
- A concurrent duplicate blocks on the uncommitted key row, then sees it and replays.
- 4xx responses are stored too, so a retry gives the same answer (for example: roll the business changes back
  to a savepoint taken after the key insert, then store the error on the key row and commit).
- 5xx responses are not stored, so the client can retry after a transient failure.
- Rows older than 24 h are deleted by the worker.

## Consequences

- Exactly-once effect for retries, including retries that race the original request, without any extra
  infrastructure.
- The stored response is what the client saw first, even if the loan changed since (a replay after the return
  still says ACTIVE). That is the point: the replay answers "what happened to my request?".
- One extra indexed insert per borrow. The table grows with traffic; at high volume it would be partitioned
  by day (see `docs/architecture.md`, scaling).

## Alternatives considered

- **Redis** for keys: fast, but it is not part of the database transaction, so a crash between "loan committed"
  and "key stored" breaks the guarantee; and Redis is allowed to be down in this design.
- **Natural idempotency** (e.g. reject a second open loan of the same book by the same member): would change the
  business rules, and does not cover other retried requests.
