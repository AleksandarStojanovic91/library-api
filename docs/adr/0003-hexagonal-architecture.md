# ADR 0003: Hexagonal architecture (ports and adapters) in both services

- Status: accepted
- Date: 2026-10-13

## Context

The business rules (loan limits, fees, the reservation queue) are the same in both services and must be
testable without HTTP or a database. Some infrastructure is deliberately replaceable: the clock (shifted by
`CLOCK_OFFSET_SECONDS` in tests), the cache (may be down), the event publisher (a table today, a broker
tomorrow).

## Decision

Both services are split into:

- **Domain:** entities and rules, no framework imports, no I/O, no direct clock access.
- **Application:** one use case per operation (BorrowBook, ReturnLoan, ...). Owns the transaction boundary and
  lock order. Talks to the outside only through ports (interfaces): repositories, `Clock`, `Cache`,
  `RateLimiter`, `IdempotencyStore`, `OutboxWriter`.
- **Adapters:** inbound (HTTP controllers, scheduler) and outbound (Postgres, Redis, system clock).

The HTTP adapter maps domain errors to problem codes and chooses the v1 or v2 representation, so versioning
never reaches the use cases.

## Consequences

- Domain rules are unit-tested with a fixed clock and in-memory fakes, in milliseconds.
- Swapping the outbox target or the cache touches one adapter.
- More files and some mapping code than a controller-service-repository layout. For a service this size the
  overhead is small, and the structure is the same in both languages, which makes them easy to compare.
- Frameworks still do what they are good at: Spring and Nest handle wiring, validation and transactions in the
  adapters; the domain stays plain.

## Alternatives considered

- **Layered (controller → service → repository) with framework types throughout:** less code, but rules end up
  depending on HTTP and ORM types, and the clock is read directly.
- **Full DDD with aggregates and domain events in memory:** more ceremony than five entities need.
