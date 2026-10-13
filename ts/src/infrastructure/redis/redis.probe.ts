import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { HealthProbe } from '../../application/ports/services';
import { withTimeout } from '../time/with-timeout';
import { REDIS } from './redis.client';

@Injectable()
export class RedisProbe implements HealthProbe {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async ping(): Promise<boolean> {
    try {
      return (await withTimeout(this.redis.ping(), 1_000)) === 'PONG';
    } catch {
      return false;
    }
  }
}
