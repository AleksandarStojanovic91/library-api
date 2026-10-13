/**
 * Thin wrapper over Playwright's APIRequestContext.
 *
 * Every call:
 *  - sends a traceable X-Request-Id (grep the service logs for it when a test fails),
 *  - parses the body,
 *  - validates the response against contract/openapi.yaml and the cross-cutting rules of docs/SPEC.md,
 *    throwing a ContractViolation if anything is off. Tests therefore check the schema implicitly.
 */
import { randomUUID } from 'node:crypto';
import { test, type APIRequestContext } from '@playwright/test';
import { contract } from '../contract/contract';
import { checkSpecInvariants } from '../contract/spec-invariants';
import type { components } from '../generated/openapi';

export type Problem = components['schemas']['Problem'];
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface SendOptions {
  /** Objects are sent as JSON; strings are sent verbatim (for malformed-body tests). */
  data?: unknown;
  params?: QueryParams;
  headers?: Record<string, string>;
  contentType?: string;
  accept?: string;
  /** `null` sends no X-Request-Id; a string sends exactly that value. Default: a fresh valid id. */
  requestId?: string | null;
}

export class ContractViolation extends Error {
  override name = 'ContractViolation';
}

export class ApiResult<T> {
  constructor(
    readonly method: Method,
    readonly path: string,
    readonly url: string,
    readonly status: number,
    readonly headers: Record<string, string>,
    readonly text: string,
    readonly body: T,
    readonly sentHeaders: Record<string, string>,
  ) {}

  /** The body read as an RFC 9457 problem (only meaningful for 4xx/5xx). */
  get problem(): Problem {
    return this.body as unknown as Problem;
  }

  header(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  get requestId(): string | undefined {
    return this.headers['x-request-id'];
  }

  /** One-paragraph description used in assertion messages. */
  describe(): string {
    const body = this.text.length > 1500 ? `${this.text.slice(0, 1500)}…` : this.text;
    return `${this.method} ${this.url} -> ${this.status} (X-Request-Id: ${this.requestId ?? 'none'})\n${body || '(empty body)'}`;
  }
}

let counter = 0;
const runId = randomUUID().slice(0, 8);

function nextRequestId(): string {
  counter += 1;
  return `pw-${runId}-${process.pid}-${counter}`;
}

export class HttpClient {
  constructor(
    private readonly request: APIRequestContext,
    readonly token: string | undefined,
  ) {}

  withToken(token: string | undefined): HttpClient {
    return new HttpClient(this.request, token);
  }

  async send<T = unknown>(method: Method, path: string, options: SendOptions = {}): Promise<ApiResult<T>> {
    const requestId = options.requestId === undefined ? nextRequestId() : options.requestId;
    const headers: Record<string, string> = {
      Accept: options.accept ?? 'application/json, application/problem+json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(requestId !== null ? { 'X-Request-Id': requestId } : {}),
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
      ...options.headers,
    };
    const params = options.params
      ? (Object.fromEntries(Object.entries(options.params).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>)
      : undefined;

    const response = await this.request.fetch(path, {
      method,
      headers,
      params,
      data: options.data,
      failOnStatusCode: false,
      maxRedirects: 5,
    });

    const url = response.url();
    const pathname = new URL(url).pathname;
    const responseHeaders = response.headers();
    const contentType = responseHeaders['content-type'];
    const text = await response.text();
    const violations: string[] = [];

    let body: unknown = undefined;
    if (text && contentType && /[/+]json\b/.test(contentType)) {
      try {
        body = JSON.parse(text);
      } catch {
        violations.push(`Body is declared as ${contentType} but is not valid JSON`);
      }
    }

    const result = new ApiResult<T>(method, pathname, url, response.status(), responseHeaders, text, body as T, headers);

    const report = contract().check({ method, path: pathname, status: result.status, headers: responseHeaders, contentType, body, rawText: text });
    violations.push(...report.violations);
    violations.push(
      ...checkSpecInvariants({
        method,
        path: pathname,
        status: result.status,
        headers: responseHeaders,
        contentType,
        body,
        sentRequestId: requestId ?? undefined,
      }),
    );
    for (const gap of report.gaps) annotate('contract-gap', gap);

    if (violations.length > 0) {
      throw new ContractViolation(`${violations.map((m) => `  - ${m}`).join('\n')}\n\n${result.describe()}`);
    }
    return result;
  }
}

function annotate(type: string, description: string): void {
  try {
    const info = test.info();
    if (!info.annotations.some((a) => a.type === type && a.description === description)) {
      info.annotations.push({ type, description });
    }
  } catch {
    // called outside a running test (e.g. while a worker fixture logs in): nothing to annotate
  }
}
