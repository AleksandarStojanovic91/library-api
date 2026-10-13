import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type { z } from 'zod';
import { IssueToken } from '../../../application/auth/issue-token';
import type { components } from '../../../generated/openapi';
import { Public } from '../auth/decorators';
import { TokenRequest } from '../validation/schemas';
import { ZodPipe } from '../validation/zod.pipe';

@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(IssueToken) private readonly issueToken: IssueToken) {}

  @Public()
  @Post('token')
  @HttpCode(200)
  async token(@Body(new ZodPipe(TokenRequest)) body: z.output<typeof TokenRequest>): Promise<components['schemas']['TokenResponse']> {
    const issued = await this.issueToken.execute(body.email, body.password);
    return { accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn };
  }
}
