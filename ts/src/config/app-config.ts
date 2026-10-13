import { resolve } from 'node:path';
import { z } from 'zod';

/** src/config and dist/config are both two levels below ts/, so this resolves to the repository root. */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Environment variables arrive as strings; an empty string means "not set".
const env = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema);
const int = (fallback: number, min?: number) => env(z.coerce.number().int().min(min ?? Number.MIN_SAFE_INTEGER).default(fallback));

const EnvSchema = z.object({
  PORT: int(8082, 1),
  DATABASE_URL: env(z.string().default('postgres://library:library@localhost:5432/library_ts')),
  DATABASE_POOL_MAX: int(10, 1),
  REDIS_URL: env(z.string().default('redis://localhost:6379/1')),
  JWT_SECRET: env(z.string().min(32, 'JWT_SECRET must be at least 32 bytes for HS256').default('dev-only-secret-change-me-at-least-32-bytes!!')),
  RATE_LIMIT_PER_MINUTE: int(120, 1),
  RATE_LIMIT_NAMESPACE: env(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).default('rl')),
  LOAN_DAYS: int(14, 1),
  FEE_CENTS_PER_DAY: int(50, 0),
  RESERVATION_HOLD_HOURS: int(48, 1),
  CLOCK_OFFSET_SECONDS: int(0),
  WORKER_INTERVAL_MS: int(5000, 0),
  LOG_LEVEL: env(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
  OTEL_EXPORTER_OTLP_ENDPOINT: env(z.string().optional()),
  MIGRATIONS_DIR: env(z.string().default(resolve(REPO_ROOT, 'db', 'migrations'))),
  CONTRACT_PATH: env(z.string().default(resolve(REPO_ROOT, 'contract', 'openapi.yaml'))),
});

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly rateLimitPerMinute: number;
  /** Prefix of rate-limit keys, so instances sharing a Redis db can keep separate counters. */
  readonly rateLimitNamespace: string;
  readonly loanDays: number;
  readonly feeCentsPerDay: number;
  readonly reservationHoldHours: number;
  readonly clockOffsetSeconds: number;
  /** 0 disables the in-process worker (tests drive it by hand). */
  readonly workerIntervalMs: number;
  readonly logLevel: string;
  readonly otlpEndpoint: string | undefined;
  readonly migrationsDir: string;
  readonly contractPath: string;
}

export const APP_CONFIG = Symbol('AppConfig');

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    redisUrl: e.REDIS_URL,
    jwtSecret: e.JWT_SECRET,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    rateLimitNamespace: e.RATE_LIMIT_NAMESPACE,
    loanDays: e.LOAN_DAYS,
    feeCentsPerDay: e.FEE_CENTS_PER_DAY,
    reservationHoldHours: e.RESERVATION_HOLD_HOURS,
    clockOffsetSeconds: e.CLOCK_OFFSET_SECONDS,
    workerIntervalMs: e.WORKER_INTERVAL_MS,
    logLevel: e.LOG_LEVEL,
    otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
    migrationsDir: e.MIGRATIONS_DIR,
    contractPath: e.CONTRACT_PATH,
  };
}
