/** Stable, machine-readable error codes. They are part of the public contract (Problem.code). */
export const ERROR_CODES = [
  'validation-failed',
  'unauthorized',
  'forbidden',
  'not-found',
  'conflict',
  'duplicate',
  'no-copy-available',
  'loan-limit-reached',
  'member-suspended',
  'already-returned',
  'book-has-active-loans',
  'book-has-loan-history',
  'already-reserved',
  'copy-available',
  'reservation-not-cancellable',
  'precondition-failed',
  'precondition-required',
  'idempotency-key-reused',
  'rate-limited',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/**
 * An expected failure of a business operation. Every layer throws this one type; the HTTP layer maps
 * `code` to a status and a problem+json body, so no layer below it knows about HTTP.
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = 'DomainError';
  }

  static notFound(what: string): DomainError {
    return new DomainError('not-found', `${what} was not found.`);
  }

  static validation(fieldErrors: readonly FieldError[], message = 'The request is not valid.'): DomainError {
    return new DomainError('validation-failed', message, fieldErrors);
  }

  static forbidden(message = 'You are not allowed to perform this action.'): DomainError {
    return new DomainError('forbidden', message);
  }
}
