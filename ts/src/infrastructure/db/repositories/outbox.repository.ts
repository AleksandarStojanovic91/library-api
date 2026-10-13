import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { NotificationSink, OutboxMessage, OutboxRepository } from '../../../application/ports/repositories';
import { aggregateTypeOf, type LendingEvent } from '../../../domain/lending/events';
import { isUuid } from '../../../domain/shared/cursor';
import { notifications, outbox } from '../schema';
import { DrizzleRepository } from './base.repository';

/** A message that failed this often is parked (kept, but no longer retried) instead of being retried forever. */
export const MAX_DELIVERY_ATTEMPTS = 10;

@Injectable()
export class DrizzleOutboxRepository extends DrizzleRepository implements OutboxRepository {
  async append(event: LendingEvent): Promise<void> {
    await this.db.insert(outbox).values({
      aggregateType: aggregateTypeOf(event),
      aggregateId: event.aggregateId,
      eventType: event.type,
      payload: event.payload,
    });
  }

  claimUnpublished(limit: number): Promise<OutboxMessage[]> {
    return this.db
      .select({ id: outbox.id, eventType: outbox.eventType, aggregateId: outbox.aggregateId, payload: outbox.payload, attempts: outbox.attempts })
      .from(outbox)
      .where(and(isNull(outbox.publishedAt), lt(outbox.attempts, MAX_DELIVERY_ATTEMPTS)))
      .orderBy(asc(outbox.id))
      .limit(limit)
      .for('update', { skipLocked: true });
  }

  async markPublished(id: number): Promise<void> {
    await this.db.update(outbox).set({ publishedAt: sql`now()` }).where(eq(outbox.id, id));
  }

  async recordFailure(id: number): Promise<void> {
    await this.db.update(outbox).set({ attempts: sql`${outbox.attempts} + 1` }).where(eq(outbox.id, id));
  }

  async countUnpublished(): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(outbox).where(isNull(outbox.publishedAt));
    return row?.count ?? 0;
  }
}

/** Stand-in for e-mail or a message broker: one notifications row per event, at most once per outbox id. */
@Injectable()
export class DbNotificationSink extends DrizzleRepository implements NotificationSink {
  async deliver(message: OutboxMessage): Promise<void> {
    const memberId = message.payload['memberId'];
    await this.db
      .insert(notifications)
      .values({
        outboxId: message.id,
        memberId: isUuid(memberId) ? (memberId as string) : null,
        kind: message.eventType,
        payload: message.payload,
      })
      .onConflictDoNothing({ target: notifications.outboxId });
  }
}
