import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
// eslint-disable-next-line import/default
import pkg from '@opentelemetry/resources';
const { Resource } = pkg;
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { FastifyRequest } from 'fastify';

let sdk: NodeSDK | null = null;

export function initTracing(serviceName: string = 'hopwhistle-api'): void {
  if (sdk) {
    return; // Already initialized
  }

  const jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
  const enableTracing = process.env.ENABLE_TRACING !== 'false';

  // Temporarily disable tracing due to bundling issues with OpenTelemetry
  // TODO: Fix external configuration in tsup to properly exclude @opentelemetry packages
  return;

  if (!enableTracing) {
    return;
  }

  try {
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      }),
      traceExporter: new JaegerExporter({
        endpoint: jaegerEndpoint,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });

    sdk.start();
    console.log(`[Tracing] Initialized for ${serviceName}, exporting to ${jaegerEndpoint}`);
  } catch (error) {
    console.error('[Tracing] Failed to initialize:', error);
  }
}

export function shutdownTracing(): Promise<void> {
  if (sdk) {
    return sdk.shutdown();
  }
  return Promise.resolve();
}

export function getTraceContext(request: FastifyRequest): Record<string, string> {
  const traceparent = request.headers['traceparent'] as string;
  const tracestate = request.headers['tracestate'] as string;

  const context: Record<string, string> = {};
  if (traceparent) {
    context.traceparent = traceparent;
  }
  if (tracestate) {
    context.tracestate = tracestate;
  }

  return context;
}
