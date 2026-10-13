import type { LoanDetails, LoanStatus } from '../../domain/lending/loan';
import type { LoanPolicy } from '../../domain/lending/loan-policy';

/** A loan with the values that depend on "now" already worked out, ready for either API version. */
export interface LoanView extends LoanDetails {
  readonly status: LoanStatus;
  readonly overdueDays: number;
  /** Stored fee once returned; for an open overdue loan, what returning it now would cost. */
  readonly currentFeeCents: number | null;
}

export function toLoanView(loan: LoanDetails, policy: LoanPolicy, now: Date): LoanView {
  return {
    ...loan,
    status: policy.status(loan, now),
    overdueDays: policy.overdueDays(loan, now),
    currentFeeCents: policy.currentFeeCents(loan, now),
  };
}
