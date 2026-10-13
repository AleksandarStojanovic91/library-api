import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Principal } from '../../../application/ports/services';
import type { Role } from '../../../domain/members/member';

export const IS_PUBLIC = 'library:isPublic';
export const REQUIRED_ROLES = 'library:roles';

/** No token needed (an invalid one is ignored). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
export const LibrarianOnly = () => Roles('LIBRARIAN');

/** The authenticated caller; only use on routes the AuthGuard protects. */
export const CurrentPrincipal = createParamDecorator((_: unknown, context: ExecutionContext): Principal => {
  const principal = context.switchToHttp().getRequest<FastifyRequest>().principal;
  if (!principal) {
    throw new Error('CurrentPrincipal used on a route without authentication');
  }
  return principal;
});
