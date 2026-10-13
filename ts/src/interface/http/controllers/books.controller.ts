import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { BookCatalog } from '../../../application/catalog/book-catalog';
import { CopyCatalog } from '../../../application/catalog/copies';
import { DomainError } from '../../../domain/shared/domain-error';
import type { components } from '../../../generated/openapi';
import { LibrarianOnly, Public } from '../auth/decorators';
import { etagOf, ifNoneMatchMatches, parseIfMatch } from '../etag';
import { presentBook, presentCopy, presentPage } from '../presenters';
import { BookCreate, BookListQuery, BookUpdate, CopyCreate, uuidParam } from '../validation/schemas';
import { ZodPipe } from '../validation/zod.pipe';

type Schemas = components['schemas'];

@Controller('api/v1/books')
export class BooksController {
  constructor(
    @Inject(BookCatalog) private readonly catalog: BookCatalog,
    @Inject(CopyCatalog) private readonly copies: CopyCatalog,
  ) {}

  @Public()
  @Get()
  async list(@Query(new ZodPipe(BookListQuery, 'query')) query: z.output<typeof BookListQuery>): Promise<Schemas['BookPage']> {
    return presentPage(await this.catalog.list(query), presentBook);
  }

  @LibrarianOnly()
  @Post()
  async create(
    @Body(new ZodPipe(BookCreate)) body: z.output<typeof BookCreate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Book']> {
    const book = await this.catalog.create({
      isbn: body.isbn,
      title: body.title,
      description: body.description ?? null,
      publishedYear: body.publishedYear ?? null,
      authorIds: body.authorIds,
      tags: body.tags ?? [],
    });
    reply.header('Location', `/api/v1/books/${book.id}`).header('ETag', etagOf(book.version));
    return presentBook(book);
  }

  @Public()
  @Get(':bookId')
  async get(
    @Param('bookId', uuidParam('bookId')) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Book'] | undefined> {
    const { book, cache } = await this.catalog.get(id);
    reply.header('ETag', etagOf(book.version)).header('X-Cache', cache);
    if (ifNoneMatchMatches(ifNoneMatch, book.version)) {
      reply.status(304);
      return undefined;
    }
    return presentBook(book);
  }

  @LibrarianOnly()
  @Patch(':bookId')
  async update(
    @Param('bookId', uuidParam('bookId')) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Book']> {
    // The precondition is checked before the body, so a client without an ETag learns that first.
    const expected = parseIfMatch(ifMatch);
    if (expected === undefined) {
      throw new DomainError('precondition-required', 'Send If-Match with the ETag from your last read of this book.');
    }
    const patch = new ZodPipe(BookUpdate).transform(body);
    const book = await this.catalog.update(id, patch, expected);
    reply.header('ETag', etagOf(book.version));
    return presentBook(book);
  }

  @LibrarianOnly()
  @Delete(':bookId')
  @HttpCode(204)
  async delete(@Param('bookId', uuidParam('bookId')) id: string): Promise<void> {
    await this.catalog.delete(id);
  }

  @Public()
  @Get(':bookId/copies')
  async listCopies(@Param('bookId', uuidParam('bookId')) bookId: string): Promise<{ data: Schemas['Copy'][] }> {
    return { data: (await this.copies.list(bookId)).map(presentCopy) };
  }

  @LibrarianOnly()
  @Post(':bookId/copies')
  async addCopy(
    @Param('bookId', uuidParam('bookId')) bookId: string,
    @Body(new ZodPipe(CopyCreate)) body: z.output<typeof CopyCreate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Copy']> {
    const copy = await this.copies.add(bookId, body.barcode);
    reply.header('Location', `/api/v1/books/${bookId}/copies/${copy.id}`);
    return presentCopy(copy);
  }
}
