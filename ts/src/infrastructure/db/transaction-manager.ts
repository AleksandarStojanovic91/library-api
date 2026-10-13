import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AfterCommit, TransactionManager } from '../../application/ports/transaction-manager';
import { DATABASE, type Database, type Executor } from './database';

interface Scope {
  readonly executor: Executor;
  readonly hooks: AfterCommit[];
}

/**
 * Transaction propagation via AsyncLocalStorage: inside `run`, every repository call made in the same async
 * flow uses the transaction, without passing it through the application layer. Nested `run` calls use
 * Drizzle's nested transactions, i.e. SAVEPOINTs.
 */
@Injectable()
export class DrizzleTransactionManager implements TransactionManager {
  private readonly logger = new Logger(DrizzleTransactionManager.name);
  private readonly storage = new AsyncLocalStorage<Scope>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The executor repositories should use right now. */
  current(): Executor {
    return this.storage.getStore()?.executor ?? this.db;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const parent = this.storage.getStore();
    const hooks: AfterCommit[] = [];
    const runner = parent?.executor ?? this.db;
    // If `work` throws, Drizzle rolls the (sub)transaction back and rethrows; its hooks are dropped with it.
    const result = await runner.transaction((tx) => this.storage.run({ executor: tx, hooks }, work));
    if (parent) {
      parent.hooks.push(...hooks);
    } else {
      await this.runHooks(hooks);
    }
    return result;
  }

  afterCommit(hook: AfterCommit): void {
    const scope = this.storage.getStore();
    if (scope) {
      scope.hooks.push(hook);
    } else {
      void this.runHooks([hook]);
    }
  }

  /** Hooks are best-effort (cache eviction, metrics): the data is already committed, so a failure is logged. */
  private async runHooks(hooks: readonly AfterCommit[]): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.warn({ err: error }, 'After-commit hook failed');
      }
    }
  }
}
