import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import type { AuthorRepository, CreatedKey, Keyed } from '../../../application/ports/repositories';
import type { Author } from '../../../domain/catalog/catalog';
import { authors } from '../schema';
import { microsText } from '../sql-helpers';
import { DrizzleRepository } from './base.repository';

@Injectable()
export class DrizzleAuthorRepository extends DrizzleRepository implements AuthorRepository {
  async findPage(after: CreatedKey | null, limit: number): Promise<Keyed<Author, CreatedKey>[]> {
    const rows = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        bio: authors.bio,
        createdAt: authors.createdAt,
        key: microsText(sql`${authors.createdAt}`).mapWith(String),
      })
      .from(authors)
      .where(after ? sql`(${authors.createdAt}, ${authors.id}) > (${after.createdAt}::timestamptz, ${after.id}::uuid)` : undefined)
      .orderBy(authors.createdAt, authors.id)
      .limit(limit);
    return rows.map(({ key, ...author }) => ({ item: author, key: { createdAt: key, id: author.id } }));
  }

  async findById(id: string): Promise<Author | null> {
    const [row] = await this.db
      .select({ id: authors.id, name: authors.name, bio: authors.bio, createdAt: authors.createdAt })
      .from(authors)
      .where(eq(authors.id, id));
    return row ?? null;
  }

  async insert(author: { name: string; bio: string | null }): Promise<Author> {
    const [row] = await this.db
      .insert(authors)
      .values(author)
      .returning({ id: authors.id, name: authors.name, bio: authors.bio, createdAt: authors.createdAt });
    if (!row) {
      throw new Error('INSERT … RETURNING returned no row');
    }
    return row;
  }

  async findMissingIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    const found = await this.db.select({ id: authors.id }).from(authors).where(inArray(authors.id, [...ids]));
    const existing = new Set(found.map((row) => row.id.toLowerCase()));
    return ids.filter((id) => !existing.has(id.toLowerCase()));
  }
}
