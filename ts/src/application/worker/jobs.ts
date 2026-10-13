import { Inject, Injectable, Logger } from '@nestjs/common';
import { ReservationPolicy } from '../../domain/lending/reservation';
import type { Clock } from '../../domain/shared/clock';
import type {
  BookRepository,
  IdempotencyRepository,
  LoanRepository,
  NotificationSink,
  OutboxRepository,
  ReservationRepository,
} from '../ports/repositories';
import type { BookCache } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { CopyHandoff } from '../lending/copy-handoff';

/**
 * Background jobs. Each one is safe to run on several instances at once: work is claimed with row locks
 * (mostly FOR UPDATE SKIP LOCKED), so two workers never process the same row.
 */
export interface Job {
  readonly name: string;
  /** Returns how many items were processed. */
  run(): Promise<number>;
}

const BATCH = 100;

@Injectable()
export class OverdueScanJob implements Job {
  readonly name = 'overdue-scan';

  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.LoanRepository) private readonly loans: LoanRepository,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
  ) {}

  run(): Promise<number> {
    const now = this.clock.now();
    return this.tx.run(async () => {
      const loans = await this.loans.claimOverdue(now, BATCH);
      for (const loan of loans) {
        await this.outbox.append({
          type: 'loan.overdue',
          aggregateId: loan.id,
          payload: { loanId: loan.id, memberId: loan.memberId, bookId: loan.bookId, dueAt: loan.dueAt.toISOString() },
        });
      }
      return loans.length;
    });
  }
}

@Injectable()
export class ReservationExpiryJob implements Job {
  readonly name = 'reservation-expiry';

  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.ReservationRepository) private readonly reservations: ReservationRepository,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
    @Inject(CopyHandoff) private readonly handoff: CopyHandoff,
  ) {}

  async run(): Promise<number> {
    const now = this.clock.now();
    const candidates = await this.reservations.findExpiredReady(now, BATCH);
    let expired = 0;
    // One short transaction per reservation, taking locks in the same order as cancel and return
    // (queue lock, then reservation). The re-check under the lock makes a second worker skip it.
    for (const candidate of candidates) {
      const done = await this.tx.run(async () => {
        await this.books.lockQueue(candidate.bookId);
        const reservation = await this.reservations.lockById(candidate.id);
        if (!reservation?.heldCopyId || !ReservationPolicy.isExpired(reservation, now)) {
          return false;
        }
        await this.reservations.close(reservation.id, 'EXPIRED');
        await this.outbox.append({
          type: 'reservation.expired',
          aggregateId: reservation.id,
          payload: { reservationId: reservation.id, memberId: reservation.memberId, bookId: reservation.bookId },
        });
        await this.handoff.passOn(reservation.bookId, reservation.heldCopyId, now);
        this.tx.afterCommit(() => this.cache.evict(reservation.bookId));
        return true;
      });
      expired += done ? 1 : 0;
    }
    return expired;
  }
}

@Injectable()
export class OutboxPublisherJob implements Job {
  readonly name = 'outbox-publisher';
  private readonly logger = new Logger(OutboxPublisherJob.name);

  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(TOKENS.NotificationSink) private readonly sink: NotificationSink,
  ) {}

  run(): Promise<number> {
    return this.tx.run(async () => {
      const messages = await this.outbox.claimUnpublished(BATCH);
      let published = 0;
      for (const message of messages) {
        try {
          // Savepoint per message: one failing delivery must not undo the others in the batch.
          await this.tx.run(() => this.sink.deliver(message));
          await this.outbox.markPublished(message.id);
          published++;
        } catch (error) {
          this.logger.warn({ err: error, outboxId: message.id, eventType: message.eventType }, 'Outbox delivery failed; will retry');
          await this.outbox.recordFailure(message.id);
        }
      }
      return published;
    });
  }
}

@Injectable()
export class IdempotencyCleanupJob implements Job {
  readonly name = 'idempotency-cleanup';
  static readonly RETENTION_SECONDS = 24 * 3600;

  constructor(@Inject(TOKENS.IdempotencyRepository) private readonly keys: IdempotencyRepository) {}

  run(): Promise<number> {
    return this.keys.deleteOlderThan(IdempotencyCleanupJob.RETENTION_SECONDS);
  }
}
