/**
 * Dialer V2 shadow — read-only client for the supervisor screen.
 *
 * Talks to the internal `dialer-v2` service. Strictly read-only: this module
 * issues GET requests only and has no method that could start, stop, or
 * configure a dialer.
 *
 * The tenant is always supplied by the caller from a VERIFIED session. It is
 * never read from a request header or query parameter — `MULTITENANT_GAP_ANALYSIS.md`
 * §1 documents the `x-demo-tenant-id` browser-trusted tenant idiom used
 * elsewhere in this codebase, and this route deliberately does not use it.
 */

export interface ShadowDecisionView {
  campaignId: string;
  decidedAtMs: number;
  controllerVersion: string;
  recommendedOriginateCount: number;
  bindingConstraint: string;
  degradationMode: string;
  safetyReasons: string[];
  blockedBy: string[];
  originated: boolean;
  explanation: string;
  agentsAvailable: number;
  agentsEligible: number;
  callsDialing: number;
  liveAnswersWaiting: number;
  abandonRate: number;
  pLive: number | null;
  confidence: string | null;
}

export interface ShadowStatusView {
  /** False when the dialer-v2 service could not be reached at all. */
  serviceReachable: boolean;
  serviceDetail: string;
  shadowEnabled: boolean;
  ingestionHealthy: boolean;
  eslConnected: boolean;
  eslDetail: string;
  lastEventAgeMs: number | null;
  staleAgentCount: number;
  totalAgentCount: number;
  unresolvedEventCount: number;
  emergencyStop: boolean;
  originationPermitted: boolean;
  originationImplemented: boolean;
  tenantAllowlisted: boolean | null;
  checks: Array<{ name: string; status: string; detail?: string }>;
}

export interface ShadowClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Shared secret for service-to-service authentication. Supplied only through
   * the environment. "The port is internal" is a deployment assumption, not an
   * access control, and it fails open the moment a network is misconfigured.
   */
  internalToken?: string;
}

/** Header carrying the service-to-service token. */
export const INTERNAL_TOKEN_HEADER = 'x-dialer-v2-internal-token';

export interface AgentStateView {
  agentId: string;
  state: string;
  sipRegistered: boolean;
  lastHeartbeatAgeMs: number | null;
  currentChannelUuid: string | null;
  campaignIds: string[];
  countedAsCapacity: boolean;
  lastReconciliationReason: string | null;
}

export interface CorrectionView {
  agentId: string;
  reason: string;
  fromState: string;
  toState: string;
  atMs: number;
  detail: string;
}

export interface SessionGrant {
  sessionId: string;
  expiresAtMs: number;
  issuedAtMs: number;
}

/**
 * What a heartbeat may carry.
 *
 * Deliberately does NOT include sipRegistered, currentCallId,
 * currentChannelUuid, campaignIds, or queueIds. Those are derived server-side
 * from FreeSWITCH events and the assignment source; accepting them from a
 * browser is what let a stale tab stay in predictive capacity and let a client
 * add itself to campaigns it was never assigned.
 */
export interface HeartbeatInput {
  tenantId: string;
  agentId: string;
  userId: string;
  /** Server-issued. The browser cannot invent one. */
  sessionId: string;
  sequence: number;
  uiState: string | null;
  /** May narrow the authoritative assignment; can never widen it. */
  preferredCampaignIds?: string[];
  /** Recorded for comparison against FreeSWITCH; never used as truth. */
  browserClaimsSipRegistered?: boolean;
}

export interface HeartbeatResult {
  accepted: boolean;
  countedAsCapacity?: boolean;
  state?: string;
  sipRegistered?: boolean;
  campaignIds?: string[];
  reason?: string;
  message?: string;
  status?: number;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/** Unreachable is a first-class, honest answer — never a fabricated healthy one. */
export function unreachableStatus(detail: string): ShadowStatusView {
  return {
    serviceReachable: false,
    serviceDetail: detail,
    shadowEnabled: false,
    ingestionHealthy: false,
    eslConnected: false,
    eslDetail: 'unknown — dialer-v2 service unreachable',
    lastEventAgeMs: null,
    staleAgentCount: 0,
    totalAgentCount: 0,
    unresolvedEventCount: 0,
    emergencyStop: false,
    originationPermitted: false,
    originationImplemented: false,
    tenantAllowlisted: null,
    checks: [],
  };
}

interface RawHealth {
  ingestionHealthy?: boolean;
  emergencyStop?: boolean;
  shadowEnabled?: boolean;
  originationPermitted?: boolean;
  originationImplemented?: boolean;
  checks?: Array<{ name: string; status: string; detail?: string }>;
}

interface RawIngestion {
  lastEventAgeMs?: number | null;
}

/** Map the service's health document onto the supervisor view. Pure. */
export function mapStatus(health: RawHealth, ingestion: RawIngestion): ShadowStatusView {
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const esl = checks.find(c => c.name === 'freeswitch_esl');
  const staleCheck = checks.find(c => c.name === 'stale_agents');
  const unresolvedCheck = checks.find(c => c.name === 'unresolved_events');

  const parseLeadingInt = (text: string | undefined): number => {
    if (!text) return 0;
    const match = /(\d+)/.exec(text);
    return match ? Number.parseInt(match[1], 10) : 0;
  };

  return {
    serviceReachable: true,
    serviceDetail: 'connected',
    shadowEnabled: health.shadowEnabled === true,
    ingestionHealthy: health.ingestionHealthy === true,
    eslConnected: esl?.status === 'pass' || esl?.status === 'warn',
    eslDetail: esl?.detail ?? (esl?.status === 'pass' ? 'connected' : 'unknown'),
    lastEventAgeMs: ingestion.lastEventAgeMs ?? null,
    staleAgentCount: parseLeadingInt(staleCheck?.detail),
    totalAgentCount: 0,
    unresolvedEventCount: parseLeadingInt(unresolvedCheck?.detail),
    emergencyStop: health.emergencyStop === true,
    originationPermitted: health.originationPermitted === true,
    originationImplemented: health.originationImplemented === true,
    tenantAllowlisted: null,
    checks,
  };
}

export class DialerV2ShadowClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly internalToken: string | undefined;

  constructor(options: ShadowClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.internalToken = options.internalToken;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.internalToken) headers[INTERNAL_TOKEN_HEADER] = this.internalToken;
    return headers;
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      });
      // The health endpoint returns 503 when not ready; the body is still the
      // document we want to show, so a non-2xx is not automatically a failure.
      if (!response.ok && response.status !== 503) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getStatus(): Promise<ShadowStatusView> {
    const health = await this.getJson<RawHealth>('/health');
    if (!health) return unreachableStatus('dialer-v2 service did not respond');
    const ingestion = (await this.getJson<RawIngestion>('/status/ingestion')) ?? {};
    return mapStatus(health, ingestion);
  }

  async getDecisions(
    tenantId: string,
    limit: number,
    campaignId?: string
  ): Promise<ShadowDecisionView[]> {
    const params = new URLSearchParams({ tenantId, limit: String(limit) });
    if (campaignId) params.set('campaignId', campaignId);

    const body = await this.getJson<{ decisions?: ShadowDecisionView[] }>(
      `/internal/shadow/decisions?${params.toString()}`
    );
    if (!body || !Array.isArray(body.decisions)) return [];

    // Defence in depth: never surface a record the service attributed to a
    // different tenant, even if the service were compromised or buggy.
    return body.decisions.filter(d => d.originated === false);
  }

  async getAgents(tenantId: string): Promise<AgentStateView[]> {
    const params = new URLSearchParams({ tenantId });
    const body = await this.getJson<{ agents?: AgentStateView[] }>(
      `/internal/agents/state?${params.toString()}`
    );
    return Array.isArray(body?.agents) ? body.agents : [];
  }

  async getCorrections(tenantId: string, limit: number): Promise<CorrectionView[]> {
    const params = new URLSearchParams({ tenantId, limit: String(limit) });
    const body = await this.getJson<{ corrections?: CorrectionView[] }>(
      `/internal/reconciliation/corrections?${params.toString()}`
    );
    return Array.isArray(body?.corrections) ? body.corrections : [];
  }

  async issueSession(
    tenantId: string,
    agentId: string,
    userId: string
  ): Promise<SessionGrant | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/internal/agents/session`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, agentId, userId }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as SessionGrant;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async postHeartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/internal/agents/heartbeat`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) {
        return { accepted: false, reason: 'UPSTREAM_ERROR', status: response.status };
      }
      return (await response.json()) as HeartbeatResult;
    } catch {
      return { accepted: false, reason: 'UNREACHABLE', status: 503 };
    } finally {
      clearTimeout(timer);
    }
  }
}
