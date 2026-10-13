export interface AuthorRef {
  readonly id: string;
  readonly name: string;
}

export interface Author {
  readonly id: string;
  readonly name: string;
  readonly bio: string | null;
  readonly createdAt: Date;
}

export interface Book {
  readonly id: string;
  readonly isbn: string;
  readonly title: string;
  readonly description: string | null;
  readonly publishedYear: number | null;
  readonly authors: readonly AuthorRef[];
  readonly tags: readonly string[];
  readonly totalCopies: number;
  readonly availableCopies: number;
  /** Optimistic-locking version, exposed as the ETag. */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewBook {
  readonly isbn: string;
  readonly title: string;
  readonly description: string | null;
  readonly publishedYear: number | null;
  readonly authorIds: readonly string[];
  readonly tags: readonly string[];
}

/**
 * JSON merge patch (RFC 7396) for a book: an absent field stays unchanged, `null` clears a nullable field,
 * and `authorIds` replaces the whole list.
 */
export interface BookPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly publishedYear?: number | null;
  readonly authorIds?: readonly string[];
  readonly tags?: readonly string[];
}

export const COPY_STATUSES = ['AVAILABLE', 'ON_LOAN', 'RESERVED', 'LOST'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export interface Copy {
  readonly id: string;
  readonly bookId: string;
  readonly barcode: string;
  readonly status: CopyStatus;
  readonly createdAt: Date;
}

/** A book cannot be deleted while any of its copies is lent out or held for a reservation. */
export function blocksBookDeletion(status: CopyStatus): boolean {
  return status === 'ON_LOAN' || status === 'RESERVED';
}
