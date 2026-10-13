import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { BorrowBook } from '../../../application/lending/borrow-book';
import { IdempotentExecutor } from '../../../application/lending/idempotent-executor';
import { LoanQueries } from '../../../application/lending/loan-queries';
import type { LoanView } from '../../../application/lending/loan-view';
import { ReturnLoan } from '../../../application/lending/return-loan';
import type { StoredResponse } from '../../../application/ports/repositories';
import type { Principal } from '../../../application/ports/services';
import { DomainError } from '../../../domain/shared/domain-error';
import type { components } from '../../../generated/openapi';
import { CurrentPrincipal } from '../auth/decorators';
import { presentLoanV1, presentLoanV2, presentPage } from '../presenters';
import { pathOf, problemDocument, PROBLEM_CONTENT_TYPE } from '../problem/problem';
import { IdempotencyKey, LoanCreate, LoanListQuery, uuidParam } from '../validation/schemas';
import { fieldErrorsOf, ZodPipe } from '../validation/zod.pipe';

type Schemas = components['schemas'];

/**
 * v1 and v2 share every rule and differ only in representation, so one base class holds the endpoints and
 * each version supplies its base path and presenter. (v1's deprecation headers are added by the HTTP hooks,
 * so they are on error responses too.)
 */
abstract class LoansController<R> {
  protected constructor(
    private readonly borrowBook: BorrowBook,
    private readonly returnLoan: ReturnLoan,
    private readonly queries: LoanQueries,
    private readonly idempotency: IdempotentExecutor,
    private readonly basePath: string,
    private readonly present: (loan: LoanView) => R,
  ) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodPipe(LoanListQuery, 'query')) query: z.output<typeof LoanListQuery>,
  ): Promise<{ data: R[]; page: Schemas['PageInfo'] }> {
    return presentPage(await this.queries.list(principal, query), this.present);
  }

  @Post()
  async borrow(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodPipe(LoanCreate)) body: z.output<typeof LoanCreate>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = IdempotencyKey.safeParse(idempotencyKey);
    if (!key.success) {
      throw DomainError.validation(fieldErrorsOf(key.error, 'Idempotency-Key'), 'A valid Idempotency-Key header is required.');
    }
    const outcome = await this.idempotency.execute(
      { subject: principal.memberId, key: key.data, method: request.method, path: this.basePath, body: request.body },
      async (): Promise<StoredResponse> => {
        const loan = await this.borrowBook.execute({ principal, bookId: body.bookId, memberId: body.memberId });
        return { status: 201, body: this.present(loan), headers: { Location: `${this.basePath}/${loan.id}` } };
      },
      (error): StoredResponse => {
        const problem = problemDocument({ code: error.code, detail: error.message, errors: error.fieldErrors }, pathOf(request), request.id);
        return { status: problem.status, body: problem, headers: {} };
      },
    );

    const { status, body: responseBody, headers } = outcome.response;
    reply.status(status).headers(headers);
    if (outcome.replayed) {
      reply.header('Idempotent-Replayed', 'true');
    }
    if (status >= 400) {
      reply.type(PROBLEM_CONTENT_TYPE);
      // A replayed problem keeps its content but carries the id of the request that received it.
      return { ...(responseBody as object), requestId: request.id };
    }
    return responseBody;
  }

  @Get(':loanId')
  async get(@CurrentPrincipal() principal: Principal, @Param('loanId', uuidParam('loanId')) id: string): Promise<R> {
    return this.present(await this.queries.get(principal, id));
  }

  @Post(':loanId/return')
  @HttpCode(200)
  async return(@CurrentPrincipal() principal: Principal, @Param('loanId', uuidParam('loanId')) id: string): Promise<R> {
    return this.present(await this.returnLoan.execute(principal, id));
  }
}

@Controller('api/v1/loans')
export class LoansV1Controller extends LoansController<Schemas['LoanV1']> {
  constructor(
    @Inject(BorrowBook) borrowBook: BorrowBook,
    @Inject(ReturnLoan) returnLoan: ReturnLoan,
    @Inject(LoanQueries) queries: LoanQueries,
    @Inject(IdempotentExecutor) idempotency: IdempotentExecutor,
  ) {
    super(borrowBook, returnLoan, queries, idempotency, '/api/v1/loans', presentLoanV1);
  }
}

@Controller('api/v2/loans')
export class LoansV2Controller extends LoansController<Schemas['Loan']> {
  constructor(
    @Inject(BorrowBook) borrowBook: BorrowBook,
    @Inject(ReturnLoan) returnLoan: ReturnLoan,
    @Inject(LoanQueries) queries: LoanQueries,
    @Inject(IdempotentExecutor) idempotency: IdempotentExecutor,
  ) {
    super(borrowBook, returnLoan, queries, idempotency, '/api/v2/loans', presentLoanV2);
  }
}
