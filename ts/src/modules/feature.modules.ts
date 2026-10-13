import { Module, type DynamicModule } from '@nestjs/common';
import { IssueToken } from '../application/auth/issue-token';
import { AuthorDirectory } from '../application/catalog/authors';
import { BookCatalog } from '../application/catalog/book-catalog';
import { CopyCatalog } from '../application/catalog/copies';
import { BorrowBook } from '../application/lending/borrow-book';
import { CopyHandoff } from '../application/lending/copy-handoff';
import { IdempotentExecutor } from '../application/lending/idempotent-executor';
import { LoanQueries } from '../application/lending/loan-queries';
import { Reservations } from '../application/lending/reservations';
import { ReturnLoan } from '../application/lending/return-loan';
import { MemberDirectory } from '../application/members/member-directory';
import { IdempotencyCleanupJob, OutboxPublisherJob, OverdueScanJob, ReservationExpiryJob } from '../application/worker/jobs';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { WORKER_INTERVAL_MS, WORKER_JOBS, WorkerRunner } from '../infrastructure/scheduling/worker-runner';
import { AuthController } from '../interface/http/controllers/auth.controller';
import { AuthorsController } from '../interface/http/controllers/authors.controller';
import { BooksController } from '../interface/http/controllers/books.controller';
import { LoansV1Controller, LoansV2Controller } from '../interface/http/controllers/loans.controller';
import { MembersController } from '../interface/http/controllers/members.controller';
import { CONTRACT_YAML, OpsController } from '../interface/http/controllers/ops.controller';
import { ReservationsController } from '../interface/http/controllers/reservations.controller';

@Module({
  controllers: [BooksController, AuthorsController],
  providers: [BookCatalog, CopyCatalog, AuthorDirectory],
})
export class CatalogModule {}

@Module({
  controllers: [AuthController, MembersController],
  providers: [IssueToken, MemberDirectory],
})
export class MembersModule {}

@Module({
  controllers: [LoansV1Controller, LoansV2Controller, ReservationsController],
  providers: [BorrowBook, ReturnLoan, LoanQueries, Reservations, CopyHandoff, IdempotentExecutor],
  exports: [CopyHandoff],
})
export class LendingModule {}

const JOBS = [OverdueScanJob, ReservationExpiryJob, OutboxPublisherJob, IdempotencyCleanupJob];

@Module({
  imports: [LendingModule],
  providers: [
    ...JOBS,
    // Order matters: overdue scan and reservation expiry write outbox rows the publisher then sends.
    { provide: WORKER_JOBS, inject: JOBS, useFactory: (...jobs: InstanceType<(typeof JOBS)[number]>[]) => jobs },
    { provide: WORKER_INTERVAL_MS, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.workerIntervalMs },
    WorkerRunner,
  ],
})
export class WorkerModule {}

@Module({})
export class OpsModule {
  static forRoot(contractYaml: string): DynamicModule {
    return {
      module: OpsModule,
      controllers: [OpsController],
      providers: [{ provide: CONTRACT_YAML, useValue: contractYaml }],
    };
  }
}
