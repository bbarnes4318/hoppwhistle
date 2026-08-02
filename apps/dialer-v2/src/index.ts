/**
 * Dialer V2 — service entrypoint.
 *
 * PHASE 1: live event ingestion, agent state, reconciliation, shadow pacing.
 *
 * NO ORIGINATION PATH EXISTS. The ESL transport can write exactly two commands
 * (`auth`, `event plain`) and rejects anything else before it reaches the
 * socket. Nothing in this service bridges, transfers, hangs up, or originates,
 * and nothing writes a lead status, campaign status, disposition, or billing
 * record.
 *
 * Public routes: `/health*`, `/status/*` — no tenant data.
 * Internal routes: `/internal/*` — require `DIALER_V2_INTERNAL_TOKEN`.
 */

import http from 'node:http';

import { AgentStateService } from './agents/service.js';
import { AgentState } from './agents/state.js';
import { EnvFlagSource } from './config/flags.js';
import {
  INTERNAL_AUTH_ERROR_BODY,
  INTERNAL_TOKEN_HEADER,
  verifyInternalToken,
} from './config/internal-auth.js';
import { isValidTenantId } from './config/redis-keys.js';
import { InMemoryDedupeStore, InMemoryEventStore } from './events/store.js';
import { buildHealthReport, type HealthSnapshot } from './health/report.js';
import { DialerV2Runtime, defaultRuntimeConfig } from './runtime/service.js';
import { InMemoryShadowDecisionStore } from './shadow/engine.js';

const PORT = Number(process.env.DIALER_V2_PORT) || 9092;

const flagSource = new EnvFlagSource();
const eventStore = new InMemoryEventStore();
const dedupeStore = new InMemoryDedupeStore();
const agents = new AgentStateService();
const shadowStore = new InMemoryShadowDecisionStore();
const config = defaultRuntimeConfig();

const runtime = new DialerV2Runtime({
  flags: flagSource,
  eventStore,
  dedupe: dedupeStore,
  shadowStore,
  agents,
  config,
  log: record => process.stdout.write(`${JSON.stringify(record)}\n`),
});

async function currentSnapshot(): Promise<HealthSnapshot> {
  const status = runtime.status();
  const ingestor = runtime.getIngestor();

  return {
    eslConnected: status.esl?.connected ?? false,
    eslDegraded: status.esl?.degraded ?? false,
    eslDetail: status.esl?.detail ?? status.eslRefusal ?? 'ESL ingestion not started',
    eslConsecutiveFailures: status.esl?.consecutiveFailures ?? 0,

    redisConnected: false,
    postgresConnected: false,

    lastEventAgeMs: ingestor.lastEventAgeMs(),
    maxEventAgeMs: config.maxEventAgeMs,
    eventLagMs: ingestor.currentLagMs(),
    maxEventLagMs: config.maxEventLagMs,

    unresolvedEventCount: await eventStore.quarantinedCount(),
    staleAgentCount: agents.staleCount(),
    totalAgentCount: agents.size(),
    reconciliationLagMs:
      status.lastReconciliationAtMs === null ? null : Date.now() - status.lastReconciliationAtMs,
    maxReconciliationLagMs: config.reconcileIntervalMs * 4,

    campaignsObserved: status.observedScopes,
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

/** Gate for `/internal/*`. Returns false when a 401 has already been sent. */
function internalAuthOk(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const presented = req.headers[INTERNAL_TOKEN_HEADER];
  const result = verifyInternalToken(
    process.env.DIALER_V2_INTERNAL_TOKEN,
    typeof presented === 'string' ? presented : undefined
  );
  if (!result.ok) {
    // Identical body for every failure mode; the reason is never disclosed.
    json(res, 401, INTERNAL_AUTH_ERROR_BODY);
    return false;
  }
  return true;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
      if (raw.length > 64_000) raw = raw.slice(0, 64_000);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    const flags = flagSource.get();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // ---- Public: no tenant data, no secrets -------------------------------
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
        // Reports WHETHER a token is configured, never its value or length.
        internalAuthConfigured: verifyInternalToken(
          process.env.DIALER_V2_INTERNAL_TOKEN,
          process.env.DIALER_V2_INTERNAL_TOKEN
        ).ok,
      });
      return;
    }

    if (path === '/status/ingestion') {
      const status = runtime.status();
      json(res, 200, {
        metrics: runtime.getIngestor().getMetrics(),
        collector: runtime.getCollector().metrics(),
        lastEventAgeMs: runtime.getIngestor().lastEventAgeMs(),
        eventLagMs: runtime.getIngestor().currentLagMs(),
        eslStarted: status.eslStarted,
        eslRefusal: status.eslRefusal,
        lastShadowRunAtMs: status.lastShadowRunAtMs,
        shadowDecisionsThisRun: status.shadowDecisionsThisRun,
      });
      return;
    }

    // ---- Internal: token required ------------------------------------------
    if (path.startsWith('/internal/')) {
      if (!internalAuthOk(req, res)) return;

      const tenantId = url.searchParams.get('tenantId');

      if (path === '/internal/shadow/decisions') {
        if (!tenantId || !isValidTenantId(tenantId)) {
          json(res, 400, { error: 'tenantId_required' });
          return;
        }
        const campaignId = url.searchParams.get('campaignId') ?? undefined;
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

        void shadowStore.recent(tenantId, limit, campaignId).then(decisions => {
          json(res, 200, {
            tenantId,
            shadowEnabled: flags.shadowEnabled,
            decisions: decisions.map(d => ({
              campaignId: d.campaignId,
              decidedAtMs: d.decidedAtMs,
              controllerVersion: d.controllerVersion,
              recommendedOriginateCount: d.recommendedOriginateCount,
              bindingConstraint: d.bindingConstraint,
              degradationMode: d.degradationMode,
              safetyReasons: d.safetyReasons,
              blockedBy: d.blockedBy,
              originated: d.originated,
              explanation: d.explanation,
              agentsAvailable: d.inputs.agentsAvailable,
              agentsEligible: d.inputs.agentsEligible,
              callsDialing: d.inputs.callsDialing,
              liveAnswersWaiting: d.inputs.callsLiveWaiting,
              abandonRate: d.inputs.abandonRate,
              pLive: d.decision?.pLive ?? null,
              confidence: d.decision?.confidence ?? null,
            })),
          });
        });
        return;
      }

      if (path === '/internal/agents/state') {
        if (!tenantId || !isValidTenantId(tenantId)) {
          json(res, 400, { error: 'tenantId_required' });
          return;
        }
        const nowMs = Date.now();
        json(res, 200, {
          tenantId,
          agents: agents.listForTenant(tenantId).map(a => ({
            agentId: a.agentId,
            state: a.state,
            sipRegistered: a.sipRegistered,
            lastHeartbeatAgeMs:
              a.lastBrowserHeartbeatAtMs === null ? null : nowMs - a.lastBrowserHeartbeatAtMs,
            currentChannelUuid: a.currentChannelUuid,
            campaignIds: a.campaignIds,
            countedAsCapacity: a.state === AgentState.AVAILABLE && a.sipRegistered,
            lastReconciliationReason: a.lastReconciliationReason,
          })),
          capacity: agents.capacity(tenantId, nowMs),
        });
        return;
      }

      if (path === '/internal/reconciliation/corrections') {
        if (!tenantId || !isValidTenantId(tenantId)) {
          json(res, 400, { error: 'tenantId_required' });
          return;
        }
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        json(res, 200, {
          tenantId,
          corrections: agents
            .recentCorrections(limit)
            .filter(c => c.tenantId === tenantId)
            .map(c => ({
              agentId: c.agentId,
              reason: c.reason,
              fromState: c.fromState,
              toState: c.toState,
              atMs: c.atMs,
              detail: c.detail,
            })),
        });
        return;
      }

      if (path === '/internal/agents/heartbeat' && req.method === 'POST') {
        void readBody(req).then(body => {
          const input = body as Record<string, unknown>;
          const bodyTenant = typeof input.tenantId === 'string' ? input.tenantId : '';
          const agentId = typeof input.agentId === 'string' ? input.agentId : '';
          const userId = typeof input.userId === 'string' ? input.userId : agentId;

          if (!isValidTenantId(bodyTenant) || !agentId) {
            json(res, 400, { accepted: false, reason: 'INVALID_IDENTITY' });
            return;
          }

          // The tenant here was already derived from a verified JWT in apps/api.
          // This service is not internet-reachable and requires the internal
          // token, so it trusts the identity the API asserts.
          const result = runtime.recordHeartbeat({
            tenantId: bodyTenant,
            agentId,
            userId,
            sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
            sequence: typeof input.sequence === 'number' ? input.sequence : 0,
            uiState: typeof input.uiState === 'string' ? input.uiState : null,
            sipRegistered: input.sipRegistered === true,
            currentCallId: typeof input.currentCallId === 'string' ? input.currentCallId : null,
            currentChannelUuid:
              typeof input.currentChannelUuid === 'string' ? input.currentChannelUuid : null,
            campaignIds: Array.isArray(input.campaignIds) ? (input.campaignIds as string[]) : [],
            queueIds: Array.isArray(input.queueIds) ? (input.queueIds as string[]) : [],
          });

          json(res, result.accepted ? 200 : 409, result);
        });
        return;
      }

      json(res, 404, { error: 'not_found' });
      return;
    }

    json(res, 404, { error: 'not_found' });
  });
}

function main(): void {
  const flags = flagSource.get();
  const server = createServer();

  runtime.start();

  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(
      `${JSON.stringify({
        msg: 'dialer-v2 started (phase 1: ingestion + shadow pacing; no origination path exists)',
        port: PORT,
        enabled: flags.enabled,
        shadowEnabled: flags.shadowEnabled,
        eslIngestEnabled: config.esl.enabled,
        emergencyStop: flags.emergencyStop,
      })}\n`
    );
  });

  const shutdown = (): void => {
    runtime.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) main();

export { agents, eventStore, flagSource, runtime, shadowStore };
