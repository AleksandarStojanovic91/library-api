import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../../src/bootstrap';
import { loadConfig } from '../../../src/config/app-config';
import { isbn13CheckDigit } from '../../../src/domain/catalog/isbn';
import { PG_POOL } from '../../../src/infrastructure/db/database';
import { WorkerRunner } from '../../../src/infrastructure/scheduling/worker-runner';

export const SEED = {
  librarian: { id: '00000000-0000-4000-8000-000000000001', email: 'librarian@library.test', password: 'librarian-pass-123' },
  member: { id: '00000000-0000-4000-8000-000000000002', email: 'member@library.test', password: 'member-pass-123' },
  member2: { id: '00000000-0000-4000-8000-000000000003', email: 'member2@library.test', password: 'member2-pass-123' },
  authorId: '10000000-0000-4000-8000-000000000001',
  cleanCodeId: '20000000-0000-4000-8000-000000000001',
} as const;

export interface HttpResult<T = any> {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: T;
  header(name: string): string | undefined;
}

export interface RequestOptions {
  token?: string | undefined;
  body?: unknown;
  /** Sent as-is (for malformed JSON tests). */
  rawBody?: string;
  headers?: Record<string, string>;
}

/** A started application plus helpers. Requests go through `app.inject()`: the full stack, no network. */
export class TestApp {
  private constructor(
    readonly app: NestFastifyApplication,
    readonly databaseUrl: string,
  ) {}

  static async start(env: Record<string, string> = {}, databaseUrl?: string): Promise<TestApp> {
    const url = databaseUrl ?? (await createTestDatabase());
    const config = loadConfig({
      DATABASE_URL: url,
      REDIS_URL: inject('redisUrl'),
      LOG_LEVEL: 'silent',
      WORKER_INTERVAL_MS: '0',
      RATE_LIMIT_PER_MINUTE: '100000',
      ...env,
    });
    return new TestApp(await createApp(config), url);
  }

  /** A second instance on the same database, e.g. with CLOCK_OFFSET_SECONDS (time travel, as in the shared suite). */
  startSibling(env: Record<string, string>): Promise<TestApp> {
    return TestApp.start(env, this.databaseUrl);
  }

  async request<T = any>(method: string, url: string, options: RequestOptions = {}): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers['authorization'] = `Bearer ${options.token}`;
    let payload: string | undefined;
    if (options.rawBody !== undefined) payload = options.rawBody;
    else if (options.body !== undefined) payload = JSON.stringify(options.body);
    if (payload !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    const response = await this.app.inject({ method: method as 'GET', url, headers, ...(payload !== undefined && { payload }) });
    const text = response.body;
    let body: unknown = text;
    if (text && /json/.test(String(response.headers['content-type']))) body = JSON.parse(text);
    return {
      status: response.statusCode,
      headers: response.headers as Record<string, string | string[] | undefined>,
      body: body as T,
      header: (name) => {
        const value = response.headers[name.toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : value === undefined ? undefined : String(value);
      },
    };
  }

  async login(email: string, password: string): Promise<string> {
    const res = await this.request('POST', '/api/v1/auth/token', { body: { email, password } });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return res.body.accessToken as string;
  }

  librarian(): Promise<string> {
    return this.login(SEED.librarian.email, SEED.librarian.password);
  }

  /** A fresh member, so tests never share loan limits or reservations. */
  async newMember(options: { maxActiveLoans?: number } = {}): Promise<{ id: string; email: string; token: string }> {
    const email = `m-${randomUUID()}@test.example`;
    const res = await this.request('POST', '/api/v1/members', {
      token: await this.librarian(),
      body: { email, name: 'Test Member', password: 'password-1234', ...options },
    });
    if (res.status !== 201) throw new Error(`member creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.id, email, token: await this.login(email, 'password-1234') };
  }

  /** A fresh book with `copies` copies. */
  async newBook(options: { copies?: number; title?: string; publishedYear?: number; tags?: string[] } = {}): Promise<{ id: string; title: string }> {
    const token = await this.librarian();
    const title = options.title ?? `Test Book ${randomUUID()}`;
    const res = await this.request('POST', '/api/v1/books', {
      token,
      body: {
        isbn: randomIsbn(),
        title,
        authorIds: [SEED.authorId],
        ...(options.publishedYear !== undefined && { publishedYear: options.publishedYear }),
        ...(options.tags && { tags: options.tags }),
      },
    });
    if (res.status !== 201) throw new Error(`book creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    for (let i = 0; i < (options.copies ?? 0); i++) {
      const copy = await this.request('POST', `/api/v1/books/${res.body.id}/copies`, { token, body: { barcode: randomBarcode() } });
      if (copy.status !== 201) throw new Error(`copy creation failed: ${copy.status}`);
    }
    return { id: res.body.id, title };
  }

  borrow(token: string, bookId: string, options: { version?: 'v1' | 'v2'; key?: string; memberId?: string } = {}): Promise<HttpResult> {
    return this.request('POST', `/api/${options.version ?? 'v2'}/loans`, {
      token,
      headers: { 'idempotency-key': options.key ?? randomUUID() },
      body: { bookId, ...(options.memberId && { memberId: options.memberId }) },
    });
  }

  /** Direct SQL through the app's own pool, for facts the API does not expose (notifications, row counts). */
  async query<R extends Record<string, unknown> = Record<string, any>>(text: string, params: unknown[] = []): Promise<R[]> {
    return (await this.app.get<Pool>(PG_POOL).query<R>(text, params)).rows;
  }

  runWorker(): Promise<Record<string, number>> {
    return this.app.get(WorkerRunner).tick();
  }

  close(): Promise<void> {
    return this.app.close();
  }
}

/** A fresh database per test file when we own the server; otherwise the shared one. */
async function createTestDatabase(): Promise<string> {
  const base = inject('databaseUrl');
  if (!inject('isolatedDatabases')) return base;
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: base, max: 1 });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

export function randomIsbn(): string {
  const first12 = `978${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${first12}${isbn13CheckDigit(first12)}`;
}

export function randomBarcode(): string {
  return `T-${randomUUID().slice(0, 18).toUpperCase()}`;
}
