export interface Page<T> {
  readonly items: readonly T[];
  readonly limit: number;
  readonly nextCursor: string | null;
}
