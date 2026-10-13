export type AfterCommit = () => void | Promise<void>;

/**
 * Runs work in a database transaction that repositories pick up implicitly (no `tx` parameter threading).
 * A nested `run` becomes a savepoint: if it throws, only its own changes (and after-commit hooks) are undone.
 */
export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Registers a side effect (cache eviction, metrics) to run only once the outermost transaction commits,
   * so readers never observe it before the data change is visible. Runs immediately outside a transaction.
   */
  afterCommit(hook: AfterCommit): void;
}
