import { config, seed } from '../../src/config';
import { decodeJwt, nowSeconds, signHs256, unsigned, withTamperedClaims } from '../../src/data/jwt';
import { unchecked } from '../../src/client/library-api';
import { expect, test } from '../../src/fixtures';

test.describe('auth: POST /api/v1/auth/token', () => {
  test('issues a 1-hour Bearer token whose claims identify the member', async ({ anon }) => {
    const res = await anon.auth.token({ email: seed.member.email, password: seed.member.password });

    expect(res).toHaveStatus(200);
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.expiresIn).toBe(3600);

    const { header, claims } = decodeJwt(res.body.accessToken);
    expect(header.alg).toBe('HS256');
    expect(claims).toMatchObject({ sub: seed.member.id, role: 'MEMBER', email: seed.member.email, iss: 'library-api' });
    expect(claims.exp! - claims.iat!).toBe(3600);
  });

  test('the librarian token carries the LIBRARIAN role', async ({ anon }) => {
    const res = await anon.auth.token({ email: seed.librarian.email, password: seed.librarian.password });
    expect(res).toHaveStatus(200);
    expect(decodeJwt(res.body.accessToken).claims.role).toBe('LIBRARIAN');
  });

  test('wrong password and unknown e-mail get the same 401, so accounts cannot be enumerated', async ({ anon }) => {
    const wrongPassword = await anon.auth.token({ email: seed.member.email, password: 'not-the-password' });
    const unknownEmail = await anon.auth.token({ email: 'nobody-here@library.test', password: 'not-the-password' });

    expect(wrongPassword).toBeProblem(401, 'unauthorized');
    expect(unknownEmail).toBeProblem(401, 'unauthorized');
    expect(unknownEmail.problem.title).toBe(wrongPassword.problem.title);
    expect(unknownEmail.problem.detail).toBe(wrongPassword.problem.detail);
  });

  test('rejects a body without the required fields, listing each one', async ({ anon }) => {
    const res = await anon.auth.token(unchecked({}));
    expect(res).toBeProblem(400, 'validation-failed', { fields: ['email', 'password'] });
  });

  test('rejects unknown properties in the body', async ({ anon }) => {
    const res = await anon.auth.token(unchecked({ email: seed.member.email, password: seed.member.password, role: 'LIBRARIAN' }));
    expect(res).toBeProblem(400, 'validation-failed');
  });
});

test.describe('auth: Bearer tokens on protected routes', () => {
  test('a missing token gives 401 with WWW-Authenticate: Bearer', async ({ anon }) => {
    const res = await anon.members.me();
    expect(res).toBeProblem(401, 'unauthorized');
    expect(res.header('www-authenticate')).toMatch(/^Bearer/);
  });

  test('a token that is not a JWT gives 401', async ({ anon }) => {
    expect(await anon.as('not-a-jwt').members.me()).toBeProblem(401, 'unauthorized');
  });

  test('a token signed with another secret gives 401', async ({ anon }) => {
    const forged = signHs256(
      { sub: seed.librarian.id, role: 'LIBRARIAN', email: seed.librarian.email, iss: 'library-api', iat: nowSeconds(), exp: nowSeconds() + 600 },
      'some-other-secret-that-is-long-enough-123',
    );
    expect(await anon.as(forged).members.me()).toBeProblem(401, 'unauthorized');
  });

  test('a token with alg "none" gives 401', async ({ anon }) => {
    const token = unsigned({ sub: seed.librarian.id, role: 'LIBRARIAN', iss: 'library-api', iat: nowSeconds(), exp: nowSeconds() + 600 });
    expect(await anon.as(token).members.me()).toBeProblem(401, 'unauthorized');
  });

  test('a member token whose role claim was edited to LIBRARIAN gives 401', async ({ anon, member }) => {
    const tampered = withTamperedClaims(member.token!, { role: 'LIBRARIAN' });
    expect(await anon.as(tampered).members.list()).toBeProblem(401, 'unauthorized');
  });

  test('an expired token gives 401', async ({ anon }) => {
    const claims = { sub: seed.member.id, role: 'MEMBER', email: seed.member.email, iss: 'library-api' };
    // Prove we know the server's secret first, otherwise the expiry check below would prove nothing.
    const fresh = signHs256({ ...claims, iat: nowSeconds(), exp: nowSeconds() + 600 }, config.jwtSecret);
    const control = await anon.as(fresh).members.me();
    test.skip(control.status !== 200, 'JWT_SECRET of the service differs from the one the suite knows');

    const expired = signHs256({ ...claims, iat: nowSeconds() - 7200, exp: nowSeconds() - 3600 }, config.jwtSecret);
    expect(await anon.as(expired).members.me()).toBeProblem(401, 'unauthorized');
  });

  test('public routes work without a token', async ({ anon }) => {
    expect(await anon.books.list({ limit: 1 })).toHaveStatus(200);
    expect(await anon.books.get(seed.books.cleanCode.id)).toHaveStatus(200);
    expect(await anon.copies.list(seed.books.cleanCode.id)).toHaveStatus(200);
    expect(await anon.authors.list({ limit: 1 })).toHaveStatus(200);
    expect(await anon.authors.get(seed.authors.kleppmann.id)).toHaveStatus(200);
  });

  test('GET /members/me returns the member behind the token', async ({ member, librarian }) => {
    const me = await member.members.me();
    expect(me).toHaveStatus(200);
    expect(me.body).toMatchObject({ id: seed.member.id, email: seed.member.email, role: 'MEMBER', status: 'ACTIVE' });

    const lib = await librarian.members.me();
    expect(lib.body).toMatchObject({ id: seed.librarian.id, role: 'LIBRARIAN' });
  });
});
