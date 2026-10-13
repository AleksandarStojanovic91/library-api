/**
 * Typed client for the Library API. Request and response types come from the contract
 * (src/generated/openapi.d.ts, produced by `npm run generate` with openapi-typescript).
 *
 * Negative tests that need to send something the types forbid use `unchecked(...)` or `api.http.send(...)`;
 * the response is still validated against the contract either way.
 */
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import type { components, operations } from '../generated/openapi';
import { HttpClient, type ApiResult, type SendOptions } from './http';

export type Schemas = components['schemas'];
export type Book = Schemas['Book'];
export type BookCreate = Schemas['BookCreate'];
export type BookUpdate = Schemas['BookUpdate'];
export type Author = Schemas['Author'];
export type Copy = Schemas['Copy'];
export type Member = Schemas['Member'];
export type Loan = Schemas['Loan'];
export type LoanV1 = Schemas['LoanV1'];
export type Reservation = Schemas['Reservation'];
export type Health = Schemas['Health'];
export type PageInfo = Schemas['PageInfo'];
export interface Page<T> {
  data: T[];
  page: PageInfo;
}

type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

/** Deliberately bypass request typing in a negative test. The response is still contract-checked. */
export function unchecked<T>(value: unknown): T {
  return value as T;
}

export interface IdempotencyOptions {
  /** Default: a fresh UUID. `null` omits the header. */
  idempotencyKey?: string | null;
}

export class LibraryApi {
  readonly http: HttpClient;

  constructor(request: APIRequestContext | HttpClient, token?: string) {
    this.http = request instanceof HttpClient ? request : new HttpClient(request, token);
  }

  get token(): string | undefined {
    return this.http.token;
  }

  /** Same connection, different identity. */
  as(token: string | undefined): LibraryApi {
    return new LibraryApi(this.http.withToken(token));
  }

  readonly auth = {
    token: (body: Schemas['TokenRequest']) => this.http.send<Schemas['TokenResponse']>('POST', '/api/v1/auth/token', { data: body }),
  };

  readonly books = {
    list: (query: Query<'listBooks'> = {}, opts?: SendOptions) =>
      this.http.send<Page<Book>>('GET', '/api/v1/books', { ...opts, params: query }),
    get: (id: string, opts: SendOptions & { ifNoneMatch?: string } = {}) =>
      this.http.send<Book>('GET', `/api/v1/books/${id}`, {
        ...opts,
        headers: { ...opts.headers, ...(opts.ifNoneMatch ? { 'If-None-Match': opts.ifNoneMatch } : {}) },
      }),
    create: (body: BookCreate, opts?: SendOptions) => this.http.send<Book>('POST', '/api/v1/books', { ...opts, data: body }),
    /** JSON merge patch. `ifMatch: null` omits the header. */
    update: (id: string, patch: BookUpdate, opts: SendOptions & { ifMatch: string | null; mediaType?: string }) =>
      this.http.send<Book>('PATCH', `/api/v1/books/${id}`, {
        ...opts,
        data: patch,
        contentType: opts.mediaType ?? 'application/merge-patch+json',
        headers: { ...opts.headers, ...(opts.ifMatch !== null ? { 'If-Match': opts.ifMatch } : {}) },
      }),
    delete: (id: string, opts?: SendOptions) => this.http.send<undefined>('DELETE', `/api/v1/books/${id}`, opts),
  };

  readonly copies = {
    list: (bookId: string, opts?: SendOptions) => this.http.send<{ data: Copy[] }>('GET', `/api/v1/books/${bookId}/copies`, opts),
    add: (bookId: string, body: Schemas['CopyCreate'], opts?: SendOptions) =>
      this.http.send<Copy>('POST', `/api/v1/books/${bookId}/copies`, { ...opts, data: body }),
  };

  readonly authors = {
    list: (query: Query<'listAuthors'> = {}, opts?: SendOptions) =>
      this.http.send<Page<Author>>('GET', '/api/v1/authors', { ...opts, params: query }),
    get: (id: string, opts?: SendOptions) => this.http.send<Author>('GET', `/api/v1/authors/${id}`, opts),
    create: (body: Schemas['AuthorCreate'], opts?: SendOptions) =>
      this.http.send<Author>('POST', '/api/v1/authors', { ...opts, data: body }),
  };

  readonly members = {
    list: (query: Query<'listMembers'> = {}, opts?: SendOptions) =>
      this.http.send<Page<Member>>('GET', '/api/v1/members', { ...opts, params: query }),
    me: (opts?: SendOptions) => this.http.send<Member>('GET', '/api/v1/members/me', opts),
    get: (id: string, opts?: SendOptions) => this.http.send<Member>('GET', `/api/v1/members/${id}`, opts),
    create: (body: Schemas['MemberCreate'], opts?: SendOptions) =>
      this.http.send<Member>('POST', '/api/v1/members', { ...opts, data: body }),
    /** Librarian only: suspend / reactivate, optionally change the loan limit. */
    setStatus: (id: string, body: Schemas['MemberStatusUpdate'], opts?: SendOptions) =>
      this.http.send<Member>('PUT', `/api/v1/members/${id}/status`, { ...opts, data: body }),
  };

  /** Current loans API. */
  readonly loans = this.loanApi<Loan>('/api/v2/loans');
  /** Deprecated loans API (same logic, v1 representation, Deprecation/Sunset headers). */
  readonly loansV1 = this.loanApi<LoanV1>('/api/v1/loans');

  readonly reservations = {
    list: (query: Query<'listReservations'> = {}, opts?: SendOptions) =>
      this.http.send<Page<Reservation>>('GET', '/api/v1/reservations', { ...opts, params: query }),
    create: (body: Schemas['ReservationCreate'], opts?: SendOptions) =>
      this.http.send<Reservation>('POST', '/api/v1/reservations', { ...opts, data: body }),
    cancel: (id: string, opts?: SendOptions) => this.http.send<undefined>('DELETE', `/api/v1/reservations/${id}`, opts),
  };

  readonly ops = {
    live: () => this.http.send<Health>('GET', '/health/live'),
    ready: () => this.http.send<Health>('GET', '/health/ready'),
    metrics: () => this.http.send<string>('GET', '/metrics', { accept: 'text/plain' }),
    openapi: () => this.http.send<string>('GET', '/openapi.yaml', { accept: 'application/yaml, text/yaml, */*' }),
    docs: () => this.http.send<string>('GET', '/docs', { accept: 'text/html' }),
  };

  private loanApi<L>(base: '/api/v1/loans' | '/api/v2/loans') {
    return {
      list: (query: Query<'listLoans'> = {}, opts?: SendOptions) =>
        this.http.send<Page<L>>('GET', base, { ...opts, params: query }),
      get: (id: string, opts?: SendOptions) => this.http.send<L>('GET', `${base}/${id}`, opts),
      borrow: (body: Schemas['LoanCreate'], opts: SendOptions & IdempotencyOptions = {}) => {
        const key = opts.idempotencyKey === undefined ? randomUUID() : opts.idempotencyKey;
        return this.http.send<L>('POST', base, {
          ...opts,
          data: body,
          headers: { ...opts.headers, ...(key !== null ? { 'Idempotency-Key': key } : {}) },
        });
      },
      return: (id: string, opts?: SendOptions) => this.http.send<L>('POST', `${base}/${id}/return`, opts),
    };
  }
}

export type { ApiResult };
