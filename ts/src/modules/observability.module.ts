import { Global, Module } from '@nestjs/common';
import { TOKENS } from '../application/ports/tokens';
import { PrometheusMetrics } from '../infrastructure/observability/prometheus-metrics';

@Global()
@Module({
  providers: [
    PrometheusMetrics,
    { provide: TOKENS.LendingMetrics, useExisting: PrometheusMetrics },
    { provide: TOKENS.HttpMetrics, useExisting: PrometheusMetrics },
    { provide: TOKENS.MetricsExporter, useExisting: PrometheusMetrics },
  ],
  exports: [TOKENS.LendingMetrics, TOKENS.HttpMetrics, TOKENS.MetricsExporter],
})
export class ObservabilityModule {}
