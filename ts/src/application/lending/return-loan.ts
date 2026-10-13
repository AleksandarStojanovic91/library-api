import { Inject, Injectable } from '@nestjs/common';
import { LoanPolicy } from '../../domain/lending/loan-policy';
import type { Clock } from '../../domain/shared/clock';
import { DomainError } from '../../domain/shared/domain-error';
import type { BookRepository, LoanRepository, OutboxRepository } from '../ports/repositories';
import type { BookCache, LendingMetrics, Principal } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';
import { canAccessMemberData } from '../shared/access';
import { CopyHandoff } from './copy-handoff';
import { toLoanView, type LoanView } from './loan-view';

@Injectable()
export class ReturnLoan {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.LoanRepository) private readonly loans: LoanRepository,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
    @Inject(TOKENS.LendingMetrics) private readonly metrics: LendingMetrics,
    @Inject(CopyHandoff) private readonly handoff: CopyHandoff,
    @Inject(LoanPolicy) private readonly policy: LoanPolicy,
  ) {}

  async execute(principal: Principal, loanId: string): Promise<LoanView> {
    const now = this.clock.now();
    return this.tx.run(async () => {
      // Lock order everywhere (SPEC Decisions 14): member -> book -> reservation -> copy -> loan. Starting from
      // a loan: read its book unlocked, lock the book, then re-read the loan FOR UPDATE and re-check it.
      const found = await this.loans.findById(loanId);
      if (!found || !canAccessMemberData(principal, found.memberId)) {
        throw DomainError.notFound('Loan');
      }
      await this.books.lockQueue(found.bookId);
      const loan = await this.loans.lockById(loanId);
      if (!loan) {
        throw DomainError.notFound('Loan');
      }
      if (loan.returnedAt !== null) {
        throw new DomainError('already-returned', 'This loan was already returned.');
      }
      const feeCents = this.policy.feeOnReturn(loan, now);
      await this.loans.markReturned(loan.id, now, feeCents);
      await this.handoff.passOn(loan.bookId, loan.copyId, now);
      await this.outbox.append({
        type: 'loan.returned',
        aggregateId: loan.id,
        payload: { loanId: loan.id, memberId: loan.memberId, bookId: loan.bookId, copyId: loan.copyId, feeCents },
      });
      this.tx.afterCommit(() => this.cache.evict(loan.bookId));
      this.tx.afterCommit(() => this.metrics.loanReturned());

      const details = await this.loans.findDetails(loan.id);
      if (!details) {
        throw new Error(`Loan ${loan.id} vanished inside its own transaction`);
      }
      return toLoanView(details, this.policy, now);
    });
  }
}
