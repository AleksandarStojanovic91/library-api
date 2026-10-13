import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import fastifySwagger, { type StaticDocumentSpec } from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { Logger } from 'nestjs-pino';
import { parse } from 'yaml';
import type { HttpMetrics, RateLimiter, TokenService } from './application/ports/services';
import { TOKENS } from './application/ports/tokens';
import type { AppConfig } from './config/app-config';
import { createRootLogger } from './infrastructure/observability/logger';
import { installHttpPipeline, requestIdFor } from './interface/http/hooks/http-pipeline';
import { installJsonParsers } from './interface/http/hooks/json-parsers';
import { AppModule } from './modules/app.module';

/**
 * Builds a fully initialised application (migrations applied, routes registered) without listening.
 * main.ts listens on a port; the integration tests drive it in-process with `app.inject()`.
 */
export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const rootLogger = createRootLogger(config.logLevel);
  const contractYaml = await readFile(config.contractPath, 'utf8');

  const adapter = new FastifyAdapter({
    loggerInstance: rootLogger,
    // Fastify's own two lines per request are replaced by one line with the route template (HTTP pipeline).
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: requestIdFor,
    bodyLimit: 1_048_576,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config, rootLogger, contractYaml), adapter, {
    bufferLogs: true,
    // JSON parsing is configured below (installJsonParsers), so Nest must not register its own parser.
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  installJsonParsers(fastify);
  installHttpPipeline(fastify, {
    tokens: app.get<TokenService>(TOKENS.TokenService),
    rateLimiter: app.get<RateLimiter>(TOKENS.RateLimiter),
    metrics: app.get<HttpMetrics>(TOKENS.HttpMetrics),
  });

  // Swagger UI renders the shared contract itself, not a document generated from this code.
  await app.register(fastifySwagger, { mode: 'static', specification: { document: parse(contractYaml) as StaticDocumentSpec['document'] } });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await app.init();
  return app;
}
