/**
 * POST /loans with Idempotency-Key: a retry with the same key replays the stored response instead of
 * borrowing twice. Scope is (token subject, key); the stored request hash covers method, path and body.
 */
import * as gen from '../../src/data/generators';
import { expect, test } from '../../src/fixtures';

test.describe('idempotency', () => {
  test('same key + same body replays status, body and Location, with Idempotent-Replayed: true', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const key = gen.idempotencyKey();

    const first = await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });
    const replay = await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });

    expect(first).toHaveStatus(201);
    expect(first.header('idempotent-replayed')).toBeUndefined();
    expect(replay).toHaveStatus(201);
    expect(replay.header('idempotent-replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(replay.header('location')).toBe(first.header('location'));

    // and only one copy was taken
    const loans = await who.api.loans.list();
    expect(loans.body.data.map((l) => l.id)).toEqual([first.body.id]);
  });

  test('the replay is the STORED response, even after the loan changed', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    const key = gen.idempotencyKey();
    const first = await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });
    expect(await who.api.loans.return(first.body.id)).toHaveStatus(200);

    const replay = await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });
    expect(replay).toHaveStatus(201);
    expect(replay.body).toEqual(first.body); // still ACTIVE: it is the original response, not a new borrow
    expect((await who.api.loans.list()).body.data).toHaveLength(1);
  });

  test('same key + different body is 422 idempotency-key-reused', async ({ factory }) => {
    const who = await factory.member();
    const { book: a } = await factory.book({ copies: 1 });
    const { book: b } = await factory.book({ copies: 1 });
    const key = gen.idempotencyKey();
    expect(await who.api.loans.borrow({ bookId: a.id }, { idempotencyKey: key })).toHaveStatus(201);

    const reused = await who.api.loans.borrow({ bookId: b.id }, { idempotencyKey: key });
    expect(reused).toBeProblem(422, 'idempotency-key-reused');
    expect((await who.api.members.me()).body.activeLoans).toBe(1);
  });

  test('the path is part of the request hash: the same key on v1 after v2 is 422', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 2 });
    const key = gen.idempotencyKey();
    expect(await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key })).toHaveStatus(201);
    expect(await who.api.loansV1.borrow({ bookId: book.id }, { idempotencyKey: key })).toBeProblem(422, 'idempotency-key-reused');
  });

  test('keys are scoped per member: another member using the same key gets their own loan', async ({ factory }) => {
    const [alice, bob] = await factory.members(2);
    const { book } = await factory.book({ copies: 2 });
    const key = gen.idempotencyKey();

    const forAlice = await alice.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });
    const forBob = await bob.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });

    expect(forBob).toHaveStatus(201);
    expect(forBob.header('idempotent-replayed')).toBeUndefined();
    expect(forBob.body.id).not.toBe(forAlice.body.id);
    expect(forBob.body.memberId).toBe(bob.member.id);
  });

  test('4xx responses are stored too: a retry after a copy appears still replays the 409', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book(); // no copies yet
    const key = gen.idempotencyKey();

    expect(await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key })).toBeProblem(409, 'no-copy-available');
    await factory.copy(book.id);

    const replay = await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key });
    expect(replay).toBeProblem(409, 'no-copy-available');
    expect(replay.header('idempotent-replayed')).toBe('true');

    // a new key does the work
    expect(await who.api.loans.borrow({ bookId: book.id })).toHaveStatus(201);
  });

  test('five concurrent requests with the same key create ONE loan; the others replay it', async ({ factory, anon }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 3 });
    const key = gen.idempotencyKey();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: key })),
    );

    for (const res of results) expect(res).toHaveStatus(201);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.header('idempotent-replayed') === 'true')).toHaveLength(4);
    expect((await who.api.members.me()).body.activeLoans).toBe(1);
    expect((await anon.books.get(book.id)).body.availableCopies).toBe(2);
  });

  test('Idempotency-Key shorter than 8 characters is 400', async ({ factory }) => {
    const who = await factory.member();
    const { book } = await factory.book({ copies: 1 });
    expect(await who.api.loans.borrow({ bookId: book.id }, { idempotencyKey: 'short' })).toBeProblem(400, 'validation-failed');
  });
});
