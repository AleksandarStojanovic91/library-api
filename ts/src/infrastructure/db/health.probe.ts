import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { HealthProbe } from '../../application/ports/services';
import { withTimeout } from '../time/with-timeout';
import { PG_POOL } from './database';

@Injectable()
export class PostgresProbe implements HealthProbe {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async ping(): Promise<boolean> {
    try {
      await withTimeout(this.pool.query('SELECT 1'), 2_000);
      return true;
    } catch {
      return false;
    }
  }
}
