// Load test: open-model traffic (ramping arrival rate) on the hot read paths plus a borrow/replay/return cycle.
// Arrival-rate executors keep sending requests at the target rate even when the service slows down, so latency
// problems show up as latency (and dropped iterations) instead of being hidden by fewer requests.
//
//   docker run --rm -i --network host -v "$PWD":/work -w /work -e BASE_URL=http://localhost:8081 \
//     grafana/k6:2.3.0 run perf/load.js
//
// Env: BASE_URL, SCALE (multiplies all rates, default 1), HOLD (steady-state duration, default 3m).
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { BASE_THRESHOLDS, BASE_URL, LIBRARIAN, borrowReplayReturn, createBook, createMembers, login, params, summaryWriter } from './lib/common.js';

const SCALE = Number(__ENV.SCALE || 1);
const HOLD = __ENV.HOLD || '3m';
const rate = (n) => Math.max(1, Math.round(n * SCALE));
const stages = (target) => [
  { target: rate(target), duration: '1m' }, // ramp up
  { target: rate(target), duration: HOLD }, // steady state
  { target: 0, duration: '30s' }, // ramp down
];

const LENDING_MAX_VUS = 40;
const MEMBERS = 20; // each member has maxActiveLoans 10, each VU holds at most one loan at a time
const BOOKS = 4;
const COPIES_PER_BOOK = 15; // 60 copies > LENDING_MAX_VUS, so a borrow never runs out of copies

export const options = {
  setupTimeout: '180s',
  scenarios: {
    list_books: { executor: 'ramping-arrival-rate', exec: 'listBooks', startRate: 0, timeUnit: '1s', preAllocatedVUs: 10, maxVUs: 60, stages: stages(30) },
    get_book: { executor: 'ramping-arrival-rate', exec: 'getBook', startRate: 0, timeUnit: '1s', preAllocatedVUs: 10, maxVUs: 60, stages: stages(50) },
    search: { executor: 'ramping-arrival-rate', exec: 'search', startRate: 0, timeUnit: '1s', preAllocatedVUs: 10, maxVUs: 40, stages: stages(15) },
    lending: { executor: 'ramping-arrival-rate', exec: 'lending', startRate: 0, timeUnit: '1s', preAllocatedVUs: 5, maxVUs: LENDING_MAX_VUS, stages: stages(5) },
  },
  thresholds: Object.assign({}, BASE_THRESHOLDS, {
    'http_req_duration{name:GET /api/v1/books}': ['p(95)<300'],
    'http_req_duration{name:GET /api/v1/books/:id}': ['p(95)<300'],
    'http_req_duration{name:GET /api/v1/books (search)}': ['p(95)<300'],
    'http_req_duration{name:POST /api/v2/loans}': ['p(95)<300'],
    'http_req_duration{name:POST /api/v2/loans/:id/return}': ['p(95)<300'],
    'checks{scenario:lending}': ['rate>0.99'],
    // the service could not keep up with the requested rate if k6 had to drop iterations
    dropped_iterations: ['count<10'],
  }),
};

const TERMS = ['clean', 'kleppmann', 'domain', 'drina', 'test driven', 'software', 'Desgning Data', 'Clen Code'];

export function setup() {
  const ready = http.get(`${BASE_URL}/health/ready`);
  if (ready.status !== 200) throw new Error(`${BASE_URL} is not ready: ${ready.status} ${ready.body}`);
  const librarian = login(LIBRARIAN.email, LIBRARIAN.password);

  const page = http.get(`${BASE_URL}/api/v1/books?limit=100`, params('GET /api/v1/books'));
  const readIds = (page.json('data') || []).map((b) => b.id);
  const lendIds = [];
  for (let i = 0; i < BOOKS; i++) lendIds.push(createBook(librarian, `Load ${Date.now()} #${i}`, COPIES_PER_BOOK));

  return { readIds, lendIds, memberTokens: createMembers(librarian, MEMBERS) };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function listBooks() {
  const sort = Math.random() < 0.3 ? '&sort=-publishedYear' : '';
  const res = http.get(`${BASE_URL}/api/v1/books?limit=20${sort}`, params('GET /api/v1/books'));
  check(res, { 'list: 200': (r) => r.status === 200 });
}

export function getBook(data) {
  const res = http.get(`${BASE_URL}/api/v1/books/${pick(data.readIds)}`, params('GET /api/v1/books/:id'));
  check(res, { 'book: 200': (r) => r.status === 200 });
}

export function search() {
  const res = http.get(`${BASE_URL}/api/v1/books?q=${encodeURIComponent(pick(TERMS))}&limit=20`, params('GET /api/v1/books (search)'));
  check(res, { 'search: 200': (r) => r.status === 200 });
}

export function lending(data) {
  const token = data.memberTokens[exec.vu.idInTest % data.memberTokens.length];
  borrowReplayReturn(token, pick(data.lendIds));
}

export const handleSummary = summaryWriter('load');
