import 'dotenv-flow/config';
import http from 'http';

import { HopperState } from './config/hopper-gate.js';
import { logger } from './lib/logger.js';
import { register } from './lib/metrics.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { Autodialer } from './services/autodialer.js';
import { BillingWorker } from './services/billing-worker.js';
import { ClickHouseETL } from './services/clickhouse-etl.js';
import { DialerWorker } from './services/dialer-worker.js';
import { superviseLegacyHopper } from './services/hopper-supervisor.js';
import { IndustryResearchWorker } from './services/industry-research-worker.js';

const billingWorker = new BillingWorker();
const clickhouseETL = new ClickHouseETL();
const dialerWorker = new DialerWorker();
const dialer = new Autodialer();
const industryResearchWorker = new IndustryResearchWorker();

/**
 * The legacy Hopper's state, reported through `/health`.
 *
 * Deliberately NOT derived from the process being alive. Until 2026-08 this
 * worker started the Hopper unconditionally and the only thing preventing
 * outbound calls was a database error on every batch (audit finding F-1). An
 * accident is not a control, so the gate is, and the health surface has to be
 * able to say `disabled` while the worker itself is perfectly healthy.
 */
let hopperState: HopperState = HopperState.DISABLED;
let hopperDetail = 'not evaluated';

async function main() {
  try {
    // Initialize tracing
    initTracing('hopwhistle-worker');

    // Start metrics server
    const metricsServer = http.createServer((req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', 'text/plain');
        register
          .metrics()
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
        res.end(
          JSON.stringify({
            status: 'ok',
            service: 'hopwhistle-worker',
            // Reported separately from `status`, because the worker being
            // healthy and the Hopper being permitted are different facts and
            // conflating them is what made the previous state unreviewable.
            legacyHopper: { state: hopperState, detail: hopperDetail },
          })
        );
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

    // ── The legacy Hopper, gated ─────────────────────────────────────────
    //
    // This call used to be unconditional. It is now the single place the Hopper
    // can be started from, and it cannot start without an explicit enable AND a
    // named tenant or campaign scope. See config/hopper-gate.ts, and
    // docs/dialer-v2/F1_LEAD_STATUS_DIAGNOSIS.md for why the gate had to exist
    // before F-1 was repaired.
    const hopperStatus = await superviseLegacyHopper(process.env, dialerWorker, logger);
    hopperState = hopperStatus.state;
    hopperDetail = hopperStatus.detail;

    // Start Industry Research Worker (additive; gated by INDUSTRY_RESEARCH_ENABLED)
    if (process.env.INDUSTRY_RESEARCH_ENABLED !== 'false') {
      await industryResearchWorker.start();
      logger.info({ msg: 'Industry research worker started' });
    }

    // Legacy Autodialer is disabled: it double-dialed alongside The Hopper and
    // targeted the retired `didcentral` gateway. Kept for reference only.
    // await dialer.start();
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
      industryResearchWorker.stop(),
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
