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

import { AssignmentResolver, StaticAssignmentSource } from './agents/assignments.js';
import { ExtensionResolver, StaticExtensionSource } from './agents/extension-resolver.js';
import { AgentStateService } from './agents/service.js';
import { AgentSessionRegistry } from './agents/sessions.js';
import { SipRegistrationRegistry } from './agents/sip-registry.js';
import { AgentState } from './agents/state.js';
import { EnvFlagSource } from './config/flags.js';
import {
  INTERNAL_AUTH_ERROR_BODY,
  INTERNAL_TOKEN_HEADER,
  verifyInternalToken,
} from './config/internal-auth.js';
import { isValidTenantId } from './config/redis-keys.js';
import { buildHealthReport, type HealthSnapshot } from './health/report.js';
import { DialerV2Runtime, defaultRuntimeConfig } from './runtime/service.js';
import { buildStores, connectRedis, type RedisConnection } from './stores/provider.js';

const PORT = Number(process.env.DIALER_V2_PORT) || 9092;

const flagSource = new EnvFlagSource();
const agents = new AgentStateService();
const sessions = new AgentSessionRegistry();
const sipRegistry = new SipRegistrationRegistry();
const assignmentSource = new StaticAssignmentSource();
const assignments = new AssignmentResolver({ source: assignmentSource });

// Development fixture sources, explicitly labelled. The database-backed
// implementations are the remaining Phase 1 work; until they land, an agent
// resolves to no extension and no campaigns, so nobody becomes capacity by
// accident.
const extensionSource = new StaticExtensionSource();
const extensions = new ExtensionResolver({ source: extensionSource });
const config = defaultRuntimeConfig();

const log = (record: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

/** Identifies this replica in distributed locks. */
const OWNER_ID = `${process.env.HOSTNAME ?? 'dialer-v2'}-${process.pid}`;

let redisConnection: RedisConnection | null = null;
let stores = buildStores({ connection: null, ownerId: OWNER_ID }, process.env);

const runtime = new DialerV2Runtime({
  flags: flagSource,
  eventStore: stores.eventStore,
  dedupe: stores.dedupe,
  shadowStore: stores.shadowStore,
  agents,
  sessions,
  assignments,
  sipRegistry,
  extensions,
  lock: stores.lock,
  redisHealthy: () => stores.redisHealthy(),
  onAudit: record => log({ msg: 'agent heartbeat', ...record }),
  config,
  log,
});

async function currentSnapshot(): Promise<HealthSnapshot> {
  const status = runtime.status();
  const ingestor = runtime.getIngestor();

  return {
    eslConnected: status.esl?.connected ?? false,
    eslDegraded: status.esl?.degraded ?? false,
    eslDetail: status.esl?.detail ?? status.eslRefusal ?? 'ESL ingestion not started',
    eslConsecutiveFailures: status.esl?.consecutiveFailures ?? 0,

    // Real connection state. There is no hardcoded value here any more.
    redisConnected: stores.redisHealthy(),
    postgresConnected: false,

    lastEventAgeMs: ingestor.lastEventAgeMs(),
    maxEventAgeMs: config.maxEventAgeMs,
    eventLagMs: ingestor.currentLagMs(),
    maxEventLagMs: config.maxEventLagMs,

    unresolvedEventCount: await stores.eventStore.quarantinedCount(),
    staleAgentCount: agents.staleCount(),
    totalAgentCount: agents.size(),
    reconciliationLagMs:
      status.lastReconciliationAtMs === null ? null : Date.now() - status.lastReconciliationAtMs,
    maxReconciliationLagMs: config.reconcileIntervalMs * 4,

    campaignsObserved: status.observedScopes,
    shadowDecisionsRecorded: status.shadowDecisionsThisRun,
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
        storeBackend: stores.backend,
        redisHealthy: status.redisHealthy,
        lockDistributed: status.lockDistributed,
        shadowPassesSkippedForLock: status.shadowPassesSkippedForLock,
        reconcilePassesSkippedForLock: status.reconcilePassesSkippedForLock,
        sip: status.sip,
        sessions: sessions.size(),
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

        void stores.shadowStore.recent(tenantId, limit, campaignId).then(decisions => {
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

      if (path === '/internal/agents/session' && req.method === 'POST') {
        void readBody(req).then(body => {
          const input = body as Record<string, unknown>;
          const bodyTenant = typeof input.tenantId === 'string' ? input.tenantId : '';
          const agentId = typeof input.agentId === 'string' ? input.agentId : '';
          const userId = typeof input.userId === 'string' ? input.userId : agentId;

          if (!isValidTenantId(bodyTenant) || !agentId) {
            json(res, 400, { error: 'invalid_identity' });
            return;
          }

          const session = runtime.issueSession(bodyTenant, agentId, userId);
          if (!session) {
            json(res, 400, { error: 'invalid_identity' });
            return;
          }
          json(res, 200, {
            sessionId: session.sessionId,
            expiresAtMs: session.expiresAtMs,
            issuedAtMs: session.issuedAtMs,
          });
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

          // Tenant and agent were derived from a verified JWT in apps/api. Call
          // ids, channel UUIDs, SIP state, and campaign membership are NOT read
          // from this payload — the runtime derives all four server-side.
          void runtime
            .recordHeartbeat({
              tenantId: bodyTenant,
              agentId,
              userId,
              sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
              sequence: typeof input.sequence === 'number' ? input.sequence : 0,
              uiState: typeof input.uiState === 'string' ? input.uiState : null,
              preferredCampaignIds: Array.isArray(input.preferredCampaignIds)
                ? (input.preferredCampaignIds as string[])
                : undefined,
              browserClaimsSipRegistered: input.browserClaimsSipRegistered === true,
            })
            .then(result => {
              json(res, result.accepted ? 200 : 409, result);
            });
        });
        return;
      }

      json(res, 404, { error: 'not_found' });
      return;
    }

    json(res, 404, { error: 'not_found' });
  });
}

async function main(): Promise<void> {
  const flags = flagSource.get();

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    redisConnection = await connectRedis(redisUrl, (state, detail) =>
      log({ msg: 'redis', state, detail })
    );
    if (redisConnection) {
      stores = buildStores(
        {
          connection: redisConnection,
          ownerId: OWNER_ID,
          onFailure: (operation, error) =>
            log({ msg: 'redis failure', operation, error: error.message }),
        },
        process.env
      );
      runtime.replaceStores({
        eventStore: stores.eventStore,
        dedupe: stores.dedupe,
        shadowStore: stores.shadowStore,
        lock: stores.lock,
        redisHealthy: () => stores.redisHealthy(),
      });
    }
  }

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
    void redisConnection?.disconnect();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) void main();

export {
  agents,
  assignmentSource,
  extensionSource,
  flagSource,
  runtime,
  sessions,
  sipRegistry,
  stores,
};
