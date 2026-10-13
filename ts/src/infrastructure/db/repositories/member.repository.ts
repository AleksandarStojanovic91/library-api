import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { CreatedKey, Keyed, MemberRepository } from '../../../application/ports/repositories';
import type { Member, MemberStatusChange, MemberWithLoans, NewMember } from '../../../domain/members/member';
import { DomainError } from '../../../domain/shared/domain-error';
import { isUniqueViolation } from '../pg-errors';
import { members } from '../schema';
import { microsText } from '../sql-helpers';
import { DrizzleRepository } from './base.repository';

const MEMBER = {
  id: members.id,
  email: members.email,
  name: members.name,
  role: members.role,
  status: members.status,
  maxActiveLoans: members.maxActiveLoans,
  createdAt: members.createdAt,
};

// Written out as "members"."id": Drizzle renders ${members.id} unqualified in single-table selects, and inside
// this subquery an unqualified "id" would resolve to loans.id.
const ACTIVE_LOANS = sql<number>`(SELECT count(*)::int FROM loans l WHERE l.member_id = "members"."id" AND l.returned_at IS NULL)`.mapWith(Number);

@Injectable()
export class DrizzleMemberRepository extends DrizzleRepository implements MemberRepository {
  async findCredentials(email: string): Promise<{ member: Member; passwordHash: string } | null> {
    const [row] = await this.db
      .select({ ...MEMBER, passwordHash: members.passwordHash })
      .from(members)
      .where(sql`lower(${members.email}) = lower(${email})`); // matches the ux_members_email (lower(email)) index
    if (!row) {
      return null;
    }
    const { passwordHash, ...member } = row;
    return { member, passwordHash };
  }

  async findById(id: string): Promise<MemberWithLoans | null> {
    const [row] = await this.db
      .select({ ...MEMBER, activeLoans: ACTIVE_LOANS })
      .from(members)
      .where(eq(members.id, id));
    return row ?? null;
  }

  async lockById(id: string): Promise<Member | null> {
    const [row] = await this.db.select(MEMBER).from(members).where(eq(members.id, id)).for('update');
    return row ?? null;
  }

  async findPage(after: CreatedKey | null, limit: number): Promise<Keyed<MemberWithLoans, CreatedKey>[]> {
    const rows = await this.db
      .select({ ...MEMBER, activeLoans: ACTIVE_LOANS, key: microsText(sql`${members.createdAt}`).mapWith(String) })
      .from(members)
      .where(after ? sql`(${members.createdAt}, ${members.id}) > (${after.createdAt}::timestamptz, ${after.id}::uuid)` : undefined)
      .orderBy(members.createdAt, members.id)
      .limit(limit);
    return rows.map(({ key, ...member }) => ({ item: member, key: { createdAt: key, id: member.id } }));
  }

  async updateStatus(id: string, change: MemberStatusChange): Promise<boolean> {
    const updated = await this.db
      .update(members)
      .set({ status: change.status, ...(change.maxActiveLoans !== undefined && { maxActiveLoans: change.maxActiveLoans }) })
      .where(eq(members.id, id))
      .returning({ id: members.id });
    return updated.length > 0;
  }

  async insert(member: NewMember): Promise<MemberWithLoans> {
    try {
      const [row] = await this.db
        .insert(members)
        .values({ email: member.email, name: member.name, passwordHash: member.passwordHash, maxActiveLoans: member.maxActiveLoans })
        .returning(MEMBER);
      if (!row) {
        throw new Error('INSERT … RETURNING returned no row');
      }
      return { ...row, activeLoans: 0 };
    } catch (error) {
      if (isUniqueViolation(error, 'ux_members_email')) {
        throw new DomainError('duplicate', 'A member with this e-mail already exists.');
      }
      throw error;
    }
  }
}
