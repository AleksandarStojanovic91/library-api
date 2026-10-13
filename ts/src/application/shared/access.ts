import type { Principal } from '../ports/services';

export function isLibrarian(principal: Principal): boolean {
  return principal.role === 'LIBRARIAN';
}

/**
 * Librarians see everyone's records, members only their own. Callers answer "not allowed" with 404,
 * not 403, so a member cannot probe which ids exist.
 */
export function canAccessMemberData(principal: Principal, memberId: string): boolean {
  return isLibrarian(principal) || principal.memberId === memberId;
}
