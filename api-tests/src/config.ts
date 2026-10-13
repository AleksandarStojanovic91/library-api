/**
 * Everything the suite reads from the environment, in one place.
 * Defaults match docker-compose.yml + docker-compose.test.yml and docs/SPEC.md.
 */
import path from 'node:path';

const env = process.env;

function int(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const implementations = {
  java: 'http://localhost:8081',
  ts: 'http://localhost:8082',
} as const;
export type Implementation = keyof typeof implementations;

export const config = {
  /** Overrides the default URL of whichever project (`java` or `ts`) you run. */
  baseUrlOverride: env.BASE_URL || undefined,
  /** Second instance of the same implementation, started with CLOCK_OFFSET_SECONDS (time-travel project). */
  overdueBaseUrl: env.OVERDUE_BASE_URL || undefined,
  /** Must match CLOCK_OFFSET_SECONDS of the OVERDUE_BASE_URL instance. 15.5 days by default. */
  overdueOffsetSeconds: int('OVERDUE_OFFSET_SECONDS', 1_339_200),
  /** The 429 test needs an instance with a small limit, so it only runs when asked. */
  rateLimitTest: env.RATE_LIMIT_TEST === '1',
  /** Used only to forge tokens in the auth tests; matches the docker-compose default. */
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-at-least-32-bytes!!',
  loanDays: int('LOAN_DAYS', 14),
  feeCentsPerDay: int('FEE_CENTS_PER_DAY', 50),
  reservationHoldHours: int('RESERVATION_HOLD_HOURS', 48),
  /** Fail (instead of annotate) when a response status is not documented in the contract. */
  strictStatusCodes: env.CONTRACT_STRICT_STATUS === '1',
  /** By default response objects may not carry fields the contract does not declare. */
  allowExtraFields: env.CONTRACT_ALLOW_EXTRA_FIELDS === '1',
  contractPath: path.resolve(__dirname, '../../contract/openapi.yaml'),
} as const;

export const seed = {
  librarian: { id: '00000000-0000-4000-8000-000000000001', email: 'librarian@library.test', password: 'librarian-pass-123' },
  member: { id: '00000000-0000-4000-8000-000000000002', email: 'member@library.test', password: 'member-pass-123' },
  member2: { id: '00000000-0000-4000-8000-000000000003', email: 'member2@library.test', password: 'member2-pass-123' },
  books: {
    cleanCode: { id: '20000000-0000-4000-8000-000000000001', isbn: '9780132350884', title: 'Clean Code' },
    ddia: { id: '20000000-0000-4000-8000-000000000002', isbn: '9781449373320', title: 'Designing Data-Intensive Applications' },
  },
  authors: {
    kleppmann: { id: '10000000-0000-4000-8000-000000000002', name: 'Martin Kleppmann' },
  },
} as const;

/** A syntactically valid UUID that never exists (v4 layout, all zeros in the random part). */
export const MISSING_ID = '00000000-0000-4000-8000-00000000dead';
