import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RateLimitDecision, RateLimiter } from '../../application/ports/services';
import { throttledWarn } from '../observability/throttled-warn';
import { REDIS } from './redis.client';

export const RATE_LIMIT_PER_MINUTE = Symbol('RateLimitPerMinute');
export const RATE_LIMIT_NAMESPACE = Symbol('RateLimitNamespace');

const WINDOW_MS = 60_000;

/**
 * Fixed one-minute windows: key `{namespace}:{client}:{epochMinute}` (namespace defaults to `rl`), INCR + EXPIRE in one MULTI. Cheap and good
 * enough for an API like this; the known weakness is a burst of up to 2x the limit across a window edge.
 */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  private readonly warn = throttledWarn(new Logger(RedisRateLimiter.name));

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(RATE_LIMIT_PER_MINUTE) private readonly limit: number,
    @Inject(RATE_LIMIT_NAMESPACE) private readonly namespace: string,
  ) {}

  async consume(clientKey: string): Promise<RateLimitDecision | null> {
    const nowMs = Date.now();
    const epochMinute = Math.floor(nowMs / WINDOW_MS);
    const key = `${this.namespace}:${clientKey}:${epochMinute}`;
    try {
      const results = await this.redis.multi().incr(key).expire(key, 2 * (WINDOW_MS / 1000)).exec();
      const [incrError, count] = results?.[0] ?? [new Error('Empty MULTI result'), null];
      if (incrError || typeof count !== 'number') {
        throw incrError ?? new Error('Unexpected INCR result');
      }
      return {
        allowed: count <= this.limit,
        limit: this.limit,
        remaining: Math.max(0, this.limit - count),
        resetSeconds: Math.max(1, Math.ceil(((epochMinute + 1) * WINDOW_MS - nowMs) / 1000)),
      };
    } catch (error) {
      this.warn(error, 'Rate limiter unavailable; allowing the request');
      return null;
    }
  }
}
