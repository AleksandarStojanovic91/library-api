import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, TestApp } from './support/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
});
afterAll(() => t.close());

describe('auth', () => {
  it('issues an HS256 bearer token for valid credentials', async () => {
    const res = await t.request('POST', '/api/v1/auth/token', { body: { email: SEED.member.email, password: SEED.member.password } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600 });
    const claims = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ sub: SEED.member.id, role: 'MEMBER', email: SEED.member.email, iss: 'library-api' });
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('answers a wrong password and an unknown e-mail identically (no user enumeration)', async () => {
    const wrongPassword = await t.request('POST', '/api/v1/auth/token', { body: { email: SEED.member.email, password: 'nope' } });
    const unknownEmail = await t.request('POST', '/api/v1/auth/token', { body: { email: 'ghost@library.test', password: 'nope' } });
    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthorized');
    }
    expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
  });

  it('401 with WWW-Authenticate for a missing or invalid token on a protected route', async () => {
    for (const token of [undefined, 'not-a-jwt']) {
      const res = await t.request('GET', '/api/v1/members/me', { token });
      expect(res.status).toBe(401);
      expect(res.header('www-authenticate')).toMatch(/^Bearer/);
      expect(res.body.code).toBe('unauthorized');
    }
  });

  it('403 when a member calls a librarian-only route', async () => {
    const member = await t.newMember();
    const res = await t.request('GET', '/api/v1/members', { token: member.token });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it("404, not 403, when a member asks for someone else's member record or loan", async () => {
    const [alice, bob] = [await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    const loan = await t.borrow(alice.token, book.id);
    expect((await t.request('GET', `/api/v1/members/${alice.id}`, { token: bob.token })).status).toBe(404);
    expect((await t.request('GET', `/api/v2/loans/${loan.body.id}`, { token: bob.token })).status).toBe(404);
    expect((await t.request('POST', `/api/v2/loans/${loan.body.id}/return`, { token: bob.token })).status).toBe(404);
    expect((await t.request('GET', `/api/v2/loans/${loan.body.id}`, { token: alice.token })).status).toBe(200);
  });

  it('403 when a member passes memberId on POST /loans; librarians may', async () => {
    const [member, other] = [await t.newMember(), await t.newMember()];
    const book = await t.newBook({ copies: 1 });
    expect((await t.borrow(member.token, book.id, { memberId: other.id })).body.code).toBe('forbidden');
    const res = await t.borrow(await t.librarian(), book.id, { memberId: other.id });
    expect(res.status).toBe(201);
    expect(res.body.memberId).toBe(other.id);
  });

  it('suspended members can log in and read, but not borrow or reserve', async () => {
    const member = await t.newMember();
    const book = await t.newBook({ copies: 1 });
    const suspend = await t.request('PUT', `/api/v1/members/${member.id}/status`, { token: await t.librarian(), body: { status: 'SUSPENDED' } });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe('SUSPENDED');
    const token = await t.login(member.email, 'password-1234');
    expect((await t.request('GET', '/api/v1/members/me', { token })).status).toBe(200);
    expect((await t.borrow(token, book.id)).body.code).toBe('member-suspended');
    expect((await t.request('POST', '/api/v1/reservations', { token, body: { bookId: book.id } })).body.code).toBe('member-suspended');
  });
});

describe('problem details', () => {
  it('every error is application/problem+json with type, fixed title, instance and requestId', async () => {
    const res = await t.request('GET', '/api/v1/books/00000000-0000-4000-8000-0000000000ff', { headers: { 'x-request-id': 'trace-abc-123' } });
    expect(res.status).toBe(404);
    expect(res.header('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'https://library.example/problems/not-found',
      title: 'Resource not found',
      status: 404,
      detail: 'Book was not found.',
      instance: '/api/v1/books/00000000-0000-4000-8000-0000000000ff',
      code: 'not-found',
      requestId: 'trace-abc-123',
    });
  });

  it('unknown routes are 404 not-found problems', async () => {
    const res = await t.request('GET', '/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not-found', instance: '/api/v1/does-not-exist' });
  });

  it('lists every failing field, JSON-pointer style, and rejects unknown properties', async () => {
    const res = await t.request('POST', '/api/v1/books', {
      token: await t.librarian(),
      body: { isbn: '9780132350885', title: '', authorIds: [SEED.authorId, 'bad'], tags: ['ok', ''], colour: 'red' },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation-failed');
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['authorIds.1', 'colour', 'isbn', 'tags.1', 'title']);
  });

  it('malformed JSON is 400 with detail "Malformed JSON body"', async () => {
    const res = await t.request('POST', '/api/v1/books', { token: await t.librarian(), rawBody: '{"isbn": ' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation-failed', detail: 'Malformed JSON body' });
  });

  it('a JSON body that is not an object cannot be read either', async () => {
    for (const rawBody of ['"just a string"', '[1, 2, 3]']) {
      const res = await t.request('POST', '/api/v1/books', { token: await t.librarian(), rawBody });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'validation-failed', detail: 'Malformed JSON body' });
    }
  });

  it('passwords are limited to 72 bytes (bcrypt), counted in UTF-8', async () => {
    const register = (password: string) =>
      t.librarian().then((token) =>
        t.request('POST', '/api/v1/members', { token, body: { email: `p-${Date.now()}-${password.length}@test.example`, name: 'P', password } }),
      );
    expect((await register('a'.repeat(72))).status).toBe(201);
    expect((await register('a'.repeat(73))).body.errors).toEqual([expect.objectContaining({ field: 'password' })]);
    expect((await register('é'.repeat(40))).status).toBe(400); // 40 characters, 80 bytes
  });

  it('a malformed id in the path is 400 on that parameter', async () => {
    const res = await t.request('GET', '/api/v1/books/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'bookId', message: 'Must be a UUID' }]);
  });
});

describe('X-Request-Id', () => {
  it('echoes a valid client id and replaces an invalid one with a UUID', async () => {
    expect((await t.request('GET', '/health/live', { headers: { 'x-request-id': 'abcd-1234' } })).header('x-request-id')).toBe('abcd-1234');
    const generated = (await t.request('GET', '/health/live', { headers: { 'x-request-id': 'bad id!' } })).header('x-request-id');
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });
});
