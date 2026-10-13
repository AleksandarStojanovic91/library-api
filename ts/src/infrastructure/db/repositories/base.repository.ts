import { Inject } from '@nestjs/common';
import type { Executor } from '../database';
import { DrizzleTransactionManager } from '../transaction-manager';

export abstract class DrizzleRepository {
  constructor(@Inject(DrizzleTransactionManager) private readonly transactions: DrizzleTransactionManager) {}

  /** The current transaction if one is open in this async flow, otherwise the pool. */
  protected get db(): Executor {
    return this.transactions.current();
  }
}
