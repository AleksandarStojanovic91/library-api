import { Inject, Injectable } from '@nestjs/common';
import { ReservationPolicy, type Reservation } from '../../domain/lending/reservation';
import { assertMayBorrowOrReserve } from '../../domain/members/member';
import type { Clock } from '../../domain/shared/clock';
import { DomainError } from '../../domain/shared/domain-error';
import type { Page } from '../../domain/shared/page';
import type { BookRepository, CopyRepository, MemberRepository, ReservationRepository } from '../ports/repositories';
import type { BookCache, Principal } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { canAccessMemberData, isLibrarian } from '../shared/access';
import { decodeCreatedKey, encodeCreatedKey, toPage, type PageRequest } from '../shared/pagination';
import { CopyHandoff } from './copy-handoff';

export interface ListReservationsQuery extends PageRequest {
  readonly memberId?: string | undefined;
  readonly bookId?: string | undefined;
}

@Injectable()
export class Reservations {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.MemberRepository) private readonly members: MemberRepository,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.CopyRepository) private readonly copies: CopyRepository,
    @Inject(TOKENS.ReservationRepository) private readonly reservations: ReservationRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
    @Inject(CopyHandoff) private readonly handoff: CopyHandoff,
  ) {}

  async reserve(principal: Principal, bookId: string): Promise<Reservation> {
    return this.tx.run(async () => {
      const member = await this.members.findById(principal.memberId);
      if (!member) {
        throw DomainError.notFound('Member');
      }
      assertMayBorrowOrReserve(member);
      // Under the queue lock no return can put a copy back on the shelf between our availability check
      // and the insert, so a reservation never waits while a copy sits AVAILABLE.
      if (!(await this.books.lockQueue(bookId))) {
        throw DomainError.notFound('Book');
      }
      if (await this.copies.hasAvailable(bookId)) {
        throw new DomainError('copy-available', 'A copy of this book is available; borrow it instead of reserving.');
      }
      if (await this.reservations.hasOpen(member.id, bookId)) {
        throw new DomainError('already-reserved', 'You already have an open reservation for this book.');
      }
      const id = await this.reservations.insert(member.id, bookId);
      return this.mustFind(id);
    });
  }

  async cancel(principal: Principal, id: string): Promise<void> {
    const now = this.clock.now();
    await this.tx.run(async () => {
      const found = await this.reservations.findById(id);
      if (!found || !canAccessMemberData(principal, found.memberId)) {
        throw DomainError.notFound('Reservation');
      }
      // Queue lock first, then the reservation row (same order as returns and the expiry job).
      await this.books.lockQueue(found.bookId);
      const reservation = await this.reservations.lockById(id);
      if (!reservation) {
        throw DomainError.notFound('Reservation');
      }
      if (!ReservationPolicy.isCancellable(reservation.status)) {
        throw new DomainError('reservation-not-cancellable', `A ${reservation.status} reservation cannot be cancelled.`);
      }
      await this.reservations.close(reservation.id, 'CANCELLED');
      if (reservation.status === 'READY' && reservation.heldCopyId) {
        await this.handoff.passOn(reservation.bookId, reservation.heldCopyId, now);
        this.tx.afterCommit(() => this.cache.evict(reservation.bookId));
      }
    });
  }

  async list(principal: Principal, query: ListReservationsQuery): Promise<Page<Reservation>> {
    const memberId = isLibrarian(principal) ? query.memberId : principal.memberId;
    const rows = await this.reservations.findPage({ memberId, bookId: query.bookId }, decodeCreatedKey(query.cursor), query.limit + 1);
    return toPage(rows, query.limit, encodeCreatedKey);
  }

  private async mustFind(id: string): Promise<Reservation> {
    const reservation = await this.reservations.findById(id);
    if (!reservation) {
      throw new Error(`Reservation ${id} vanished inside its own transaction`);
    }
    return reservation;
  }
}
