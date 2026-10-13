import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { throttledWarn } from '../observability/throttled-warn';

export const REDIS = Symbol('Redis');

/**
 * Redis is an optimisation here (cache, rate limiting), never a dependency of correctness, so the client is
 * tuned to fail fast: no offline queue (a command while disconnected errors immediately instead of waiting),
 * a short command timeout, and endless background reconnects.
 */
export function createRedis(url: string): Redis {
  const warn = throttledWarn(new Logger('Redis'));
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  client.on('error', (error) => warn(error, 'Redis connection problem; continuing without cache and rate limiting'));
  return client;
}
