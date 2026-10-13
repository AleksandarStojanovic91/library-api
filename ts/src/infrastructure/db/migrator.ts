import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

export interface MigrationLog {
  info(message: string): void;
}

/** Arbitrary but fixed key: only one instance migrates at a time, the others wait and then find nothing to do. */
const ADVISORY_LOCK_KEY = 7_412_190_331;

/**
 * Applies db/migrations/*.sql in version order (V1, V2, ... V10), each file in its own transaction together
 * with its row in schema_migrations. Applied files are checksummed: editing one after it ran is an error,
 * as with Flyway on the Java side.
 */
export async function migrate(pool: Pool, directory: string, log: MigrationLog): Promise<string[]> {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

    const newlyApplied: string[] = [];
    for (const file of files) {
      const content = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');
      const previous = applied.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after it was applied (checksum mismatch)`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        // No parameters, so pg uses the simple query protocol, which allows many statements per call.
        await client.query(content);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      log.info(`Applied migration ${file}`);
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
