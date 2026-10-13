import { DomainError } from '../shared/domain-error';

export const ROLES = ['MEMBER', 'LIBRARIAN'] as const;
export type Role = (typeof ROLES)[number];
export type MemberStatus = 'ACTIVE' | 'SUSPENDED';

export interface Member {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly maxActiveLoans: number;
  readonly createdAt: Date;
}

export interface MemberWithLoans extends Member {
  readonly activeLoans: number;
}

/** Librarian change via PUT /members/{id}/status; maxActiveLoans stays as it is when omitted. */
export interface MemberStatusChange {
  readonly status: MemberStatus;
  readonly maxActiveLoans?: number | undefined;
}

export interface NewMember {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly maxActiveLoans: number;
}

/** Suspended members can still log in and read, but cannot borrow or reserve. */
export function assertMayBorrowOrReserve(member: Pick<Member, 'status'>): void {
  if (member.status === 'SUSPENDED') {
    throw new DomainError('member-suspended', 'The member is suspended and cannot borrow or reserve books.');
  }
}
