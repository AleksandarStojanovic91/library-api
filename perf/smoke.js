// Smoke test: 1 virtual user for 30 s through the main read paths and one borrow/replay/return cycle.
// Proves the service works under the lightest possible load and that the latency budget holds.
//
//   docker run --rm -i --network host -v "$PWD":/work -w /work -e BASE_URL=http://localhost:8081 \
//     grafana/k6:2.3.0 run perf/smoke.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE_THRESHOLDS, BASE_URL, LIBRARIAN, borrowReplayReturn, createBook, createMembers, login, params, summaryWriter } from './lib/common.js';

export const options = {
  vus: 1,
  duration: __ENV.DURATION || '30s',
  thresholds: BASE_THRESHOLDS,
  setupTimeout: '60s',
};

const SEEDED_BOOK = '20000000-0000-4000-8000-000000000001';

export function setup() {
  const ready = http.get(`${BASE_URL}/health/ready`);
  if (ready.status !== 200) throw new Error(`${BASE_URL} is not ready: ${ready.status} ${ready.body}`);
  const librarian = login(LIBRARIAN.email, LIBRARIAN.password);
  return { memberToken: createMembers(librarian, 1)[0], bookId: createBook(librarian, `Smoke ${Date.now()}`, 1) };
}

export default function (data) {
  group('health', () => {
    check(http.get(`${BASE_URL}/health/ready`, { tags: { name: 'GET /health/ready' } }), { 'ready: 200': (r) => r.status === 200 });
  });

  group('browse', () => {
    const list = http.get(`${BASE_URL}/api/v1/books?limit=20`, params('GET /api/v1/books'));
    check(list, { 'list: 200': (r) => r.status === 200, 'list: has data': (r) => Array.isArray(r.json('data')) });

    const next = list.json('page.nextCursor');
    if (next) {
      const page2 = http.get(`${BASE_URL}/api/v1/books?limit=20&cursor=${encodeURIComponent(next)}`, params('GET /api/v1/books (page 2)'));
      check(page2, { 'page 2: 200': (r) => r.status === 200 });
    }

    const one = http.get(`${BASE_URL}/api/v1/books/${SEEDED_BOOK}`, params('GET /api/v1/books/:id'));
    check(one, { 'book: 200': (r) => r.status === 200, 'book: has ETag': (r) => !!r.headers.Etag || !!r.headers.ETag });
  });

  group('search', () => {
    const fts = http.get(`${BASE_URL}/api/v1/books?q=clean`, params('GET /api/v1/books (search)'));
    check(fts, { 'search: 200': (r) => r.status === 200, 'search: finds Clean Code': (r) => (r.json('data') || []).some((b) => b.id === SEEDED_BOOK) });
    const typo = http.get(`${BASE_URL}/api/v1/books?q=Clen%20Cdoe`, params('GET /api/v1/books (search, typo)'));
    check(typo, { 'trigram: 200': (r) => r.status === 200 });
  });

  group('lending', () => {
    borrowReplayReturn(data.memberToken, data.bookId);
  });

  sleep(1);
}

export const handleSummary = summaryWriter('smoke');
