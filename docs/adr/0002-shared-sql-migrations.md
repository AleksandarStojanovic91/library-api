# ADR 0002: One set of plain SQL migrations for both services

- Status: accepted
- Date: 2026-10-13

## Context

Both services need the same schema. Each ecosystem has its own migration tool (Flyway or Liquibase for Java;
TypeORM, Prisma or Knex migrations for Node) with its own file format. Two sets of migrations would be two
schemas that drift.

## Decision

The schema and seed data live once, as plain SQL files in `db/migrations/`, named `V<n>__<description>.sql`
(Flyway's convention). Each service applies them in filename order on start:

- Java uses Flyway, pointed at the directory (or the files copied into the image).
- TypeScript uses a small runner that records applied files in `schema_migrations`.

Each implementation gets its own database (`library_java`, `library_ts`) on the same Postgres server, created
by `db/init/01-databases.sql`, so both can run side by side.

Database invariants (unique partial indexes, CHECK constraints, the search trigger) are part of the schema, not
of either service.

## Consequences

- The schema is identical by construction, and a reviewer reads one file to understand the data model.
- No ORM schema generation. Both services treat the schema as given; ORM entities, if used, map onto it.
- Migrations are forward-only. A mistake is fixed by a new migration, never by editing an applied one.
- The TS runner must take a Postgres advisory lock while migrating, so two instances starting at once (as in
  the time-travel setup) do not apply the same file twice. Flyway does this already.

## Alternatives considered

- **Per-service migrations** with the native tool: more idiomatic, but two schemas to keep equal.
- **Liquibase** for both (it has a Node wrapper): heavier, and XML/YAML changelogs are harder to review than SQL.
