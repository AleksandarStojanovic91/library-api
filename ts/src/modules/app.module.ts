import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/app-config';
import { AuthGuard } from '../interface/http/auth/auth.guard';
import { ProblemFilter } from '../interface/http/problem/problem.filter';
import { CoreModule } from './core.module';
import { CatalogModule, LendingModule, MembersModule, OpsModule, WorkerModule } from './feature.modules';
import { ObservabilityModule } from './observability.module';
import { PersistenceModule } from './persistence.module';
import { RedisModule } from './redis.module';
import { SecurityModule } from './security.module';

/**
 * Composition root: the only place that knows which adapter implements which port. Everything under
 * src/modules may import from every layer; nothing else may import from src/modules.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, rootLogger: Logger, contractYaml: string): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            logger: rootLogger,
            // One request log line is written by the HTTP pipeline (with the route template); pino-http is
            // only here to bind the request id to application logs.
            autoLogging: false,
            quietReqLogger: true,
            genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
          },
        }),
        CoreModule.forRoot(config),
        PersistenceModule,
        RedisModule,
        SecurityModule,
        ObservabilityModule,
        CatalogModule,
        MembersModule,
        LendingModule,
        WorkerModule,
        OpsModule.forRoot(contractYaml),
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}
