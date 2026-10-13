import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import type { IssuedToken, Principal, TokenService } from '../../application/ports/services';
import { ROLES, type Role } from '../../domain/members/member';

export const JWT_SECRET = Symbol('JwtSecret');

const ISSUER = 'library-api';
const TTL_SECONDS = 3600;

/**
 * HS256 JWTs: sub = member id, role, email, iat, exp, iss. Token lifetimes use the real wall clock, not the
 * business clock: CLOCK_OFFSET_SECONDS shifts lending rules, not security.
 */
@Injectable()
export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(JWT_SECRET) secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(principal: Principal): Promise<IssuedToken> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ role: principal.role, email: principal.email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.memberId)
      .setIssuer(ISSUER)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TTL_SECONDS)
      .sign(this.key);
    return { accessToken, expiresIn: TTL_SECONDS };
  }

  async verify(token: string): Promise<Principal | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'], requiredClaims: ['sub', 'exp', 'iat'] });
      const { sub, role, email } = payload;
      if (typeof sub !== 'string' || typeof email !== 'string' || !ROLES.includes(role as Role)) {
        return null;
      }
      return { memberId: sub, role: role as Role, email };
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        return null;
      }
      throw error;
    }
  }
}
