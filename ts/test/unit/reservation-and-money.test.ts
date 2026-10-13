import { describe, expect, it } from 'vitest';
import { ReservationPolicy } from '../../src/domain/lending/reservation';
import { assertMayBorrowOrReserve } from '../../src/domain/members/member';
import type { DomainError } from '../../src/domain/shared/domain-error';
import { centsToMoney } from '../../src/domain/shared/money';

describe('ReservationPolicy', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');

  it('holds a returned copy for RESERVATION_HOLD_HOURS', () => {
    expect(new ReservationPolicy(48).holdUntil(now).toISOString()).toBe('2026-10-15T12:00:00.000Z');
  });

  it('only WAITING and READY reservations are open and cancellable', () => {
    expect(['WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'].map((s) => ReservationPolicy.isCancellable(s as never))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('a READY hold expires strictly after ready_until', () => {
    const ready = { status: 'READY' as const, readyUntil: now };
    expect(ReservationPolicy.isExpired(ready, now)).toBe(false);
    expect(ReservationPolicy.isExpired(ready, new Date(now.getTime() + 1))).toBe(true);
    expect(ReservationPolicy.isExpired({ status: 'WAITING', readyUntil: null }, new Date(now.getTime() + 1))).toBe(false);
  });
});

describe('members', () => {
  it('a suspended member may not borrow or reserve', () => {
    expect(() => assertMayBorrowOrReserve({ status: 'ACTIVE' })).not.toThrow();
    expect(() => assertMayBorrowOrReserve({ status: 'SUSPENDED' })).toThrow(expect.objectContaining({ code: 'member-suspended' }) as DomainError);
  });
});

describe('Money', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [50, '0.50'],
    [150, '1.50'],
    [123456, '1234.56'],
  ])('%i cents is %s EUR', (cents, amount) => {
    expect(centsToMoney(cents)).toEqual({ amount, currency: 'EUR' });
  });

  it('rejects negative and fractional cents', () => {
    expect(() => centsToMoney(-1)).toThrow(RangeError);
    expect(() => centsToMoney(1.5)).toThrow(RangeError);
  });
});
