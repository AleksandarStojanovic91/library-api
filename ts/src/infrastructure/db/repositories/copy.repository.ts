import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { CopyRepository } from '../../../application/ports/repositories';
import type { Copy, CopyStatus } from '../../../domain/catalog/catalog';
import { DomainError } from '../../../domain/shared/domain-error';
import { isUniqueViolation } from '../pg-errors';
import { copies } from '../schema';
import { DrizzleRepository } from './base.repository';

const COPY = { id: copies.id, bookId: copies.bookId, barcode: copies.barcode, status: copies.status, createdAt: copies.createdAt };

@Injectable()
export class DrizzleCopyRepository extends DrizzleRepository implements CopyRepository {
  listByBook(bookId: string): Promise<Copy[]> {
    return this.db.select(COPY).from(copies).where(eq(copies.bookId, bookId)).orderBy(asc(copies.createdAt), asc(copies.barcode));
  }

  async insert(bookId: string, barcode: string): Promise<Copy> {
    try {
      const [row] = await this.db.insert(copies).values({ bookId, barcode }).returning(COPY);
      if (!row) {
        throw new Error('INSERT … RETURNING returned no row');
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error, 'copies_barcode_key')) {
        throw new DomainError('duplicate', `A copy with barcode ${barcode} already exists.`);
      }
      throw error;
    }
  }

  async claimAvailable(bookId: string): Promise<Copy | null> {
    const [row] = await this.db
      .select(COPY)
      .from(copies)
      .where(and(eq(copies.bookId, bookId), eq(copies.status, 'AVAILABLE')))
      .orderBy(asc(copies.createdAt), asc(copies.id))
      .limit(1)
      .for('update', { skipLocked: true });
    return row ?? null;
  }

  async lockById(id: string): Promise<Copy | null> {
    const [row] = await this.db.select(COPY).from(copies).where(eq(copies.id, id)).for('update');
    return row ?? null;
  }

  async setStatus(id: string, status: CopyStatus): Promise<void> {
    await this.db.update(copies).set({ status }).where(eq(copies.id, id));
  }

  async hasAvailable(bookId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: copies.id })
      .from(copies)
      .where(and(eq(copies.bookId, bookId), eq(copies.status, 'AVAILABLE')))
      .limit(1);
    return rows.length > 0;
  }

  async lockAllOfBook(bookId: string): Promise<CopyStatus[]> {
    const rows = await this.db.select({ status: copies.status }).from(copies).where(eq(copies.bookId, bookId)).for('update');
    return rows.map((row) => row.status);
  }
}
