import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so `{"a":1,"b":2}` and `{"b":2,"a":1}` hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** sha256 of `METHOD path canonical-json-body`: what "the same request" means for Idempotency-Key. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${path} ${canonicalJson(body)}`).digest('hex');
}
