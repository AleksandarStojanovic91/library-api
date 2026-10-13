import { describe, expect, it } from 'vitest';
import { FeeCalculator } from '../../src/domain/lending/fee-calculator';
import { LoanPolicy } from '../../src/domain/lending/loan-policy';
import { DAY_MS } from '../../src/domain/shared/clock';

const due = new Date('2026-10-27T10:00:00.000Z');
const at = (ms: number) => new Date(due.getTime() + ms);
const policy = new LoanPolicy(14, new FeeCalculator(50));

describe('FeeCalculator', () => {
  const fees = new FeeCalculator(50);

  it('charges nothing (null, not 0) when returned on time or exactly at the due date', () => {
    expect(fees.feeCents(due, at(-1))).toBeNull();
    expect(fees.feeCents(due, due)).toBeNull();
  });

  it('charges every started overdue day', () => {
    expect(fees.feeCents(due, at(1))).toBe(50);
    expect(fees.feeCents(due, at(DAY_MS))).toBe(50);
    expect(fees.feeCents(due, at(DAY_MS + 1))).toBe(100);
    expect(fees.feeCents(due, at(1.5 * DAY_MS))).toBe(100);
    expect(fees.feeCents(due, at(10 * DAY_MS))).toBe(500);
  });

  it('a zero rate means no fee at all', () => {
    expect(new FeeCalculator(0).feeCents(due, at(3 * DAY_MS))).toBeNull();
  });
});

describe('LoanPolicy', () => {
  const open = { dueAt: due, returnedAt: null, feeCents: null };

  it('sets the due date LOAN_DAYS after borrowing', () => {
    expect(policy.dueAt(new Date('2026-10-13T10:00:00.000Z')).toISOString()).toBe(due.toISOString());
  });

  it('status: ACTIVE until the due instant, OVERDUE after, RETURNED once returned', () => {
    expect(policy.status(open, due)).toBe('ACTIVE');
    expect(policy.status(open, at(1))).toBe('OVERDUE');
    expect(policy.status({ ...open, returnedAt: at(5 * DAY_MS) }, at(9 * DAY_MS))).toBe('RETURNED');
  });

  it('overdueDays counts whole days (floor), measured at the return for returned loans', () => {
    expect(policy.overdueDays(open, at(-DAY_MS))).toBe(0);
    expect(policy.overdueDays(open, at(DAY_MS - 1))).toBe(0);
    expect(policy.overdueDays(open, at(1.5 * DAY_MS))).toBe(1);
    expect(policy.overdueDays({ ...open, returnedAt: at(2.5 * DAY_MS) }, at(30 * DAY_MS))).toBe(2);
  });

  it('current fee: projected while open, the stored fee once returned', () => {
    expect(policy.currentFeeCents(open, at(1.5 * DAY_MS))).toBe(100);
    expect(policy.currentFeeCents(open, at(-1))).toBeNull();
    expect(policy.currentFeeCents({ dueAt: due, returnedAt: at(DAY_MS), feeCents: 50 }, at(20 * DAY_MS))).toBe(50);
  });

  it('loan limit is reached at maxActiveLoans', () => {
    expect(policy.hasReachedLimit(2, 3)).toBe(false);
    expect(policy.hasReachedLimit(3, 3)).toBe(true);
  });
});
