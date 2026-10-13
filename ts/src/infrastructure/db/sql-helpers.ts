import { sql, type SQL } from 'drizzle-orm';

/**
 * Timestamp as ISO text with microseconds. Postgres stores microseconds but a JS Date keeps milliseconds,
 * so a cursor built from a Date could point *before* the last row and repeat it on the next page.
 */
export function microsText(column: SQL): SQL {
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function whereAll(conditions: readonly SQL[]): SQL {
  return conditions.length === 0 ? sql`TRUE` : sql.join(conditions.map((c) => sql`(${c})`), sql` AND `);
}

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function toNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}
