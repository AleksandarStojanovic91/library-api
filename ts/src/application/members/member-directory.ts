import { Inject, Injectable } from '@nestjs/common';
import type { MemberStatusChange, MemberWithLoans } from '../../domain/members/member';
import { DomainError } from '../../domain/shared/domain-error';
import type { Page } from '../../domain/shared/page';
import type { MemberRepository } from '../ports/repositories';
import type { PasswordHasher, Principal } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import { canAccessMemberData } from '../shared/access';
import { decodeCreatedKey, encodeCreatedKey, toPage, type PageRequest } from '../shared/pagination';

export interface RegisterMember {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly maxActiveLoans: number;
}

@Injectable()
export class MemberDirectory {
  constructor(
    @Inject(TOKENS.MemberRepository) private readonly members: MemberRepository,
    @Inject(TOKENS.PasswordHasher) private readonly passwords: PasswordHasher,
  ) {}

  async list(page: PageRequest): Promise<Page<MemberWithLoans>> {
    const rows = await this.members.findPage(decodeCreatedKey(page.cursor), page.limit + 1);
    return toPage(rows, page.limit, encodeCreatedKey);
  }

  async get(principal: Principal, id: string): Promise<MemberWithLoans> {
    const member = canAccessMemberData(principal, id) ? await this.members.findById(id) : null;
    if (!member) {
      throw DomainError.notFound('Member');
    }
    return member;
  }

  me(principal: Principal): Promise<MemberWithLoans> {
    return this.get(principal, principal.memberId);
  }

  /** Suspend or reactivate a member. Existing loans and reservations stay; suspension only blocks new ones. */
  async changeStatus(id: string, change: MemberStatusChange): Promise<MemberWithLoans> {
    if (!(await this.members.updateStatus(id, change))) {
      throw DomainError.notFound('Member');
    }
    const member = await this.members.findById(id);
    if (!member) {
      throw DomainError.notFound('Member');
    }
    return member;
  }

  async register(input: RegisterMember): Promise<MemberWithLoans> {
    const passwordHash = await this.passwords.hash(input.password);
    return this.members.insert({ email: input.email, name: input.name, passwordHash, maxActiveLoans: input.maxActiveLoans });
  }
}
