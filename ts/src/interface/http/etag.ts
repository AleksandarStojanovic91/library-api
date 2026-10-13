import type { ExpectedVersion } from '../../application/catalog/book-catalog';

export function etagOf(version: number): string {
  return `"${version}"`;
}

const STRONG_VERSION_TAG = /^"(\d{1,9})"$/;

/**
 * If-Match (RFC 9110 §13.1.1) uses strong comparison: `*` or a list of strong tags. Weak or foreign tags
 * cannot match. Returns undefined when the header is absent (-> 428).
 */
export function parseIfMatch(header: string | undefined): ExpectedVersion | undefined {
  if (header === undefined || header.trim() === '') {
    return undefined;
  }
  if (header.trim() === '*') {
    return '*';
  }
  return header
    .split(',')
    .map((tag) => STRONG_VERSION_TAG.exec(tag.trim())?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number);
}

/** If-None-Match uses weak comparison: `W/"3"` matches `"3"`. */
export function ifNoneMatchMatches(header: string | undefined, version: number): boolean {
  if (header === undefined) {
    return false;
  }
  if (header.trim() === '*') {
    return true;
  }
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etagOf(version));
}
