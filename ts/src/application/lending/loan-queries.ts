import { Inject, Injectable } from '@nestjs/common';
import type { LoanStatus } from '../../domain/lending/loan';
import { LoanPolicy } from '../../domain/lending/loan-policy';
import type { Clock } from '../../domain/shared/clock';
import { decodeCursor, encodeCursor, isTimestamp, isUuid } from '../../domain/shared/cursor';
import { DomainError } from '../../domain/shared/domain-error';
import type { Page } from '../../domain/shared/page';
import type { LoanKey, LoanRepository } from '../ports/repositories';
import type { Principal } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import { canAccessMemberData, isLibrarian } from '../shared/access';
import { toPage, type PageRequest } from '../shared/pagination';
import { toLoanView, type LoanView } from './loan-view';

export interface ListLoansQuery extends PageRequest {
  readonly memberId?: string | undefined;
  readonly status?: LoanStatus | undefined;
}

type LoanCursor = { b: string; id: string };

@Injectable()
export class LoanQueries {
  constructor(
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(TOKENS.LoanRepository) private readonly loans: LoanRepository,
    @Inject(LoanPolicy) private readonly policy: LoanPolicy,
  ) {}

  async get(principal: Principal, id: string): Promise<LoanView> {
    const loan = await this.loans.findDetails(id);
    if (!loan || !canAccessMemberData(principal, loan.memberId)) {
      throw DomainError.notFound('Loan');
    }
    return toLoanView(loan, this.policy, this.clock.now());
  }

  /** Members always get their own loans; only librarians may choose (or omit) the member filter. */
  async list(principal: Principal, query: ListLoansQuery): Promise<Page<LoanView>> {
    const now = this.clock.now();
    const memberId = isLibrarian(principal) ? query.memberId : principal.memberId;
    const after = query.cursor === undefined ? null : decodeLoanCursor(query.cursor);
    const rows = await this.loans.findPage({ memberId, status: query.status }, now, after, query.limit + 1);
    const page = toPage(rows, query.limit, (key) => encodeCursor({ b: key.borrowedAt, id: key.id } satisfies LoanCursor));
    return { ...page, items: page.items.map((loan) => toLoanView(loan, this.policy, now)) };
  }
}

function decodeLoanCursor(cursor: string): LoanKey {
  const { b, id } = decodeCursor<LoanCursor>(cursor, { b: isTimestamp, id: isUuid });
  return { borrowedAt: b, id };
}
