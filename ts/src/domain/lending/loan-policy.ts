import { DAY_MS } from '../shared/clock';
import type { FeeCalculator } from './fee-calculator';
import type { Loan, LoanStatus } from './loan';

type LoanTimes = Pick<Loan, 'dueAt' | 'returnedAt' | 'feeCents'>;

/** Lending rules that depend only on the loan and "now"; no I/O, so they are unit tested directly. */
export class LoanPolicy {
  constructor(
    private readonly loanDays: number,
    private readonly fees: FeeCalculator,
  ) {
    if (!Number.isSafeInteger(loanDays) || loanDays < 1) {
      throw new RangeError('loanDays must be a positive integer');
    }
  }

  dueAt(borrowedAt: Date): Date {
    return new Date(borrowedAt.getTime() + this.loanDays * DAY_MS);
  }

  hasReachedLimit(openLoans: number, maxActiveLoans: number): boolean {
    return openLoans >= maxActiveLoans;
  }

  status(loan: LoanTimes, now: Date): LoanStatus {
    if (loan.returnedAt !== null) {
      return 'RETURNED';
    }
    return now.getTime() > loan.dueAt.getTime() ? 'OVERDUE' : 'ACTIVE';
  }

  /** Whole days late: measured at the return for returned loans, at `now` for open ones. */
  overdueDays(loan: LoanTimes, now: Date): number {
    const end = loan.returnedAt ?? now;
    const lateMs = end.getTime() - loan.dueAt.getTime();
    return lateMs > 0 ? Math.floor(lateMs / DAY_MS) : 0;
  }

  /** Fee charged at return time. */
  feeOnReturn(loan: Pick<Loan, 'dueAt'>, returnedAt: Date): number | null {
    return this.fees.feeCents(loan.dueAt, returnedAt);
  }

  /** The stored fee for a returned loan, or what it would cost to return an open loan right now. */
  currentFeeCents(loan: LoanTimes, now: Date): number | null {
    if (loan.returnedAt !== null) {
      return loan.feeCents;
    }
    return this.fees.feeCents(loan.dueAt, now);
  }
}
