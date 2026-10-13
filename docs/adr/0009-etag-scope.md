# 9. The book ETag versions the catalogue record, not live availability

Date: 2026-10-13 · Status: accepted

## Context

`GET /api/v1/books/{id}` returns both librarian-edited fields (title, authors, tags…) and live counts
(`totalCopies`, `availableCopies`) that change with every borrow and return. The ETag is used twice: for conditional
reads (`If-None-Match` → 304) and for optimistic concurrency on `PATCH` (`If-Match` → 412).

## Decision

The ETag is the book's `version`, which changes only when the catalogue record changes. Lending does not bump it.

## Consequences

- Borrowing stays cheap: it locks one copy row with `FOR UPDATE SKIP LOCKED` and never the book row, so parallel
  borrows of different copies do not wait on each other.
- A librarian's edit is not rejected with 412 just because someone borrowed a copy in the meantime.
- A conditional read can answer 304 while the counts have changed. Clients that need fresh availability read
  `GET /books/{id}/copies` or list with `available=true`. The cached `GET /books/{id}` is also evicted on every loan
  change, so unconditional reads are fresh.
- Alternative considered: an ETag over the full representation (`version` + counts). Correct for caching, but it
  makes `If-Match` fail on unrelated lending activity, or forces a version bump and a book-row lock on every borrow.
