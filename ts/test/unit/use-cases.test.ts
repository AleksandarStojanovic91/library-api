import { describe, expect, it } from 'vitest';
import { IssueToken } from '../../src/application/auth/issue-token';
import { IdempotentExecutor } from '../../src/application/lending/idempotent-executor';
import type { IdempotencyRecord, IdempotencyRepository, MemberRepository, StoredResponse } from '../../src/application/ports/repositories';
import type { PasswordHasher, Principal, TokenService } from '../../src/application/ports/services';
import type { TransactionManager } from '../../src/application/ports/transaction-manager';
import { DomainError } from '../../src/domain/shared/domain-error';

/** Use cases depend on ports only, so they are tested with in-memory fakes, no database. */

describe('IssueToken', () => {
  const member = { id: 'm-1', email: 'a@b.c', name: 'A', role: 'MEMBER' as const, status: 'ACTIVE' as const, maxActiveLoans: 3, createdAt: new Date() };
  const members = { findCredentials: async (email: string) => (email === 'a@b.c' ? { member, passwordHash: 'hash:secret' } : null) } as unknown as MemberRepository;
  const verified: string[] = [];
  const hasher: PasswordHasher = {
    hash: async (plain) => `hash:${plain}`,
    verify: async (plain, hash) => {
      verified.push(hash);
      return hash === `hash:${plain}`;
    },
  };
  const tokens: TokenService = {
    issue: async (p: Principal) => ({ accessToken: `token-for-${p.memberId}-${p.role}`, expiresIn: 3600 }),
    verify: async () => null,
  };
  const useCase = new IssueToken(members, hasher, tokens);

  it('issues a token for valid credentials', async () => {
    expect(await useCase.execute('a@b.c', 'secret')).toEqual({ accessToken: 'token-for-m-1-MEMBER', expiresIn: 3600 });
  });

  it('fails identically for a wrong password and an unknown e-mail, and still runs bcrypt for the unknown one', async () => {
    verified.length = 0;
    const wrong = await useCase.execute('a@b.c', 'nope').catch((e: DomainError) => e);
    const unknown = await useCase.execute('x@y.z', 'nope').catch((e: DomainError) => e);
    expect([wrong, unknown].map((e) => [(e as DomainError).code, (e as DomainError).message])).toEqual([
      ['unauthorized', 'Invalid e-mail or password.'],
      ['unauthorized', 'Invalid e-mail or password.'],
    ]);
    expect(verified).toHaveLength(2);
    expect(verified[1]).toMatch(/^\$2[aby]\$10\$/);
  });
});

describe('IdempotentExecutor', () => {
  /** Runs work directly; a nested run that throws discards its hooks, like a rolled-back savepoint. */
  const tx: TransactionManager = { run: (work) => work(), afterCommit: () => undefined };

  class InMemoryKeys implements IdempotencyRepository {
    readonly rows = new Map<string, { hash: string; response: StoredResponse | null }>();
    async tryInsert(subject: string, key: string, hash: string) {
      if (this.rows.has(`${subject}|${key}`)) return false;
      this.rows.set(`${subject}|${key}`, { hash, response: null });
      return true;
    }
    async find(subject: string, key: string): Promise<IdempotencyRecord | null> {
      const row = this.rows.get(`${subject}|${key}`);
      return row ? { requestHash: row.hash, response: row.response } : null;
    }
    async saveResponse(subject: string, key: string, response: StoredResponse) {
      this.rows.get(`${subject}|${key}`)!.response = response;
    }
    async deleteOlderThan() {
      return 0;
    }
  }

  const request = { subject: 'm-1', key: 'key-12345', method: 'POST', path: '/api/v2/loans', body: { bookId: 'b-1' } };
  const renderError = (e: DomainError): StoredResponse => ({ status: 409, body: { code: e.code }, headers: {} });

  it('does the work once and replays the stored response', async () => {
    const executor = new IdempotentExecutor(tx, new InMemoryKeys());
    let calls = 0;
    const work = async (): Promise<StoredResponse> => ({ status: 201, body: { id: `loan-${++calls}` }, headers: { Location: '/x' } });
    const first = await executor.execute(request, work, renderError);
    const second = await executor.execute(request, work, renderError);
    expect(calls).toBe(1);
    expect(first).toEqual({ response: { status: 201, body: { id: 'loan-1' }, headers: { Location: '/x' } }, replayed: false });
    expect(second).toEqual({ ...first, replayed: true });
  });

  it('stores business errors (4xx) and replays them', async () => {
    const executor = new IdempotentExecutor(tx, new InMemoryKeys());
    const failing = async (): Promise<StoredResponse> => {
      throw new DomainError('no-copy-available', 'none');
    };
    await executor.execute(request, failing, renderError);
    const replay = await executor.execute(request, async () => ({ status: 201, body: {}, headers: {} }), renderError);
    expect(replay).toEqual({ response: { status: 409, body: { code: 'no-copy-available' }, headers: {} }, replayed: true });
  });

  it('422 when the key comes back with a different body', async () => {
    const executor = new IdempotentExecutor(tx, new InMemoryKeys());
    const work = async (): Promise<StoredResponse> => ({ status: 201, body: {}, headers: {} });
    await executor.execute(request, work, renderError);
    await expect(executor.execute({ ...request, body: { bookId: 'b-2' } }, work, renderError)).rejects.toMatchObject({ code: 'idempotency-key-reused' });
  });

  it('does not store unexpected errors, so the client can retry', async () => {
    const keys = new InMemoryKeys();
    // A real transaction would roll the key row back; emulate that by removing it when run() throws.
    const rollingBack: TransactionManager = {
      run: async (work) => {
        const snapshot = new Map(keys.rows);
        try {
          return await work();
        } catch (error) {
          keys.rows.clear();
          snapshot.forEach((v, k) => keys.rows.set(k, v));
          throw error;
        }
      },
      afterCommit: () => undefined,
    };
    const executor = new IdempotentExecutor(rollingBack, keys);
    await expect(executor.execute(request, async () => Promise.reject(new Error('db down')), renderError)).rejects.toThrow('db down');
    expect(keys.rows.size).toBe(0);
  });
});
