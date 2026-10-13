// Shared helpers for the k6 scripts. Plain JavaScript (k6 runs it in its own runtime, not Node).
import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
export const RESULTS_DIR = (__ENV.RESULTS_DIR || 'perf/results').replace(/\/$/, '');
export const IMPL = __ENV.IMPL || (BASE_URL.endsWith(':8082') ? 'ts' : BASE_URL.endsWith(':8081') ? 'java' : 'custom');

export const LIBRARIAN = {
  email: __ENV.LIBRARIAN_EMAIL || 'librarian@library.test',
  password: __ENV.LIBRARIAN_PASSWORD || 'librarian-pass-123',
};

/** Budgets every script shares: p95 under 300 ms, under 1% failed requests, checks almost always pass. */
export const BASE_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<300'],
  checks: ['rate>0.99'],
};

const ACCEPT = 'application/json, application/problem+json';

export function params(name, token, extraHeaders) {
  const headers = Object.assign({ Accept: ACCEPT, 'Content-Type': 'application/json' }, extraHeaders || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  // `name` groups URLs with ids into one time series, e.g. "GET /api/v1/books/:id"
  return { headers, tags: { name } };
}

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Random ISBN-13 with a valid check digit. */
export function isbn13() {
  let digits = '978';
  for (let i = 0; i < 9; i++) digits += Math.floor(Math.random() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return digits + ((10 - (sum % 10)) % 10);
}

export function login(email, password) {
  const res = http.post(`${BASE_URL}/api/v1/auth/token`, JSON.stringify({ email, password }), params('POST /api/v1/auth/token'));
  if (res.status !== 200) fail(`login ${email} failed: ${res.status} ${res.body}`);
  return res.json('accessToken');
}

/** Creates a book with `copies` copies as the librarian; returns its id. */
export function createBook(librarianToken, title, copies) {
  const res = http.post(
    `${BASE_URL}/api/v1/books`,
    JSON.stringify({ isbn: isbn13(), title, authorIds: ['10000000-0000-4000-8000-000000000004'], tags: ['perf'] }),
    params('POST /api/v1/books', librarianToken),
  );
  if (res.status !== 201) fail(`create book failed: ${res.status} ${res.body}`);
  const id = res.json('id');
  for (let i = 0; i < copies; i++) {
    const barcode = `PERF-${uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
    const c = http.post(`${BASE_URL}/api/v1/books/${id}/copies`, JSON.stringify({ barcode }), params('POST /api/v1/books/:id/copies', librarianToken));
    if (c.status !== 201) fail(`add copy failed: ${c.status} ${c.body}`);
  }
  return id;
}

/** Registers `count` members (maxActiveLoans 10) and returns their tokens. */
export function createMembers(librarianToken, count) {
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const email = `perf-${uuidv4()}@perf.library.test`;
    const password = `perf-${uuidv4()}`;
    const res = http.post(
      `${BASE_URL}/api/v1/members`,
      JSON.stringify({ email, password, name: `Perf ${i}`, maxActiveLoans: 10 }),
      params('POST /api/v1/members', librarianToken),
    );
    if (res.status !== 201) fail(`create member failed: ${res.status} ${res.body}`);
    tokens.push(login(email, password));
  }
  return tokens;
}

/** Borrow (v2, with an Idempotency-Key), replay the same request once, then return the loan. */
export function borrowReplayReturn(token, bookId) {
  const key = uuidv4();
  const body = JSON.stringify({ bookId });
  const borrow = http.post(`${BASE_URL}/api/v2/loans`, body, params('POST /api/v2/loans', token, { 'Idempotency-Key': key }));
  const borrowed = check(borrow, {
    'borrow: 201': (r) => r.status === 201,
    'borrow: has copy': (r) => r.status === 201 && !!r.json('copy.id'),
  });
  if (!borrowed) return;

  const replay = http.post(`${BASE_URL}/api/v2/loans`, body, params('POST /api/v2/loans (replay)', token, { 'Idempotency-Key': key }));
  check(replay, {
    'replay: 201': (r) => r.status === 201,
    'replay: Idempotent-Replayed': (r) => r.headers['Idempotent-Replayed'] === 'true',
    'replay: same loan': (r) => r.status === 201 && r.json('id') === borrow.json('id'),
  });

  const ret = http.post(`${BASE_URL}/api/v2/loans/${borrow.json('id')}/return`, null, params('POST /api/v2/loans/:id/return', token));
  check(ret, { 'return: 200 RETURNED': (r) => r.status === 200 && r.json('status') === 'RETURNED' });
}

function fmt(ms) {
  return ms === undefined ? '-' : `${ms.toFixed(1)} ms`;
}

/**
 * handleSummary factory: writes <RESULTS_DIR>/<name>-<impl>.json (full k6 data) and .md (short table),
 * and prints the table to stdout.
 */
export function summaryWriter(name) {
  return function handleSummary(data) {
    const rows = [];
    const failed = [];
    for (const [metric, m] of Object.entries(data.metrics)) {
      for (const [expr, t] of Object.entries(m.thresholds || {})) {
        rows.push(`| \`${metric}\` | \`${expr}\` | ${t.ok ? 'pass' : '**FAIL**'} |`);
        if (!t.ok) failed.push(`${metric} ${expr}`);
      }
    }
    const d = (data.metrics.http_req_duration || {}).values || {};
    const reqs = (data.metrics.http_reqs || {}).values || {};
    const errs = (data.metrics.http_req_failed || {}).values || {};
    const md = [
      `## k6 ${name} against ${IMPL} (${BASE_URL})`,
      '',
      `Requests: ${reqs.count || 0} (${(reqs.rate || 0).toFixed(1)}/s), failed: ${((errs.rate || 0) * 100).toFixed(2)}%`,
      `Latency: avg ${fmt(d.avg)}, median ${fmt(d.med)}, p90 ${fmt(d['p(90)'])}, p95 ${fmt(d['p(95)'])}, max ${fmt(d.max)}`,
      '',
      '| metric | threshold | result |',
      '|---|---|---|',
      ...rows,
      '',
      failed.length ? `Failed thresholds: ${failed.join(', ')}` : 'All thresholds passed.',
      '',
    ].join('\n');
    const base = `${RESULTS_DIR}/${name}-${IMPL}`;
    return { [`${base}.json`]: JSON.stringify(data, null, 2), [`${base}.md`]: md, stdout: `\n${md}\n` };
  };
}
