/* eslint-disable @typescript-eslint/no-require-imports -- synchronous, conditional loading is the point here */
/**
 * OpenTelemetry tracing, on only when OTEL_EXPORTER_OTLP_ENDPOINT is set. The SDK is required synchronously
 * and before the rest of the app (see main.ts) because instrumentations work by patching modules as they
 * are loaded. When tracing is off, none of the OpenTelemetry packages are loaded at all.
 */
if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg') as typeof import('@opentelemetry/instrumentation-pg');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis') as typeof import('@opentelemetry/instrumentation-ioredis');

  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'library-api-ts',
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT (and headers) from the environment and appends /v1/traces.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/metrics' || (req.url ?? '').startsWith('/health/') }),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  // Flush spans on shutdown; registered before Nest's own handlers, so it runs first.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void sdk.shutdown().catch(() => undefined));
  }
}

export {};
