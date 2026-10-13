# ADR 0001: Contract-first API with a hand-written OpenAPI 3.1 document

- Status: accepted
- Date: 2026-10-13

## Context

The same API is built twice, in Java and in TypeScript, and both must behave identically. If each service
generated its own OpenAPI document from code annotations, there would be two specifications that drift apart,
and nobody would know which one is right.

## Decision

`contract/openapi.yaml` is written by hand, reviewed like code, and is the single source of truth for paths,
schemas, status codes and headers. Behaviour that OpenAPI cannot express (ordering, locking, timing, which
error wins) goes into `docs/SPEC.md`.

- Both services serve this exact file at `/openapi.yaml` and render it with Swagger UI at `/docs`. Code-generated
  specs (springdoc, @nestjs/swagger) may exist for debugging but are not published as the contract.
- The shared test suite generates its TypeScript types from the file (`openapi-typescript`) and validates every
  response body against it at runtime (Ajv). CI fails if the generated types are stale.
- The contract is linted in CI with Redocly CLI.

## Consequences

- A change to the API starts as a pull request to the contract, so it is reviewed before anyone writes code.
- Server code is written against the contract, not generated from it. That keeps each implementation
  idiomatic, at the cost of discipline: the runtime validation in the suite is what catches drift.
- The contract has to be complete enough to test against, including errors. Gaps found so far are listed in
  `docs/OPEN-QUESTIONS.md`.

## Alternatives considered

- **Code-first** (annotations generate the spec): fast for one service, but two services would publish two
  specs.
- **Server stubs generated from the contract** (openapi-generator): keeps types in sync, but the generated
  code is hard to read and fights both frameworks' conventions. Not worth it for a small API.
