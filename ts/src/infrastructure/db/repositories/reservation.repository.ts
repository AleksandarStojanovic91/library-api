import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { CreatedKey, Keyed, ReservationFilter, ReservationRepository } from '../../../application/ports/repositories';
import type { Reservation, ReservationStatus } from '../../../domain/lending/reservation';
import { DomainError } from '../../../domain/shared/domain-error';
import { isUniqueViolation } from '../pg-errors';
import { reservations } from '../schema';
import { toDate, toNullableDate, whereAll } from '../sql-helpers';
import { DrizzleRepository } from './base.repository';

interface ReservationRow extends Record<string, unknown> {
  id: string;
  book_id: string;
  member_id: string;
  status: ReservationStatus;
  held_copy_id: string | null;
  ready_until: Date | string | null;
  created_at: Date | string;
  position: number | null;
  k_created?: string;
}

/** Place in the FIFO queue: 1 + WAITING reservations for the same book created before this one. */
const COLUMNS = sql`
  r.id, r.book_id, r.member_id, r.status, r.held_copy_id, r.ready_until, r.created_at,
  CASE WHEN r.status = 'WAITING' THEN
    1 + (SELECT count(*)::int FROM reservations w
          WHERE w.book_id = r.book_id AND w.status = 'WAITING' AND (w.created_at, w.id) < (r.created_at, r.id))
  END AS position`;

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    bookId: row.book_id,
    memberId: row.member_id,
    status: row.status,
    position: row.position,
    heldCopyId: row.held_copy_id,
    readyUntil: toNullableDate(row.ready_until),
    createdAt: toDate(row.created_at),
  };
}

@Injectable()
export class DrizzleReservationRepository extends DrizzleRepository implements ReservationRepository {
  lockReady(memberId: string, bookId: string): Promise<Reservation | null> {
    return this.lockOne(sql`member_id = ${memberId}::uuid AND book_id = ${bookId}::uuid AND status = 'READY'`);
  }

  async hasOpen(memberId: string, bookId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.memberId, memberId), eq(reservations.bookId, bookId), inArray(reservations.status, ['WAITING', 'READY'])))
      .limit(1);
    return rows.length > 0;
  }

  async insert(memberId: string, bookId: string): Promise<string> {
    try {
      const [row] = await this.db.insert(reservations).values({ memberId, bookId }).returning({ id: reservations.id });
      if (!row) {
        throw new Error('INSERT … RETURNING returned no row');
      }
      return row.id;
    } catch (error) {
      if (isUniqueViolation(error, 'ux_reservations_open')) {
        throw new DomainError('already-reserved', 'You already have an open reservation for this book.');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Reservation | null> {
    const result = await this.db.execute<ReservationRow>(sql`SELECT ${COLUMNS} FROM reservations r WHERE r.id = ${id}::uuid`);
    const row = result.rows[0];
    return row ? toReservation(row) : null;
  }

  lockById(id: string): Promise<Reservation | null> {
    return this.lockOne(sql`id = ${id}::uuid`);
  }

  lockFirstWaiting(bookId: string): Promise<Reservation | null> {
    return this.lockOne(sql`book_id = ${bookId}::uuid AND status = 'WAITING'`, sql`ORDER BY created_at, id LIMIT 1`);
  }

  async markReady(id: string, copyId: string, readyUntil: Date): Promise<void> {
    await this.db
      .update(reservations)
      .set({ status: 'READY', heldCopyId: copyId, readyUntil, updatedAt: sql`now()` })
      .where(eq(reservations.id, id));
  }

  async close(id: string, status: 'FULFILLED' | 'CANCELLED' | 'EXPIRED'): Promise<void> {
    // The schema requires held_copy_id/ready_until to be set exactly when READY, so a closed one clears them.
    await this.db
      .update(reservations)
      .set({ status, heldCopyId: null, readyUntil: null, updatedAt: sql`now()` })
      .where(eq(reservations.id, id));
  }

  async findPage(filter: ReservationFilter, after: CreatedKey | null, limit: number): Promise<Keyed<Reservation, CreatedKey>[]> {
    const conditions: SQL[] = [];
    if (filter.memberId !== undefined) conditions.push(sql`r.member_id = ${filter.memberId}::uuid`);
    if (filter.bookId !== undefined) conditions.push(sql`r.book_id = ${filter.bookId}::uuid`);
    if (after !== null) conditions.push(sql`(r.created_at, r.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`);
    const result = await this.db.execute<ReservationRow & { k_created: string }>(sql`
      SELECT ${COLUMNS}, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS k_created
        FROM reservations r
       WHERE ${whereAll(conditions)}
       ORDER BY r.created_at, r.id
       LIMIT ${limit}`);
    return result.rows.map((row) => ({ item: toReservation(row), key: { createdAt: row.k_created, id: row.id } }));
  }

  async findExpiredReady(now: Date, limit: number): Promise<Array<{ id: string; bookId: string }>> {
    const result = await this.db.execute<{ id: string; book_id: string }>(sql`
      SELECT id, book_id FROM reservations
       WHERE status = 'READY' AND ready_until < ${now.toISOString()}::timestamptz
       ORDER BY ready_until
       LIMIT ${limit}`);
    return result.rows.map((row) => ({ id: row.id, bookId: row.book_id }));
  }

  /** Locks the matching row(s) FOR UPDATE in a CTE, then computes the queue position outside the lock clause. */
  private async lockOne(where: SQL, tail: SQL = sql``): Promise<Reservation | null> {
    const result = await this.db.execute<ReservationRow>(sql`
      WITH r AS (SELECT * FROM reservations WHERE ${where} ${tail} FOR UPDATE)
      SELECT ${COLUMNS} FROM r`);
    const row = result.rows[0];
    return row ? toReservation(row) : null;
  }
}
