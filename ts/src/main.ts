// Tracing must be set up before anything else is loaded, so its instrumentations can patch http/pg/ioredis.
import './tracing';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadConfig } from './config/app-config';

/** SPEC: finish in-flight requests for at most 20 s after SIGTERM. */
const SHUTDOWN_GRACE_MS = 20_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  const logger = new Logger('Main');

  // On SIGTERM Nest stops accepting connections, waits for in-flight requests, stops the worker
  // (beforeApplicationShutdown) and closes the pools (onApplicationShutdown). The timer is the backstop.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} received, shutting down`);
      setTimeout(() => {
        logger.error(`Graceful shutdown took longer than ${SHUTDOWN_GRACE_MS} ms; exiting`);
        process.exit(1);
      }, SHUTDOWN_GRACE_MS).unref();
    });
  }

  if (config.jwtSecret.startsWith('dev-only-')) {
    logger.warn('Using the development JWT secret; set JWT_SECRET in any shared environment');
  }
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.log(`Library API (TypeScript) listening on port ${config.port}`);
}

main().catch((error: unknown) => {
  console.error('Failed to start', error);
  process.exit(1);
});
