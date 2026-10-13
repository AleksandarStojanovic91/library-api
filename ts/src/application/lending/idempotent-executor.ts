import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../domain/shared/domain-error';
import type { IdempotencyRepository, StoredResponse } from '../ports/repositories';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { requestHash } from './request-hash';

export interface IdempotentRequest {
  /** Token subject: keys are scoped per caller, so two members can use the same key. */
  readonly subject: string;
  readonly key: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface IdempotentOutcome {
  readonly response: StoredResponse;
  readonly replayed: boolean;
}

/**
 * Exactly-once semantics for unsafe requests (POST /loans).
 *
 * The key row is inserted first, in the same transaction as the work. A concurrent duplicate blocks on that
 * row's unique index until the first transaction ends, then finds the stored response and replays it.
 * The work itself runs in a savepoint: a business error (4xx) rolls back only the work while the key row
 * keeps the error response, so retries get the same answer. An unexpected error rolls back everything,
 * key included, so the client can safely retry.
 */
@Injectable()
export class IdempotentExecutor {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.IdempotencyRepository) private readonly store: IdempotencyRepository,
  ) {}

  async execute(
    request: IdempotentRequest,
    work: () => Promise<StoredResponse>,
    renderError: (error: DomainError) => StoredResponse,
  ): Promise<IdempotentOutcome> {
    const hash = requestHash(request.method, request.path, request.body);
    return this.tx.run(async () => {
      const isFirst = await this.store.tryInsert(request.subject, request.key, hash);
      if (!isFirst) {
        return { response: await this.storedResponse(request, hash), replayed: true };
      }
      let response: StoredResponse;
      try {
        response = await this.tx.run(work);
      } catch (error) {
        if (!(error instanceof DomainError)) {
          throw error;
        }
        response = renderError(error);
        if (response.status >= 500) {
          throw error;
        }
      }
      await this.store.saveResponse(request.subject, request.key, response);
      return { response, replayed: false };
    });
  }

  private async storedResponse(request: IdempotentRequest, hash: string): Promise<StoredResponse> {
    const record = await this.store.find(request.subject, request.key);
    if (record && record.requestHash !== hash) {
      throw new DomainError('idempotency-key-reused', 'This Idempotency-Key was already used with a different request.');
    }
    if (!record?.response) {
      // Only reachable if the first request's row disappeared (cleanup) or is still open in a
      // transaction we did not wait for; telling the client to retry is the honest answer.
      throw new DomainError('conflict', 'A request with this Idempotency-Key is still being processed; retry shortly.');
    }
    return record.response;
  }
}
