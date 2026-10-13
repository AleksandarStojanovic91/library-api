/**
 * Injection tokens for the ports. Ports are TypeScript interfaces (erased at runtime), so Nest needs a
 * runtime token to bind each one to its adapter in the composition root (src/modules).
 */
export const TOKENS = {
  Clock: Symbol('Clock'),
  TransactionManager: Symbol('TransactionManager'),
  BookRepository: Symbol('BookRepository'),
  AuthorRepository: Symbol('AuthorRepository'),
  CopyRepository: Symbol('CopyRepository'),
  MemberRepository: Symbol('MemberRepository'),
  LoanRepository: Symbol('LoanRepository'),
  ReservationRepository: Symbol('ReservationRepository'),
  OutboxRepository: Symbol('OutboxRepository'),
  NotificationSink: Symbol('NotificationSink'),
  IdempotencyRepository: Symbol('IdempotencyRepository'),
  BookCache: Symbol('BookCache'),
  RateLimiter: Symbol('RateLimiter'),
  PasswordHasher: Symbol('PasswordHasher'),
  TokenService: Symbol('TokenService'),
  LendingMetrics: Symbol('LendingMetrics'),
  DatabaseProbe: Symbol('DatabaseProbe'),
  CacheProbe: Symbol('CacheProbe'),
  HttpMetrics: Symbol('HttpMetrics'),
  MetricsExporter: Symbol('MetricsExporter'),
} as const;
