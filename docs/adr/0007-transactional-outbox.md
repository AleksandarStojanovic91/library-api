# ADR 0007: Transactional outbox for events

- Status: accepted
- Date: 2026-10-13

## Context

Some state changes must trigger work elsewhere: notify a member that a reserved copy is ready, that a loan is
overdue, keep a search index or analytics up to date. Publishing to a broker directly from the request has the
dual-write problem: the database commit can succeed and the publish fail (lost event), or the publish succeed
and the commit roll back (event about something that never happened).

## Decision

Events are rows in an `outbox` table, inserted in the same transaction as the change they describe
(`loan.created`, `loan.returned`, `loan.overdue`, `reservation.ready`, `reservation.expired`).

A background publisher, running in every instance, repeatedly:

1. claims up to 100 unpublished rows in id order with `FOR UPDATE SKIP LOCKED`,
2. delivers each one (here: inserts a row in `notifications`, which stands in for e-mail or a broker; the unique
   `notifications.outbox_id` makes delivery at most once per event),
3. sets `published_at`, or increments `attempts` on failure so the row is retried later.

`library_outbox_backlog` (a Prometheus gauge) shows how many rows wait; a growing number means the publisher is
stuck.

## Consequences

- An event exists if and only if its change committed.
- Delivery is asynchronous (up to `WORKER_INTERVAL_MS`, 5 s). Nothing in the API depends on it having happened.
- With a real broker, delivery becomes at-least-once (a crash after publishing but before `published_at` is set
  repeats the event), so consumers must deduplicate by event id.
- Ordering is per row id within one publisher batch; with several publishers and a broker, order per aggregate
  would need partitioning by `aggregate_id`.

## Alternatives considered

- **Publish after commit** from the request: simple, loses events on crashes.
- **Change data capture** (Debezium reading the WAL): no outbox table needed and very robust, but a lot of
  infrastructure for this project. The outbox table is also what Debezium's outbox router expects, so moving
  to CDC later does not change the schema.
