import 'dotenv-flow/config';
import http from 'http';

import { logger } from './lib/logger.js';
import { register } from './lib/metrics.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { BillingWorker } from './services/billing-worker.js';
import { ClickHouseETL } from './services/clickhouse-etl.js';


const billingWorker = new BillingWorker();
const clickhouseETL = new ClickHouseETL();

async function main() {
  try {
    // Initialize tracing
    initTracing('hopwhistle-worker');

    // Start metrics server
    const metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', 'text/plain');
        res.end(await register.metrics());
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
  } catch (error) {
    logger.error({ msg: 'Failed to start workers', err: error });
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info({ msg: 'Shutting down workers' });
    await shutdownTracing();
    await Promise.all([billingWorker.stop(), clickhouseETL.stop()]);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();

