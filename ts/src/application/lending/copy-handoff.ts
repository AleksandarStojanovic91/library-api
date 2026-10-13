import { Inject, Injectable } from '@nestjs/common';
import { ReservationPolicy } from '../../domain/lending/reservation';
import type { CopyRepository, OutboxRepository, ReservationRepository } from '../ports/repositories';
import { TOKENS } from '../ports/tokens';

/**
 * Decides where a copy goes when it comes free (returned loan, cancelled or expired hold): to the head of
 * the book's reservation queue, or back on the shelf. Callers must hold the book's queue lock; the queue head
 * is locked before the copy is updated (lock order reservation -> copy).
 */
@Injectable()
export class CopyHandoff {
  constructor(
    @Inject(TOKENS.ReservationRepository) private readonly reservations: ReservationRepository,
    @Inject(TOKENS.CopyRepository) private readonly copies: CopyRepository,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(ReservationPolicy) private readonly policy: ReservationPolicy,
  ) {}

  async passOn(bookId: string, copyId: string, now: Date): Promise<void> {
    const next = await this.reservations.lockFirstWaiting(bookId);
    if (!next) {
      await this.copies.setStatus(copyId, 'AVAILABLE');
      return;
    }
    const readyUntil = this.policy.holdUntil(now);
    await this.copies.setStatus(copyId, 'RESERVED');
    await this.reservations.markReady(next.id, copyId, readyUntil);
    await this.outbox.append({
      type: 'reservation.ready',
      aggregateId: next.id,
      payload: { reservationId: next.id, memberId: next.memberId, bookId, copyId, readyUntil: readyUntil.toISOString() },
    });
  }
}
