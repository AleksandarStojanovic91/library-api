# ADR 0004: Keyset (cursor) pagination, never OFFSET

- Status: accepted
- Date: 2026-10-13

## Context

Every list endpoint is paged. `LIMIT … OFFSET …` is simple but has two problems: Postgres reads and throws
away all skipped rows, so deep pages get slower, and rows inserted or deleted between two page requests shift
the window, so clients see duplicates or miss rows.

## Decision

All lists use keyset pagination with an opaque cursor:

- The cursor is base64url of a small JSON object with the sort key of the last row and its id, e.g.
  `{"t":"clean code","id":"…"}`. Clients must treat it as opaque.
- The next page is `WHERE (sort_key, id) > (:t, :id) ORDER BY sort_key, id LIMIT :limit + 1`. Fetching one extra
  row tells whether there is a next page; `nextCursor` is `null` otherwise.
- `id` breaks ties, so the order is total and deterministic even when many rows share a title.
- Each sort has a matching index (`lower(title), id`; `published_year DESC NULLS LAST, id`; `created_at, id`).
- `limit` is 1..100 (default 20). An unparsable cursor is 400.

## Consequences

- Page N costs the same as page 1: an index seek, not a scan of N × limit rows.
- No duplicates or gaps when data changes between requests. The shared suite inserts a row before the cursor
  between two page requests and checks that the second page does not shift.
- No "jump to page 37" and no total count. Neither is needed by the clients of this API; a count can be added
  as a separate, cacheable endpoint if it ever is.
- Sorting by a nullable or computed key (published year, search rank) needs care in the cursor encoding (NULLs,
  float precision). The SPEC pins these cases down.

## Alternatives considered

- **OFFSET:** rejected for the reasons above.
- **Server-side cursors / snapshots:** stateful, does not fit stateless instances behind a load balancer.
