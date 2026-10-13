import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { HealthProbe, MetricsExporter } from '../../../application/ports/services';
import { TOKENS } from '../../../application/ports/tokens';
import type { components } from '../../../generated/openapi';
import { Public } from '../auth/decorators';

export const CONTRACT_YAML = Symbol('ContractYaml');

type Health = components['schemas']['Health'];

@Public()
@Controller()
export class OpsController {
  constructor(
    @Inject(TOKENS.DatabaseProbe) private readonly database: HealthProbe,
    @Inject(TOKENS.CacheProbe) private readonly cache: HealthProbe,
    @Inject(TOKENS.MetricsExporter) private readonly metrics: MetricsExporter,
    @Inject(CONTRACT_YAML) private readonly contractYaml: string,
  ) {}

  @Get('health/live')
  live(): Health {
    return { status: 'UP' };
  }

  /** Not ready without the database; Redis being down only degrades the service (no cache, no limiting). */
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    const [db, redis] = await Promise.all([this.database.ping(), this.cache.ping()]);
    reply.status(db ? 200 : 503);
    return { status: db ? 'UP' : 'DOWN', checks: { db: db ? 'UP' : 'DOWN', redis: redis ? 'UP' : 'DOWN' } };
  }

  @Get('metrics')
  async scrape(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    reply.type(this.metrics.contentType());
    return this.metrics.render();
  }

  /** The shared contract, byte for byte; Swagger UI at /docs renders the same document. */
  @Get('openapi.yaml')
  contract(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.type('application/yaml; charset=utf-8');
    return this.contractYaml;
  }
}
