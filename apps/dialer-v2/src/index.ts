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
 * ── What this file no longer does ────────────────────────────────────────────
 *
 * It used to construct the runtime's dependencies by hand, and every one of
 * them was the in-memory or static implementation even though shared ones
 * existed and were tested. Selection now lives in `composition.ts`, driven by
 * `DIALER_V2_RUNTIME_MODE`, so what the running service holds is a testable
 * value rather than a sequence of `new` calls nobody asserts on.
 *
 * Public routes: `/health*`, `/status/*` — no tenant data.
 * Internal routes: `/internal/*` — require `DIALER_V2_INTERNAL_TOKEN`.
 */

import http from 'node:http';

import { AgentState } from './agents/state.js';
import { portWithDefault } from './config/env.js';
import { EnvFlagSource } from './config/flags.js';
import {
  INTERNAL_AUTH_ERROR_BODY,
  INTERNAL_TOKEN_HEADER,
  verifyInternalToken,
} from './config/internal-auth.js';
import { isValidTenantId } from './config/redis-keys.js';
import { buildHealthReport, type HealthSnapshot } from './health/report.js';
import {
  CompositionError,
  composeRuntime,
  readRuntimeMode,
  RuntimeMode,
  type RuntimeComposition,
} from './runtime/composition.js';
import { DialerV2Runtime, defaultRuntimeConfig } from './runtime/service.js';

const log = (record: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

/**
 * A fault found while reading configuration, before composition is even
 * attempted. Reported through readiness exactly like a composition failure.
 */
let startupFailure: string | null = null;

/**
 * Evaluate configuration without letting a bad value kill the process.
 *
 * Strict parsing means `defaultRuntimeConfig()`, the port, and the runtime mode
 * can all now throw at module scope. Letting that propagate would abort before
 * the HTTP server exists, so the container would crash-loop with the reason only
 * in stdout and `/health/ready` never answering at all. The requirement is the
 * opposite: stay up, serve liveness, and say through readiness precisely which
 * variable is wrong.
 *
 * The first fault is kept rather than the last: it is the one that caused the
 * fallbacks below it to be used, so it is the one worth acting on.
 */
function withoutCrashing<T>(work: () => T, fallback: T): T {
  try {
    return work();
  } catch (error) {
    startupFailure ??= (error as Error).message;
    return fallback;
  }
}

const PORT = withoutCrashing(() => portWithDefault(process.env, 'DIALER_V2_PORT', 9092), 9092);

const flagSource = new EnvFlagSource();

// The fallback is the same function over an empty environment: every safe
// default, ESL ingestion off. A service that could not read its configuration
// must not fall back to something more permissive than it was asked for.
const config = withoutCrashing(
  () => defaultRuntimeConfig(),
  defaultRuntimeConfig({} as NodeJS.ProcessEnv)
);

/** `'unresolved'` when the mode could not be determined. Never guessed. */
const MODE: RuntimeMode | 'unresolved' = withoutCrashing<RuntimeMode | 'unresolved'>(
  () => readRuntimeMode(process.env),
  'unresolved'
);

/** Identifies this replica in distributed locks. */
const OWNER_ID = `${process.env.HOSTNAME ?? 'dialer-v2'}-${process.pid}`;

/**
 * Set once composition succeeds. Until then every route other than liveness
 * reports why — a service that cannot assemble its backends must not answer as
 * though it had.
 */
let composition: RuntimeComposition | null = null;
let runtime: DialerV2Runtime | null = null;
let compositionFailure: string | null = null;

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

async function currentSnapshot(): Promise<HealthSnapshot> {
  const mode = MODE;

  if (!composition || !runtime) {
    // Composition failed. Report the truth: nothing is connected, nothing is
    // shared, nothing has been reconstructed. Reporting zeros against a
    // `memory` backend would be indistinguishable from an idle healthy service.
    return {
      eslConnected: false,
      eslDegraded: true,
      eslDetail: compositionFailure ?? startupFailure ?? 'composition has not completed',
      eslConsecutiveFailures: 0,
      redisConnected: false,
      postgresConnected: false,
      lastEventAgeMs: null,
      maxEventAgeMs: config.maxEventAgeMs,
      eventLagMs: 0,
      maxEventLagMs: config.maxEventLagMs,
      unresolvedEventCount: 0,
      staleAgentCount: 0,
      totalAgentCount: 0,
      reconciliationLagMs: null,
      maxReconciliationLagMs: config.reconcileIntervalMs * 4,
      campaignsObserved: 0,
      shadowDecisionsRecorded: 0,
      mode,
      dedupeBackend: 'memory',
      decisionBackend: 'memory',
      decisionsFenced: false,
      sessionBackend: 'memory',
      agentStateBackend: 'memory',
      sipBackend: 'memory',
      observationBackend: 'memory',
      channelBackend: 'memory',
      extensionSource: 'static',
      assignmentSource: 'static',
      lockBackend: 'noop',
      reconstructionComplete: false,
      assignmentsResolvable: false,
      shadowWritesRejected: 0,
      agentStateStaleWrites: 0,
      registrationsOutOfOrder: 0,
    };
  }

  const status = runtime.status();
  const ingestor = runtime.getIngestor();
  const backends = composition.backends;

  return {
    eslConnected: status.esl?.connected ?? false,
    eslDegraded: status.esl?.degraded ?? false,
    eslDetail: status.esl?.detail ?? status.eslRefusal ?? 'ESL ingestion not started',
    eslConsecutiveFailures: status.esl?.consecutiveFailures ?? 0,

    // Real connection state, both of them. There is no hardcoded value here.
    redisConnected: composition.redisHealthy(),
    postgresConnected: composition.postgresHealthy(),

    lastEventAgeMs: ingestor.lastEventAgeMs(),
    maxEventAgeMs: config.maxEventAgeMs,
    eventLagMs: ingestor.currentLagMs(),
    maxEventLagMs: config.maxEventLagMs,

    unresolvedEventCount: await composition.stores.eventStore.quarantinedCount(),
    staleAgentCount: composition.agents.staleCount(),
    totalAgentCount: composition.agents.size(),
    reconciliationLagMs:
      status.lastReconciliationAtMs === null ? null : Date.now() - status.lastReconciliationAtMs,
    maxReconciliationLagMs: config.reconcileIntervalMs * 4,

    campaignsObserved: status.observedScopes,
    shadowDecisionsRecorded: status.shadowDecisionsThisRun,

    mode: composition.mode,
    ...backends,
    reconstructionComplete: status.reconstructionComplete,
    assignmentsResolvable: composition.assignmentsResolvable(),
    shadowWritesRejected: status.shadowWritesRejected,
    agentStateStaleWrites: status.agentStaleWrites,
    registrationsOutOfOrder: status.registrationsOutOfOrder,
  };
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
    //
    // Liveness answers even when composition failed. An orchestrator that
    // restart-loops a service which is correctly refusing to start turns a
    // configuration error into an outage and hides the reason.
    if (path === '/health/live') {
      json(res, 200, { live: true, service: 'hopwhistle-dialer-v2' });
      return;
    }

    if (path === '/health/ready' || path === '/health') {
      void currentSnapshot().then(snap => {
        const report = buildHealthReport(flags, snap);
        json(res, report.ready ? 200 : 503, {
          ...report,
          compositionError: compositionFailure ?? undefined,
        });
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
        mode: readRuntimeMode(process.env),
        originationImplemented: false,
        // Reports WHETHER a token is configured, never its value or length.
        internalAuthConfigured: verifyInternalToken(
          process.env.DIALER_V2_INTERNAL_TOKEN,
          process.env.DIALER_V2_INTERNAL_TOKEN
        ).ok,
      });
      return;
    }

    if (!composition || !runtime) {
      json(res, 503, {
        error: 'composition_failed',
        detail: compositionFailure ?? 'the runtime has not been composed',
      });
      return;
    }

    const live = composition;
    const engine = runtime;

    if (path === '/status/ingestion') {
      const status = engine.status();
      json(res, 200, {
        metrics: engine.getIngestor().getMetrics(),
        collector: engine.getCollector().metrics(),
        lastEventAgeMs: engine.getIngestor().lastEventAgeMs(),
        eventLagMs: engine.getIngestor().currentLagMs(),
        eslStarted: status.eslStarted,
        eslRefusal: status.eslRefusal,
        lastShadowRunAtMs: status.lastShadowRunAtMs,
        shadowDecisionsThisRun: status.shadowDecisionsThisRun,
        backends: live.backends,
        redisHealthy: status.redisHealthy,
        shadowPassesSkippedForLock: status.shadowPassesSkippedForLock,
        shadowWritesRejected: status.shadowWritesRejected,
        shadowScopesUnkeyable: status.shadowScopesUnkeyable,
        reconcilePassesSkippedForLock: status.reconcilePassesSkippedForLock,
        reconstructionComplete: status.reconstructionComplete,
        sip: status.sip,
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

        void live.stores.shadowStore.recent(tenantId, limit, campaignId).then(decisions => {
          json(res, 200, {
            tenantId,
            campaignId: campaignId ?? null,
            // Whether this answer spans every campaign or one. Without it an
            // empty list is ambiguous between "no decisions" and "the store
            // cannot answer an unfiltered query", which is exactly how the
            // previous behaviour misled: it returned [] for the second case.
            scope: campaignId ? 'campaign' : 'tenant',
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
          agents: live.agents.listForTenant(tenantId).map(a => ({
            agentId: a.agentId,
            state: a.state,
            sipRegistered: a.sipRegistered,
            revision: a.revision,
            lastHeartbeatAgeMs:
              a.lastBrowserHeartbeatAtMs === null ? null : nowMs - a.lastBrowserHeartbeatAtMs,
            currentChannelUuid: a.currentChannelUuid,
            campaignIds: a.campaignIds,
            countedAsCapacity: a.state === AgentState.AVAILABLE && a.sipRegistered,
            lastReconciliationReason: a.lastReconciliationReason,
          })),
          capacity: live.agents.capacity(tenantId, nowMs),
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
          corrections: live.agents
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
        void readBody(req).then(async body => {
          const input = body as Record<string, unknown>;
          const bodyTenant = typeof input.tenantId === 'string' ? input.tenantId : '';
          const agentId = typeof input.agentId === 'string' ? input.agentId : '';
          const userId = typeof input.userId === 'string' ? input.userId : agentId;

          if (!isValidTenantId(bodyTenant) || !agentId) {
            json(res, 400, { error: 'invalid_identity' });
            return;
          }

          const session = await engine.issueSession(bodyTenant, agentId, userId);
          if (!session) {
            json(res, 400, { error: 'invalid_identity' });
            return;
          }
          // The token crosses this internal, token-authenticated boundary once,
          // to the API, which puts it straight into an HttpOnly cookie. It is
          // never returned to a browser as JSON and never logged.
          json(res, 200, {
            sessionToken: session.token,
            sessionTokenHash: session.sessionTokenHash,
            expiresAtMs: session.expiresAtMs,
            issuedAtMs: session.issuedAtMs,
          });
        });
        return;
      }

      if (path === '/internal/agents/session/revoke' && req.method === 'POST') {
        void readBody(req).then(async body => {
          const input = body as Record<string, unknown>;
          const bodyTenant = typeof input.tenantId === 'string' ? input.tenantId : '';
          const hash = typeof input.sessionTokenHash === 'string' ? input.sessionTokenHash : '';

          if (!isValidTenantId(bodyTenant) || !hash) {
            json(res, 400, { error: 'invalid_identity' });
            return;
          }
          const revoked = await engine.revokeSession(bodyTenant, hash, 'logout');
          json(res, 200, { revoked });
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

          // Tenant and agent were derived from a verified JWT in apps/api, and
          // the session token was read there from an HttpOnly cookie — it is
          // never in a browser-visible payload. Call ids, channel UUIDs, SIP
          // state, and campaign membership are NOT read from this payload; the
          // runtime derives all four server-side.
          void engine
            .recordHeartbeat({
              tenantId: bodyTenant,
              agentId,
              userId,
              sessionToken: typeof input.sessionToken === 'string' ? input.sessionToken : '',
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

/** Tenants this replica reconstructs at startup. */
function reconstructionTenants(): string[] {
  return (process.env.DIALER_V2_ALLOWED_TENANT_IDS ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(t => isValidTenantId(t));
}

async function main(): Promise<void> {
  const flags = flagSource.get();
  const mode = MODE;

  try {
    // A configuration fault found at module scope is fatal to composition too —
    // composing on top of fallback values would produce a service that runs on
    // settings nobody wrote. Surfaced here so readiness reports the variable
    // rather than a downstream symptom of it.
    if (startupFailure) throw new Error(startupFailure);

    composition = await composeRuntime(process.env, {
      ownerId: OWNER_ID,
      shadowIntervalMs: config.shadowIntervalMs,
      log,
    });

    runtime = new DialerV2Runtime({
      flags: flagSource,
      eventStore: composition.stores.eventStore,
      dedupe: composition.stores.dedupe,
      shadowStore: composition.stores.shadowStore,
      agents: composition.agents,
      agentStore: composition.agentStore,
      sessions: composition.sessions,
      assignments: composition.assignments,
      sip: composition.sip,
      observations: composition.observations,
      channels: composition.channels,
      extensions: composition.extensions,
      lock: composition.stores.lock,
      redisHealthy: () => composition?.redisHealthy() ?? false,
      onAudit: record => log({ msg: 'agent heartbeat', ...record }),
      config,
      log,
    });

    // Reconstruct BEFORE starting the loops. A shadow pass over an empty agent
    // map would record a decision claiming zero capacity, and that decision
    // goes into the same history a promotion decision is read from.
    await runtime.reconstruct(reconstructionTenants());
    runtime.start();
  } catch (error) {
    compositionFailure =
      error instanceof CompositionError ? error.message : (error as Error).message;
    // Deliberately not fatal. The process stays up to serve liveness and to
    // report, through readiness, exactly which requirement was not met.
    log({ msg: 'dialer-v2 composition failed', mode, error: compositionFailure });
  }

  const server = createServer();

  server.listen(PORT, '0.0.0.0', () => {
    log({
      msg: composition
        ? 'dialer-v2 started (phase 1: ingestion + shadow pacing; no origination path exists)'
        : 'dialer-v2 started in a refusing state; readiness reports why',
      port: PORT,
      mode,
      enabled: flags.enabled,
      shadowEnabled: flags.shadowEnabled,
      eslIngestEnabled: config.esl.enabled,
      emergencyStop: flags.emergencyStop,
      strictBackends:
        mode === RuntimeMode.STAGING || mode === RuntimeMode.PRODUCTION || mode === 'unresolved',
    });
  });

  const shutdown = (): void => {
    runtime?.stop();
    void composition?.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) void main();

export { composition, currentSnapshot, flagSource, runtime };
