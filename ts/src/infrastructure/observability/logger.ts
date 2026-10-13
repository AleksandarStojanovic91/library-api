import { pino, stdTimeFunctions, type Logger } from 'pino';

/**
 * One pino instance for the whole process: Fastify uses it (request logs), nestjs-pino uses it (application
 * logs, with the request id bound through AsyncLocalStorage). JSON to stdout, one object per line.
 */
export function createRootLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'library-api-ts' },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: ['req.headers.authorization', 'password', '*.password', 'accessToken'], censor: '[redacted]' },
  });
}
