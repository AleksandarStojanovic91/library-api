# ADR 0008: API versioning in the URI, with Deprecation and Sunset headers

- Status: accepted
- Date: 2026-10-13

## Context

The loan representation needed a breaking change: embed the book and copy instead of bare ids, and return the
fee as Money (`{"amount":"1.50","currency":"EUR"}`) instead of integer cents. Existing clients of the old shape
must keep working while they migrate, and they need to learn, from the API itself, that they should.

## Decision

- The major version is part of the path: `/api/v1/...`, `/api/v2/...`. Only resources that actually changed get
  a new version; books, members and reservations stay on v1.
- v1 and v2 loans share the use cases and the database. The difference is only in the HTTP adapter that maps the
  domain object to JSON, so the two versions cannot drift in behaviour.
- Every v1 loans response, errors included, carries:
  - `Deprecation: @1767225600` (RFC 9745; deprecated since 2026-01-01),
  - `Sunset: Thu, 31 Dec 2026 23:59:59 GMT` (RFC 8594; may be removed after this date),
  - `Link: </api/v2/loans>; rel="successor-version"`.
- The contract marks the v1 operations `deprecated: true`, so Swagger UI shows them struck through.
- Policy: a deprecated version keeps working, unchanged, for at least six months; its remaining traffic is
  watched through the route label of `http_server_requests`; it is removed after the sunset date.

## Consequences

- Visible and debuggable: the version is in every log line and metric, and a curl shows it.
- Additive changes (new optional fields, new endpoints) do not need a new version; the closed response schemas
  in the shared suite force such additions through the contract first.
- Two representations of loans to maintain until the sunset date. Sharing the use cases keeps that cost to a
  mapper and a controller.
- An idempotency key used on v2 cannot be replayed on v1 (the path is part of the request hash). Clients migrate
  per request, not mid-retry.

## Alternatives considered

- **Media-type versioning** (`Accept: application/vnd.library.v2+json`): keeps URIs stable, but is invisible in
  logs and browser address bars and awkward to cache and to try with curl.
- **Header versioning** (`Api-Version: 2`): same drawbacks.
- **No versioning, only additive changes:** would have meant keeping `feeCents` forever next to `fee`.
