import { Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** The root database or an open transaction/savepoint: repositories run their queries on whichever is current. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export const PG_POOL = Symbol('PgPool');
export const DATABASE = Symbol('Database');

export function createPool(connectionString: string, max: number): Pool {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'library-api-ts',
  });
  // An idle client losing its connection (e.g. Postgres restart) emits here; without a listener it would
  // crash the process. The pool replaces the client on the next checkout.
  pool.on('error', (error) => new Logger('PgPool').warn({ err: error }, 'Idle database client failed'));
  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}
