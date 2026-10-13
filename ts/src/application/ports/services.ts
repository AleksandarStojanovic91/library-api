import type { Book } from '../../domain/catalog/catalog';
import type { Role } from '../../domain/members/member';

/** The authenticated caller, taken from a verified token. */
export interface Principal {
  readonly memberId: string;
  readonly role: Role;
  readonly email: string;
}

export interface BookCache {
  /** Returns null on a miss and also when the cache is unreachable: reads must never fail because of it. */
  get(id: string): Promise<Book | null>;
  put(book: Book): Promise<void>;
  evict(id: string): Promise<void>;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the current window ends. */
  readonly resetSeconds: number;
}

export interface RateLimiter {
  /** Counts one request for the client. Returns null when the limiter is unavailable (fail open). */
  consume(clientKey: string): Promise<RateLimitDecision | null>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface IssuedToken {
  readonly accessToken: string;
  readonly expiresIn: number;
}

export interface TokenService {
  issue(principal: Principal): Promise<IssuedToken>;
  /** Returns null for a missing, malformed, expired or wrongly signed token. */
  verify(token: string): Promise<Principal | null>;
}

export interface LendingMetrics {
  loanCreated(): void;
  loanReturned(): void;
}

export interface HealthProbe {
  ping(): Promise<boolean>;
}

export interface HttpMetrics {
  observeRequest(method: string, route: string, status: number, durationSeconds: number): void;
}

export interface MetricsExporter {
  contentType(): string;
  render(): Promise<string>;
}
