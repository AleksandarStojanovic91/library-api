import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Role } from '../../../domain/members/member';
import { DomainError } from '../../../domain/shared/domain-error';
import { IS_PUBLIC, REQUIRED_ROLES } from './decorators';

/**
 * Authorisation by route metadata. Authentication (verifying the bearer token) already happened in the
 * onRequest hook, because the rate limiter needs the caller identity before any guard runs.
 * Routes are protected unless marked @Public(), so forgetting a decorator fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.principal) {
      throw new DomainError(
        'unauthorized',
        request.authFailure === 'invalid' ? 'The access token is invalid or expired.' : 'An access token is required (Authorization: Bearer <token>).',
      );
    }
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(request.principal.role)) {
      throw DomainError.forbidden(`This action requires the ${roles.join(' or ')} role.`);
    }
    return true;
  }
}
