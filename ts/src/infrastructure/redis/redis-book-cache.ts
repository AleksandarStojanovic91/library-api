import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { BookCache } from '../../application/ports/services';
import type { Book } from '../../domain/catalog/catalog';
import { throttledWarn } from '../observability/throttled-warn';
import { REDIS } from './redis.client';

const TTL_SECONDS = 60;
const keyOf = (id: string) => `book:${id}`;

type CachedBook = Omit<Book, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };

/** Every failure degrades to "cache miss": reads fall back to Postgres and a warning is logged. */
@Injectable()
export class RedisBookCache implements BookCache {
  private readonly warn = throttledWarn(new Logger(RedisBookCache.name));

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(id: string): Promise<Book | null> {
    try {
      const raw = await this.redis.get(keyOf(id));
      if (raw === null) {
        return null;
      }
      const cached = JSON.parse(raw) as CachedBook;
      return { ...cached, createdAt: new Date(cached.createdAt), updatedAt: new Date(cached.updatedAt) };
    } catch (error) {
      this.warn(error, 'Book cache read failed; reading from the database');
      return null;
    }
  }

  async put(book: Book): Promise<void> {
    try {
      await this.redis.set(keyOf(book.id), JSON.stringify(book), 'EX', TTL_SECONDS);
    } catch (error) {
      this.warn(error, 'Book cache write failed');
    }
  }

  async evict(id: string): Promise<void> {
    try {
      await this.redis.del(keyOf(id));
    } catch (error) {
      // The entry (if any) expires within TTL_SECONDS; until then GET /books/{id} may be stale.
      this.warn(error, 'Book cache eviction failed');
    }
  }
}
