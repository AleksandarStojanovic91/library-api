import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { AuthorDirectory } from '../../../application/catalog/authors';
import type { components } from '../../../generated/openapi';
import { LibrarianOnly, Public } from '../auth/decorators';
import { presentAuthor, presentPage } from '../presenters';
import { AuthorCreate, SimplePageQuery, uuidParam } from '../validation/schemas';
import { ZodPipe } from '../validation/zod.pipe';

type Schemas = components['schemas'];

@Controller('api/v1/authors')
export class AuthorsController {
  constructor(@Inject(AuthorDirectory) private readonly authors: AuthorDirectory) {}

  @Public()
  @Get()
  async list(@Query(new ZodPipe(SimplePageQuery, 'query')) query: z.output<typeof SimplePageQuery>): Promise<Schemas['AuthorPage']> {
    return presentPage(await this.authors.list(query), presentAuthor);
  }

  @Public()
  @Get(':authorId')
  async get(@Param('authorId', uuidParam('authorId')) id: string): Promise<Schemas['Author']> {
    return presentAuthor(await this.authors.get(id));
  }

  @LibrarianOnly()
  @Post()
  async create(
    @Body(new ZodPipe(AuthorCreate)) body: z.output<typeof AuthorCreate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Author']> {
    const author = await this.authors.create({ name: body.name, bio: body.bio ?? null });
    reply.header('Location', `/api/v1/authors/${author.id}`);
    return presentAuthor(author);
  }
}
