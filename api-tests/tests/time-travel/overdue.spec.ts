/**
 * Time travel: overdue loans and fees.
 *
 * Two instances of the same implementation share one database:
 *   - "present" (BASE_URL)          CLOCK_OFFSET_SECONDS=0
 *   - "future"  (OVERDUE_BASE_URL)  CLOCK_OFFSET_SECONDS=OVERDUE_OFFSET_SECONDS (default 15.5 days)
 * A loan made in the present is 1.5 days overdue when the future instance looks at it.
 *
 * SPEC "Decisions" 3:
 *   overdueDays = floor(overdue seconds / 86400)                     (whole days late)
 *   fee         = ceil(overdue seconds / 86400) * FEE_CENTS_PER_DAY  (every started day costs)
 * With the default offset (LOAN_DAYS=14, FEE_CENTS_PER_DAY=50) a loan is 1.5 days + a few real seconds late:
 *   overdueDays = 1, fee = 2 started days = 100 cents = "1.00".
 *
 * SPEC "Decisions" 8: the offset shifts business time only. JWT iat/exp use real time, so a token issued by
 * the present instance is valid on the future one (tested at the end of this file).
 */
import { config, seed } from '../../src/config';
import { decodeJwt, nowSeconds } from '../../src/data/jwt';
import { expect, test } from '../../src/fixtures';

const DAY = 86_400;
// Real time passes between borrowing and checking (at least 1 s is assumed, at most a few minutes),
// so the loan is late by the offset beyond the due date plus that bit.
const overdueSeconds = config.overdueOffsetSeconds - config.loanDays * DAY + 1;
const expectedOverdueDays = Math.floor(overdueSeconds / DAY);
const expectedFeeCents = Math.ceil(overdueSeconds / DAY) * config.feeCentsPerDay;
const asMoney = (cents: number) => (cents / 100).toFixed(2);

test.describe('time travel: overdue loans', () => {
  test.skip(!config.overdueBaseUrl, 'OVERDUE_BASE_URL is not set (see api-tests/README.md, "Time travel")');

  test.beforeAll(() => {
    if (config.overdueBaseUrl && overdueSeconds <= 1) throw new Error('OVERDUE_OFFSET_SECONDS must be larger than LOAN_DAYS');
  });

  test('a loan from the present is OVERDUE in the future, with overdueDays and a running fee (v2)', async ({ factory, future }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    const later = await future.loginAs(who.email, who.password);

    const res = await later.loans.get(loan.id);

    expect(res).toHaveStatus(200);
    expect(res.body).toMatchObject({ status: 'OVERDUE', overdueDays: expectedOverdueDays });
    expect(res.body.fee).toEqual({ amount: asMoney(expectedFeeCents), currency: 'EUR' });

    // the present instance still sees an ordinary active loan
    const now = await who.api.loans.get(loan.id);
    expect(now.body).toMatchObject({ status: 'ACTIVE', overdueDays: 0 });
    expect(now.body.fee).toBeNull();
  });

  test('v1 shows the same loan as OVERDUE', async ({ factory, future }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    const later = await future.loginAs(who.email, who.password);
    expect((await later.loansV1.get(loan.id)).body.status).toBe('OVERDUE');
  });

  test('?status=OVERDUE is evaluated against the shifted clock (filtering happens in SQL)', async ({ factory, future }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    const later = await future.loginAs(who.email, who.password);

    expect((await later.loans.list({ status: 'OVERDUE' })).body.data.map((l) => l.id)).toEqual([loan.id]);
    expect((await later.loans.list({ status: 'ACTIVE' })).body.data).toEqual([]);
    expect((await who.api.loans.list({ status: 'OVERDUE' })).body.data).toEqual([]);
    expect((await who.api.loans.list({ status: 'ACTIVE' })).body.data.map((l) => l.id)).toEqual([loan.id]);
  });

  test('returning late charges FEE_CENTS_PER_DAY per started day (v1 feeCents, v2 fee)', async ({ factory, future }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    const later = await future.loginAs(who.email, who.password);

    const returned = await later.loansV1.return(loan.id);

    expect(returned).toHaveStatus(200);
    expect(returned.body).toMatchObject({ status: 'RETURNED', feeCents: expectedFeeCents });
    const v2 = await later.loans.get(loan.id);
    expect(v2.body.fee).toEqual({ amount: asMoney(expectedFeeCents), currency: 'EUR' });
    expect(v2.body.status).toBe('RETURNED');
  });

  test('returning on time (present instance) costs nothing', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const loan = await factory.loan(who, book.id);
    const returned = await who.api.loansV1.return(loan.id);
    expect(returned.body.feeCents).toBeNull();
  });

  test('the librarian sees overdue loans of all members in the future', async ({ factory, future }) => {
    const [a, b] = await factory.members(2);
    const { book } = await factory.book({ copies: 2 });
    const la = await factory.loan(a, book.id);
    const lb = await factory.loan(b, book.id);
    const overdueA = (await future.librarian.loans.list({ status: 'OVERDUE', memberId: a.member.id })).body.data;
    const overdueB = (await future.librarian.loans.list({ status: 'OVERDUE', memberId: b.member.id })).body.data;
    expect(overdueA.map((l) => l.id)).toEqual([la.id]);
    expect(overdueB.map((l) => l.id)).toEqual([lb.id]);
  });
});

test.describe('time travel: the clock offset does not touch tokens', () => {
  test.skip(!config.overdueBaseUrl, 'OVERDUE_BASE_URL is not set (see api-tests/README.md, "Time travel")');

  test('a token issued by the present instance is accepted by the time-shifted instance', async ({ member, future }) => {
    const res = await future.anon.as(member.token).members.me();
    expect(res).toHaveStatus(200);
    expect(res.body.id).toBe(seed.member.id);
  });

  test('tokens issued by the time-shifted instance carry real-time iat/exp (not shifted by the offset)', async ({ future }) => {
    const { claims } = decodeJwt(future.librarian.token!);
    expect(Math.abs(claims.iat! - nowSeconds())).toBeLessThan(5 * 60);
    expect(claims.exp! - claims.iat!).toBe(3600);
  });
});
