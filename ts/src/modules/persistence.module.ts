import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { TOKENS } from '../application/ports/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createDatabase, createPool, DATABASE, PG_POOL } from '../infrastructure/db/database';
import { PostgresProbe } from '../infrastructure/db/health.probe';
import { migrate } from '../infrastructure/db/migrator';
import { DrizzleAuthorRepository } from '../infrastructure/db/repositories/author.repository';
import { DrizzleBookRepository } from '../infrastructure/db/repositories/book.repository';
import { DrizzleCopyRepository } from '../infrastructure/db/repositories/copy.repository';
import { DrizzleIdempotencyRepository } from '../infrastructure/db/repositories/idempotency.repository';
import { DrizzleLoanRepository } from '../infrastructure/db/repositories/loan.repository';
import { DrizzleMemberRepository } from '../infrastructure/db/repositories/member.repository';
import { DbNotificationSink, DrizzleOutboxRepository } from '../infrastructure/db/repositories/outbox.repository';
import { DrizzleReservationRepository } from '../infrastructure/db/repositories/reservation.repository';
import { DrizzleTransactionManager } from '../infrastructure/db/transaction-manager';

/** Migrates before the app starts serving; closes the pool last, after HTTP and the worker have stopped. */
@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const applied = await migrate(this.pool, this.config.migrationsDir, { info: (message) => this.logger.log(message) });
    this.logger.log(applied.length > 0 ? `Applied ${applied.length} migration(s)` : 'Schema is up to date');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

const REPOSITORIES = [
  { provide: TOKENS.BookRepository, useClass: DrizzleBookRepository },
  { provide: TOKENS.AuthorRepository, useClass: DrizzleAuthorRepository },
  { provide: TOKENS.CopyRepository, useClass: DrizzleCopyRepository },
  { provide: TOKENS.MemberRepository, useClass: DrizzleMemberRepository },
  { provide: TOKENS.LoanRepository, useClass: DrizzleLoanRepository },
  { provide: TOKENS.ReservationRepository, useClass: DrizzleReservationRepository },
  { provide: TOKENS.OutboxRepository, useClass: DrizzleOutboxRepository },
  { provide: TOKENS.NotificationSink, useClass: DbNotificationSink },
  { provide: TOKENS.IdempotencyRepository, useClass: DrizzleIdempotencyRepository },
];

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl, config.databasePoolMax),
    },
    { provide: DATABASE, inject: [PG_POOL], useFactory: createDatabase },
    DrizzleTransactionManager,
    { provide: TOKENS.TransactionManager, useExisting: DrizzleTransactionManager },
    { provide: TOKENS.DatabaseProbe, useClass: PostgresProbe },
    ...REPOSITORIES,
    DatabaseLifecycle,
  ],
  exports: [PG_POOL, TOKENS.TransactionManager, TOKENS.DatabaseProbe, ...REPOSITORIES.map((r) => r.provide)],
})
export class PersistenceModule {}
