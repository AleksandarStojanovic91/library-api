/**
 * Custom matchers that print the full request/response (with X-Request-Id) when they fail:
 *   expect(res).toHaveStatus(201)
 *   expect(res).toBeProblem(409, 'no-copy-available')
 *   expect(res).toBeProblem(400, 'validation-failed', { fields: ['isbn'] })
 *   expect(res).toBeDocumentedInContract()      // the status is listed for this operation (not a contract gap)
 * The generic problem rules (type URI, instance, requestId, status/code pairing) are already enforced on every
 * response by the API client, so these only check what the individual test cares about.
 */
import { expect as baseExpect } from '@playwright/test';
import type { ApiResult } from './client/http';
import { contract } from './contract/contract';

export interface ProblemExpectation {
  detail?: string | RegExp;
  /** Field names that must appear in `errors[].field` (others may appear too). */
  fields?: string[];
}

export const expect = baseExpect.extend({
  toHaveStatus(received: ApiResult<unknown>, expected: number | number[]) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    const pass = allowed.includes(received.status);
    return {
      pass,
      name: 'toHaveStatus',
      expected,
      actual: received.status,
      message: () =>
        `${this.utils.matcherHint('toHaveStatus', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `Expected status: ${this.isNot ? 'not ' : ''}${allowed.join(' or ')}\n` +
        `Received:        ${received.status}\n\n${received.describe()}`,
    };
  },

  toBeDocumentedInContract(received: ApiResult<unknown>) {
    const pass = contract().isDocumented(received.method, received.path, received.status);
    return {
      pass,
      name: 'toBeDocumentedInContract',
      expected: 'documented status',
      actual: received.status,
      message: () =>
        `${this.utils.matcherHint('toBeDocumentedInContract', undefined, undefined, { isNot: this.isNot })}\n\n` +
        `${received.method} ${received.path} -> ${received.status} is ${pass ? '' : 'not '}listed in contract/openapi.yaml\n\n${received.describe()}`,
    };
  },

  toBeProblem(received: ApiResult<unknown>, status: number, code: string, expected: ProblemExpectation = {}) {
    const problem = received.problem as Partial<{ code: string; detail: string; errors: { field: string }[] }> | undefined;
    const failures: string[] = [];
    if (received.status !== status) failures.push(`status ${received.status}, expected ${status}`);
    if (problem?.code !== code) failures.push(`code "${problem?.code}", expected "${code}"`);
    if (expected.detail !== undefined) {
      const ok =
        typeof expected.detail === 'string' ? problem?.detail === expected.detail : expected.detail.test(problem?.detail ?? '');
      if (!ok) failures.push(`detail "${problem?.detail}", expected ${String(expected.detail)}`);
    }
    if (expected.fields) {
      const got = (problem?.errors ?? []).map((e) => e.field);
      const missing = expected.fields.filter((f) => !got.includes(f));
      if (missing.length) failures.push(`errors[].field is [${got.join(', ')}], missing [${missing.join(', ')}]`);
    }
    const pass = failures.length === 0;
    return {
      pass,
      name: 'toBeProblem',
      expected: { status, code, ...expected },
      actual: problem,
      message: () =>
        `${this.utils.matcherHint('toBeProblem', undefined, undefined, { isNot: this.isNot })}\n\n` +
        (this.isNot ? `Expected the response NOT to be a ${status} "${code}" problem\n` : `Mismatch: ${failures.join('; ')}\n`) +
        `\n${received.describe()}`,
    };
  },
});
