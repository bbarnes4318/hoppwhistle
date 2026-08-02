/**
 * Dialer V2 — service entrypoint.
 *
 * PHASE 0 SCOPE. This process starts the health/observability surface and
 * nothing else. It does not connect to FreeSWITCH, does not poll for leads, and
 * has no code path that reaches an `originate`. Origination arrives in Phase 2,
 * behind `evaluateOriginationGate`.
 *
 * Deploying this container alongside the existing worker is therefore inert by
 * construction, which is the point: the rollout can be validated before any
 * dialing logic exists to go wrong.
 */

import http from 'node:http';

import { EnvFlagSource } from './config/flags.js';
import { buildHealthReport, type HealthSnapshot } from './health/report.js';

const PORT = Number(process.env.DIALER_V2_PORT) || 9092;

const flagSource = new EnvFlagSource();

/**
 * Phase 0 has no dependency clients, so the snapshot reports "not connected"
 * honestly rather than claiming health it cannot verify. Phase 1 replaces this
 * with real probes.
 */
function currentSnapshot(): HealthSnapshot {
  return {
    freeswitchConnected: false,
    redisConnected: false,
    postgresConnected: false,
    lastEventAgeMs: Number.MAX_SAFE_INTEGER,
    maxEventAgeMs: 5_000,
    agentStateAgeMs: Number.MAX_SAFE_INTEGER,
    maxAgentStateAgeMs: 10_000,
    campaignsOwned: 0,
    activeAttempts: 0,
  };
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const flags = flagSource.get();
    const url = req.url ?? '/';

    if (url === '/health/live') {
      json(res, 200, { live: true, service: 'hopwhistle-dialer-v2' });
      return;
    }

    if (url === '/health/ready' || url === '/health') {
      const report = buildHealthReport(flags, currentSnapshot());
      // Phase 0 is intentionally not "ready" to dial: readiness reflects the
      // dependencies a dialing service needs, and this build has none wired.
      json(res, report.ready ? 200 : 503, report);
      return;
    }

    if (url === '/status/flags') {
      // Flag values only — no secrets, no tenant data.
      json(res, 200, {
        enabled: flags.enabled,
        shadowEnabled: flags.shadowEnabled,
        originateEnabled: flags.originateEnabled,
        dryRun: flags.dryRun,
        emergencyStop: flags.emergencyStop,
        allowedTenantCount: flags.allowedTenantIds.length,
        allowedCampaignCount: flags.allowedCampaignIds.length,
        maxGlobalCps: flags.maxGlobalCps,
        maxGlobalCalls: flags.maxGlobalCalls,
        requireHealthyAgentHeartbeats: flags.requireHealthyAgentHeartbeats,
        phase: 0,
        originationImplemented: false,
      });
      return;
    }

    json(res, 404, { error: 'not_found' });
  });
}

function main(): void {
  const flags = flagSource.get();
  const server = createServer();

  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(
      `${JSON.stringify({
        msg: 'dialer-v2 started (phase 0: health surface only, no origination path exists)',
        port: PORT,
        enabled: flags.enabled,
        originateEnabled: flags.originateEnabled,
        dryRun: flags.dryRun,
        emergencyStop: flags.emergencyStop,
      })}\n`
    );
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only run when executed directly, so tests can import `createServer`.
if (process.argv[1] && process.argv[1].endsWith('index.ts')) main();
else if (process.argv[1] && process.argv[1].endsWith('index.js')) main();

export { flagSource };
