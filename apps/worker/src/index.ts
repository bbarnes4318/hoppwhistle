import 'dotenv-flow/config';
import http from 'http';

import { logger } from './lib/logger.js';
import { register } from './lib/metrics.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { Autodialer } from './services/autodialer.js';
import { BillingWorker } from './services/billing-worker.js';
import { ClickHouseETL } from './services/clickhouse-etl.js';
import { DialerWorker } from './services/dialer-worker.js';

const billingWorker = new BillingWorker();
const clickhouseETL = new ClickHouseETL();
const dialerWorker = new DialerWorker();
const dialer = new Autodialer();

async function main() {
  try {
    // Initialize tracing
    initTracing('hopwhistle-worker');

    // Start metrics server
    const metricsServer = http.createServer((req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', 'text/plain');
        register.metrics()
          .then(metrics => {
            res.end(metrics);
          })
          .catch((err: unknown) => {
            logger.error({ msg: 'Metrics generation failed', err });
            res.statusCode = 500;
            res.end('Error generating metrics');
          });
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', service: 'hopwhistle-worker' }));
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    const metricsPort = Number(process.env.METRICS_PORT) || 9091;
    metricsServer.listen(metricsPort, '0.0.0.0', () => {
      logger.info({ msg: 'Metrics server started', port: metricsPort });
    });

    logger.info({ msg: 'Workers starting' });

    // Start billing worker
    await billingWorker.start();
    logger.info({ msg: 'Billing worker started' });

    // Start ClickHouse ETL worker
    await clickhouseETL.start();
    logger.info({ msg: 'ClickHouse ETL worker started' });

    // Start Dialer Worker (The Hopper)
    await dialerWorker.start();
    logger.info({ msg: 'Dialer worker started' });

    // Start Autodialer
    await dialer.start();
    logger.info({ msg: 'Autodialer started' });
  } catch (error) {
    logger.error({ msg: 'Failed to start workers', err: error });
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info({ msg: 'Shutting down workers' });
    await shutdownTracing();
    await Promise.all([
      billingWorker.stop(),
      clickhouseETL.stop(),
      dialerWorker.stop(),
      dialer.stop(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

void main();
