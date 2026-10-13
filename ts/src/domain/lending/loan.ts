export const LOAN_STATUSES = ['ACTIVE', 'OVERDUE', 'RETURNED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface Loan {
  readonly id: string;
  readonly bookId: string;
  readonly copyId: string;
  readonly memberId: string;
  readonly borrowedAt: Date;
  readonly dueAt: Date;
  readonly returnedAt: Date | null;
  readonly feeCents: number | null;
}

/** A loan plus the book and copy facts the v2 representation embeds. */
export interface LoanDetails extends Loan {
  readonly book: { readonly id: string; readonly title: string; readonly isbn: string };
  readonly copy: { readonly id: string; readonly barcode: string };
}
