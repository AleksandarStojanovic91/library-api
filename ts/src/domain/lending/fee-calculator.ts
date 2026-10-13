import { DAY_MS } from '../shared/clock';

/** Late fee: every started overdue day costs `centsPerDay`. */
export class FeeCalculator {
  constructor(private readonly centsPerDay: number) {
    if (!Number.isSafeInteger(centsPerDay) || centsPerDay < 0) {
      throw new RangeError('centsPerDay must be a non-negative integer');
    }
  }

  /** Fee in cents for a copy returned at `returnedAt`, or null when it was not late (a zero fee is no fee). */
  feeCents(dueAt: Date, returnedAt: Date): number | null {
    const overdueMs = returnedAt.getTime() - dueAt.getTime();
    if (overdueMs <= 0) {
      return null;
    }
    const fee = Math.ceil(overdueMs / DAY_MS) * this.centsPerDay;
    return fee === 0 ? null : fee;
  }
}
