# Implementation notes (Java)

Where the contract and [docs/SPEC.md](../docs/SPEC.md) leave room, this is what the Spring Boot service does and why.
Contract gaps found along the way are tracked in [docs/OPEN-QUESTIONS.md](../docs/OPEN-QUESTIONS.md).

## Locking

- **Book and member rows** are locked with `FOR NO KEY UPDATE` (SPEC decision 15), not `FOR UPDATE`: loans,
  reservations and notifications reference them through foreign keys, and a weaker lock lets those inserts
  proceed without waiting.
- **Lock order on a return** is book → loan → next reservation (`SKIP LOCKED`) → copy. The loan is not last, but
  the order is deadlock-free because nothing else locks an existing loan before its book. A clearer statement of
  the rule would be "book, then the row you started from, then everything else".
- **Holds past `ready_until`** are not honoured by a borrow (`ready_until > now`); the worker expires them on its
  next tick.

## Errors and HTTP

- **Passwords over 72 bytes** get 400 `validation-failed` ("must be at most 72 bytes (bcrypt limit)"). bcrypt only
  uses 72 bytes and Spring Security 7 refuses longer input, so silently truncating was never an option. Multi-byte
  passwords are checked in bytes, not characters.
- **405, 406 and 415** have no problem code of their own and every code is pinned to one status, so 405 is answered
  as 404 `not-found` (with an `Allow` header) and 406/415 as 400 `validation-failed`, the same as the TypeScript
  service.
- **An invalid token on a public route** (for example an expired token on `GET /books`) is 401, the standard
  resource-server behaviour. No token at all is fine.
- **Unknown routes are 404 for everyone.** Spring Security lists the protected routes explicitly instead of denying
  by default; `SecurityRoutesIT` walks the contract to prove every secured operation still answers 401 without a
  token.
- **Type errors in request bodies:** Jackson stops at the first value of the wrong JSON type, so only that field is
  reported; every constraint violation is reported. `authorIds` is bound as strings so one malformed UUID does not
  hide the other errors.
- **Idempotent replays** come from a `jsonb` column: the replayed JSON is equal to the original, but its key order
  may differ from the original bytes.

## Domain behaviour

- **A copy added while people are waiting** becomes AVAILABLE. It is not handed to the head of the queue; only
  returns, cancellations and expiries hand a copy off.
- **Borrowing while holding a WAITING reservation** for the same book leaves the reservation in place (SPEC
  decision 21).
- **Search cursor** is (rank, id) as SPEC decision 16 requires, and it also records the search mode, so later pages
  never switch between full-text and trigram matching.

## Background work and operations

- **Outbox poison messages** are retried on every tick and parked after 10 attempts. They stay unpublished and are
  counted in `library_outbox_backlog`, so they show up on dashboards instead of being retried forever.
- **Metrics:** the loan counter is `library.loans.borrowed`, exported as `library_loans_borrowed_total`
  (Prometheus client_java reserves the `_created` suffix, which ruled out `library_loans_created_total`).
  `/metrics` is Micrometer's own Prometheus scrape.
- **Health check keys** are `db` and `redis`, the same as the TypeScript service.
- **Rate-limit windows** are epoch minutes of the business clock. With a `CLOCK_OFFSET_SECONDS` that is not a
  multiple of 60 the windows shift by the remainder; they are still one minute long. Time-travel instances keep
  their own counters through `RATE_LIMIT_NAMESPACE`.
- **Integration tests** run with Testcontainers by default, or against existing services by setting
  `IT_DATABASE_URL` / `IT_REDIS_URL` (see [README.md](README.md)).
