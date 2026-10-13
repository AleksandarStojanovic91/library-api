import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { TOKENS } from '../application/ports/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RedisBookCache } from '../infrastructure/redis/redis-book-cache';
import { RATE_LIMIT_NAMESPACE, RATE_LIMIT_PER_MINUTE, RedisRateLimiter } from '../infrastructure/redis/redis-rate-limiter';
import { createRedis, REDIS } from '../infrastructure/redis/redis.client';
import { RedisProbe } from '../infrastructure/redis/redis.probe';

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createRedis(config.redisUrl) },
    { provide: RATE_LIMIT_PER_MINUTE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.rateLimitPerMinute },
    { provide: RATE_LIMIT_NAMESPACE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.rateLimitNamespace },
    { provide: TOKENS.BookCache, useClass: RedisBookCache },
    { provide: TOKENS.RateLimiter, useClass: RedisRateLimiter },
    { provide: TOKENS.CacheProbe, useClass: RedisProbe },
    RedisLifecycle,
  ],
  exports: [TOKENS.BookCache, TOKENS.RateLimiter, TOKENS.CacheProbe],
})
export class RedisModule {}
