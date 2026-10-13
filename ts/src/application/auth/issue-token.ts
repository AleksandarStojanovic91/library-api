import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../domain/shared/domain-error';
import type { MemberRepository } from '../ports/repositories';
import type { IssuedToken, PasswordHasher, TokenService } from '../ports/services';
import { TOKENS } from '../ports/tokens';

/**
 * A real bcrypt hash (cost 10) of a random string. Unknown e-mails are checked against it so that both
 * failure paths cost one bcrypt comparison and response timing does not reveal which e-mails exist.
 */
const TIMING_DUMMY_HASH = '$2b$10$2Me9X4tfRg/2vIjn9rlNUukG9fvT9oOzUpuOR9nNTqQxPAc7gQ2o.';

@Injectable()
export class IssueToken {
  constructor(
    @Inject(TOKENS.MemberRepository) private readonly members: MemberRepository,
    @Inject(TOKENS.PasswordHasher) private readonly passwords: PasswordHasher,
    @Inject(TOKENS.TokenService) private readonly tokens: TokenService,
  ) {}

  async execute(email: string, password: string): Promise<IssuedToken> {
    const found = await this.members.findCredentials(email);
    const passwordMatches = await this.passwords.verify(password, found?.passwordHash ?? TIMING_DUMMY_HASH);
    if (!found || !passwordMatches) {
      throw new DomainError('unauthorized', 'Invalid e-mail or password.');
    }
    const { member } = found;
    return this.tokens.issue({ memberId: member.id, role: member.role, email: member.email });
  }
}
