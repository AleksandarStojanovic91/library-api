import { Inject, Injectable, Logger } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { OutboxRepository } from '../../application/ports/repositories';
import type { HttpMetrics, LendingMetrics, MetricsExporter } from '../../application/ports/services';
import { TOKENS } from '../../application/ports/tokens';

/** Metric names come from docs/SPEC.md and are shared with the Java service (Micrometer adds the same suffixes). */
@Injectable()
export class PrometheusMetrics implements LendingMetrics, HttpMetrics, MetricsExporter {
  private readonly logger = new Logger(PrometheusMetrics.name);
  private readonly registry = new Registry();
  private readonly httpRequests: Histogram<'method' | 'route' | 'status'>;
  private readonly loansBorrowed: Counter;
  private readonly loansReturned: Counter;

  constructor(@Inject(TOKENS.OutboxRepository) outbox: OutboxRepository) {
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Histogram({
      name: 'http_server_requests_seconds',
      help: 'HTTP server requests by method, route template and status',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    // prom-client exposes counter names verbatim (no automatic _total suffix), so the scraped name is set here.
    // "borrowed", not "created": a `_created` series is reserved in the OpenMetrics model (SPEC Decisions 24).
    this.loansBorrowed = new Counter({ name: 'library_loans_borrowed_total', help: 'Loans borrowed', registers: [this.registry] });
    this.loansReturned = new Counter({ name: 'library_loans_returned_total', help: 'Loans returned', registers: [this.registry] });
    const logger = this.logger;
    new Gauge({
      name: 'library_outbox_backlog',
      help: 'Outbox events not yet published',
      registers: [this.registry],
      // Read at scrape time, so the value is current even if the worker is stuck.
      async collect() {
        try {
          this.set(await outbox.countUnpublished());
        } catch (error) {
          logger.warn({ err: error }, 'Could not read the outbox backlog');
        }
      },
    });
  }

  observeRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpRequests.observe({ method, route, status: String(status) }, durationSeconds);
  }

  loanCreated(): void {
    this.loansBorrowed.inc();
  }

  loanReturned(): void {
    this.loansReturned.inc();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
