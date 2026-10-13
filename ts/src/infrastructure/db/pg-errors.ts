interface PgError {
  readonly code: string;
  readonly constraint?: string;
}

/** Drizzle wraps driver errors (DrizzleQueryError), so look through the `cause` chain for the pg error. */
export function pgErrorOf(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current as PgError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorOf(error)?.code === '23503';
}
