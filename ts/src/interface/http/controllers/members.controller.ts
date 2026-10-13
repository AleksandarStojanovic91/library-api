import { Body, Controller, Get, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { MemberDirectory } from '../../../application/members/member-directory';
import type { Principal } from '../../../application/ports/services';
import type { components } from '../../../generated/openapi';
import { CurrentPrincipal, LibrarianOnly } from '../auth/decorators';
import { presentMember, presentPage } from '../presenters';
import { MemberCreate, MemberStatusUpdate, SimplePageQuery, uuidParam } from '../validation/schemas';
import { ZodPipe } from '../validation/zod.pipe';

type Schemas = components['schemas'];

@Controller('api/v1/members')
export class MembersController {
  constructor(@Inject(MemberDirectory) private readonly members: MemberDirectory) {}

  @LibrarianOnly()
  @Get()
  async list(@Query(new ZodPipe(SimplePageQuery, 'query')) query: z.output<typeof SimplePageQuery>): Promise<Schemas['MemberPage']> {
    return presentPage(await this.members.list(query), presentMember);
  }

  @LibrarianOnly()
  @Post()
  async register(
    @Body(new ZodPipe(MemberCreate)) body: z.output<typeof MemberCreate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Member']> {
    const member = await this.members.register(body);
    reply.header('Location', `/api/v1/members/${member.id}`);
    return presentMember(member);
  }

  @Get('me')
  async me(@CurrentPrincipal() principal: Principal): Promise<Schemas['Member']> {
    return presentMember(await this.members.me(principal));
  }

  @LibrarianOnly()
  @Put(':memberId/status')
  async changeStatus(
    @Param('memberId', uuidParam('memberId')) id: string,
    @Body(new ZodPipe(MemberStatusUpdate)) body: z.output<typeof MemberStatusUpdate>,
  ): Promise<Schemas['Member']> {
    return presentMember(await this.members.changeStatus(id, body));
  }

  @Get(':memberId')
  async get(@CurrentPrincipal() principal: Principal, @Param('memberId', uuidParam('memberId')) id: string): Promise<Schemas['Member']> {
    return presentMember(await this.members.get(principal, id));
  }
}
