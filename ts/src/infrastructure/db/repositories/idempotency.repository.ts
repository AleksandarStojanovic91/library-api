import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { IdempotencyRecord, IdempotencyRepository, StoredResponse } from '../../../application/ports/repositories';
import { idempotencyKeys } from '../schema';
import { DrizzleRepository } from './base.repository';

@Injectable()
export class DrizzleIdempotencyRepository extends DrizzleRepository implements IdempotencyRepository {
  async tryInsert(subject: string, key: string, requestHash: string): Promise<boolean> {
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({ subject, key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    return inserted.length > 0;
  }

  async find(subject: string, key: string): Promise<IdempotencyRecord | null> {
    const [row] = await this.db
      .select({
        requestHash: idempotencyKeys.requestHash,
        status: idempotencyKeys.responseStatus,
        body: idempotencyKeys.responseBody,
        headers: idempotencyKeys.responseHeaders,
      })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.subject, subject), eq(idempotencyKeys.key, key)));
    if (!row) {
      return null;
    }
    return {
      requestHash: row.requestHash,
      response: row.status === null ? null : { status: row.status, body: row.body, headers: row.headers ?? {} },
    };
  }

  async saveResponse(subject: string, key: string, response: StoredResponse): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ responseStatus: response.status, responseBody: response.body, responseHeaders: { ...response.headers } })
      .where(and(eq(idempotencyKeys.subject, subject), eq(idempotencyKeys.key, key)));
  }

  async deleteOlderThan(retentionSeconds: number): Promise<number> {
    const result = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, sql`now() - make_interval(secs => ${retentionSeconds})`));
    return result.rowCount ?? 0;
  }
}
