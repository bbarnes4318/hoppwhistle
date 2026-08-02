/**
 * Dialer V2 — service entrypoint.
 *
 * PHASE 1 SCOPE: event ingestion, agent state, reconciliation, and shadow
 * pacing. There is NO origination code path in this build — nothing here, and
 * nothing it imports, can write an `originate` to FreeSWITCH. The ESL client's
 * only write is its event subscription.
 *
 * The service starts with in-memory stores. Redis and PostgreSQL implementations
 * of `EventStore`/`DedupeStore`/`ShadowDecisionStore` slot in behind the same
 * interfaces without touching ingestion or pacing.
 */

import http from 'node:http';

import { AgentStateService } from './agents/service.js';
import { EnvFlagSource } from './config/flags.js';
import { EventIngestor } from './events/ingestor.js';
import { InMemoryDedupeStore, InMemoryEventStore } from './events/store.js';
import { buildHealthReport, type HealthSnapshot } from './health/report.js';
import { InMemoryShadowDecisionStore } from './shadow/engine.js';

const PORT = Number(process.env.DIALER_V2_PORT) || 9092;
const MAX_EVENT_AGE_MS = Number(process.env.DIALER_V2_MAX_EVENT_AGE_MS) || 60_000;
const MAX_EVENT_LAG_MS = Number(process.env.DIALER_V2_MAX_EVENT_LAG_MS) || 1_000;
const MAX_RECONCILE_LAG_MS = Number(process.env.DIALER_V2_MAX_RECONCILE_LAG_MS) || 30_000;

const flagSource = new EnvFlagSource();
const eventStore = new InMemoryEventStore();
const dedupeStore = new InMemoryDedupeStore();
const agents = new AgentStateService();
const shadowStore = new InMemoryShadowDecisionStore();
const ingestor = new EventIngestor({ store: eventStore, dedupe: dedupeStore });

/** Reconciliation timestamp, set by the reconcile loop once it is wired. */
const lastReconciliationAtMs: number | null = null;

async function currentSnapshot(): Promise<HealthSnapshot> {
  return {
    // The ESL client is not started in this build: no telephony credentials are
    // assumed, and reporting "connected" when nothing is connected is exactly
    // the failure mode CURRENT_STATE_AUDIT.md §5 documents.
    eslConnected: false,
    eslDegraded: false,
    eslDetail: 'ESL client not started in this build',
    eslConsecutiveFailures: 0,

    redisConnected: false,
    postgresConnected: false,

    lastEventAgeMs: ingestor.lastEventAgeMs(),
    maxEventAgeMs: MAX_EVENT_AGE_MS,
    eventLagMs: ingestor.currentLagMs(),
    maxEventLagMs: MAX_EVENT_LAG_MS,

    unresolvedEventCount: await eventStore.quarantinedCount(),
    staleAgentCount: agents.staleCount(),
    totalAgentCount: agents.size(),
    reconciliationLagMs:
      lastReconciliationAtMs === null ? null : Date.now() - lastReconciliationAtMs,
    maxReconciliationLagMs: MAX_RECONCILE_LAG_MS,

    campaignsObserved: 0,
    shadowDecisionsRecorded: shadowStore.size(),
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
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/health/live') {
      json(res, 200, { live: true, service: 'hopwhistle-dialer-v2' });
      return;
    }

    if (path === '/health/ready' || path === '/health') {
      void currentSnapshot().then(snap => {
        const report = buildHealthReport(flags, snap);
        json(res, report.ready ? 200 : 503, report);
      });
      return;
    }

    if (path === '/status/flags') {
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
        phase: 1,
        originationImplemented: false,
      });
      return;
    }

    if (path === '/status/ingestion') {
      json(res, 200, {
        metrics: ingestor.getMetrics(),
        lastEventAgeMs: ingestor.lastEventAgeMs(),
        eventLagMs: ingestor.currentLagMs(),
        trackedChannels: ingestor.trackedChannelCount(),
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
        msg: 'dialer-v2 started (phase 1: ingestion, agent state, shadow pacing; no origination path exists)',
        port: PORT,
        enabled: flags.enabled,
        shadowEnabled: flags.shadowEnabled,
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

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) main();

export { agents, eventStore, flagSource, ingestor, shadowStore };
