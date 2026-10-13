import { decodeCursor, encodeCursor, isTimestamp, isUuid } from '../../domain/shared/cursor';
import type { Page } from '../../domain/shared/page';
import type { CreatedKey, Keyed } from '../ports/repositories';

/**
 * Repositories return `limit + 1` rows; the extra row only tells us whether another page exists.
 * The cursor encodes the key of the last row actually returned.
 */
export function toPage<T, K>(rows: readonly Keyed<T, K>[], limit: number, encode: (key: K) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => row.item),
    limit,
    nextCursor: rows.length > limit && last ? encode(last.key) : null,
  };
}

type CreatedCursor = { c: string; id: string };

export function encodeCreatedKey(key: CreatedKey): string {
  return encodeCursor({ c: key.createdAt, id: key.id } satisfies CreatedCursor);
}

export function decodeCreatedKey(cursor: string | undefined): CreatedKey | null {
  if (cursor === undefined) {
    return null;
  }
  const { c, id } = decodeCursor<CreatedCursor>(cursor, { c: isTimestamp, id: isUuid });
  return { createdAt: c, id };
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string | undefined;
}
