import { Inject, Injectable } from '@nestjs/common';
import type { Copy } from '../../domain/catalog/catalog';
import { LoanPolicy } from '../../domain/lending/loan-policy';
import { ReservationPolicy } from '../../domain/lending/reservation';
import { assertMayBorrowOrReserve } from '../../domain/members/member';
import type { Clock } from '../../domain/shared/clock';
import { DomainError } from '../../domain/shared/domain-error';
import type {
  BookRepository,
  CopyRepository,
  LoanRepository,
  MemberRepository,
  OutboxRepository,
  ReservationRepository,
} from '../ports/repositories';
import type { BookCache, LendingMetrics, Principal } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { isLibrarian } from '../shared/access';
import { toLoanView, type LoanView } from './loan-view';

export interface BorrowCommand {
  readonly principal: Principal;
  readonly bookId: string;
  /** Librarians only: borrow on behalf of this member. */
  readonly memberId?: string | undefined;
}

export const NO_COPY_AVAILABLE_DETAIL = 'No copy of this book is available. You can reserve it with POST /api/v1/reservations.';

@Injectable()
export class BorrowBook {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.MemberRepository) private readonly members: MemberRepository,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.CopyRepository) private readonly copies: CopyRepository,
    @Inject(TOKENS.LoanRepository) private readonly loans: LoanRepository,
    @Inject(TOKENS.ReservationRepository) private readonly reservations: ReservationRepository,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
    @Inject(TOKENS.LendingMetrics) private readonly metrics: LendingMetrics,
    @Inject(LoanPolicy) private readonly policy: LoanPolicy,
  ) {}

  async execute(command: BorrowCommand): Promise<LoanView> {
    const memberId = this.resolveBorrower(command);
    const now = this.clock.now();
    return this.tx.run(async () => {
      // Locking the member row serialises this member's borrows, so two parallel requests cannot both
      // pass the loan-limit check below.
      const member = await this.members.lockById(memberId);
      if (!member) {
        throw DomainError.notFound('Member');
      }
      assertMayBorrowOrReserve(member);
      if (!(await this.books.exists(command.bookId))) {
        throw DomainError.notFound('Book');
      }
      const openLoans = await this.loans.countOpenByMember(member.id);
      if (this.policy.hasReachedLimit(openLoans, member.maxActiveLoans)) {
        throw new DomainError(
          'loan-limit-reached',
          `The member already has ${openLoans} active loan(s); the limit is ${member.maxActiveLoans}.`,
        );
      }

      const copy = await this.takeCopy(member.id, command.bookId, now);
      await this.copies.setStatus(copy.id, 'ON_LOAN');
      const dueAt = this.policy.dueAt(now);
      const loanId = await this.loans.insert({ bookId: command.bookId, copyId: copy.id, memberId: member.id, borrowedAt: now, dueAt });
      await this.outbox.append({
        type: 'loan.created',
        aggregateId: loanId,
        payload: { loanId, memberId: member.id, bookId: command.bookId, copyId: copy.id, dueAt: dueAt.toISOString() },
      });
      this.tx.afterCommit(() => this.cache.evict(command.bookId));
      this.tx.afterCommit(() => this.metrics.loanCreated());

      const loan = await this.loans.findDetails(loanId);
      if (!loan) {
        throw new Error(`Loan ${loanId} vanished inside its own transaction`);
      }
      return toLoanView(loan, this.policy, now);
    });
  }

  private resolveBorrower(command: BorrowCommand): string {
    if (command.memberId === undefined) {
      return command.principal.memberId;
    }
    if (!isLibrarian(command.principal)) {
      throw DomainError.forbidden('Only librarians can borrow on behalf of another member.');
    }
    return command.memberId;
  }

  /**
   * The copy held for the member's READY reservation if there is one (fulfilling it), otherwise any
   * AVAILABLE copy. `claimAvailable` uses FOR UPDATE SKIP LOCKED: parallel borrows of the same book lock
   * different copies instead of queueing behind each other, and never get the same one.
   */
  private async takeCopy(memberId: string, bookId: string, now: Date): Promise<Copy> {
    const reservation = await this.reservations.lockReady(memberId, bookId);
    if (reservation?.heldCopyId && !ReservationPolicy.isExpired(reservation, now)) {
      const held = await this.copies.lockById(reservation.heldCopyId);
      if (held) {
        await this.reservations.close(reservation.id, 'FULFILLED');
        return held;
      }
    }
    const copy = await this.copies.claimAvailable(bookId);
    if (!copy) {
      throw new DomainError('no-copy-available', NO_COPY_AVAILABLE_DETAIL);
    }
    return copy;
  }
}
