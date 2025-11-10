import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export function initTracing(serviceName: string = 'hopwhistle-worker'): void {
  if (sdk) {
    return; // Already initialized
  }

  const jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';
  const enableTracing = process.env.ENABLE_TRACING !== 'false';

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

