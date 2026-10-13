import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    /** True when we own the server and can give every test file its own database. */
    isolatedDatabases: boolean;
  }
}

/**
 * One Postgres 16 and one Redis 7 container for the whole run (Testcontainers needs Docker).
 * CI can instead pass TEST_DATABASE_URL and TEST_REDIS_URL (e.g. GitHub service containers); the tests then
 * share that database, which works because every test creates its own books and members.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const externalDb = process.env['TEST_DATABASE_URL'];
  const externalRedis = process.env['TEST_REDIS_URL'];
  if (externalDb && externalRedis) {
    project.provide('databaseUrl', externalDb);
    project.provide('redisUrl', externalRedis);
    project.provide('isolatedDatabases', process.env['TEST_ISOLATED_DATABASES'] === '1');
    return () => Promise.resolve();
  }

  let postgres: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  try {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').withDatabase('library').withUsername('library').withPassword('library').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
  } catch (error) {
    await Promise.allSettled([postgres?.stop(), redis?.stop()]);
    throw new Error('Integration tests need Docker (Testcontainers) or TEST_DATABASE_URL + TEST_REDIS_URL', { cause: error });
  }
  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
  project.provide('isolatedDatabases', true);
  return async () => {
    await Promise.allSettled([postgres.stop(), redis.stop()]);
  };
}
