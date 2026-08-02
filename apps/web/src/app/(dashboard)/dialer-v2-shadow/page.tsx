'use client';

/**
 * Dialer V2 — Shadow Mode supervisor screen.
 *
 * READ-ONLY. This page has no control that can start, pause, or configure a
 * dialer, and Dialer V2 has no origination code path at all in this build.
 *
 * Everything shown comes from the live API. When the service is unreachable or
 * has observed nothing, the page says so — it never renders placeholder metrics
 * that could be mistaken for a running dialer.
 *
 * Existing call-center pages are untouched; this is a new route.
 */

import { AlertTriangle, Eye, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const API_URL = typeof window !== 'undefined' ? window.location.origin : '';

interface AgentView {
  agentId: string;
  state: string;
  sipRegistered: boolean;
  lastHeartbeatAgeMs: number | null;
  countedAsCapacity: boolean;
  lastReconciliationReason: string | null;
}

interface CorrectionView {
  agentId: string;
  reason: string;
  fromState: string;
  toState: string;
  atMs: number;
  detail: string;
}

interface ShadowStatus {
  serviceReachable: boolean;
  serviceDetail: string;
  shadowEnabled: boolean;
  ingestionHealthy: boolean;
  eslConnected: boolean;
  eslDetail: string;
  lastEventAgeMs: number | null;
  staleAgentCount: number;
  unresolvedEventCount: number;
  emergencyStop: boolean;
  originationPermitted: boolean;
  originationImplemented: boolean;
  checks: Array<{ name: string; status: string; detail?: string }>;
}

interface ShadowDecision {
  campaignId: string;
  decidedAtMs: number;
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

function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-red-600 dark:text-red-400'
          : 'text-foreground';

  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function formatAge(ms: number | null): string {
  if (ms === null) return 'never';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export default function DialerV2ShadowPage() {
  const [status, setStatus] = useState<ShadowStatus | null>(null);
  const [decisions, setDecisions] = useState<ShadowDecision[] | null>(null);
  const [agents, setAgents] = useState<AgentView[] | null>(null);
  const [corrections, setCorrections] = useState<CorrectionView[] | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [statusRes, decisionsRes, agentsRes, correctionsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/dialer-v2/shadow/status`, { credentials: 'include' }),
        fetch(`${API_URL}/api/v1/dialer-v2/shadow/decisions?limit=25`, { credentials: 'include' }),
        fetch(`${API_URL}/api/v1/dialer-v2/agents/state`, { credentials: 'include' }),
        fetch(`${API_URL}/api/v1/dialer-v2/reconciliation/corrections`, { credentials: 'include' }),
      ]);

      if (statusRes.status === 401 || decisionsRes.status === 401) {
        setError('You are not signed in, or your session has expired.');
        setAuthenticated(false);
        setStatus(null);
        setDecisions(null);
        setAgents(null);
        setCorrections(null);
        return;
      }
      if (!statusRes.ok || !decisionsRes.ok) {
        setError('The shadow API returned an error.');
        return;
      }

      const statusBody = (await statusRes.json()) as { data: ShadowStatus };
      const decisionsBody = (await decisionsRes.json()) as { data: ShadowDecision[] };
      setStatus(statusBody.data);
      setDecisions(decisionsBody.data);
      setAuthenticated(true);

      if (agentsRes.ok) {
        setAgents(((await agentsRes.json()) as { data: AgentView[] }).data);
      }
      if (correctionsRes.ok) {
        setCorrections(((await correctionsRes.json()) as { data: CorrectionView[] }).data);
      }
    } catch {
      setError('Could not reach the shadow API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const latest = decisions && decisions.length > 0 ? decisions[0] : null;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Eye className="h-6 w-6" aria-hidden="true" />
            Dialer V2 — Shadow Mode
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Observation only. Dialer V2 has no origination code path in this build — these are
            decisions it <em>would</em> have made. No call has been placed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </header>

      {/* Required label. Rendered unconditionally, above every metric. */}
      <div
        role="status"
        className="rounded-lg border-2 border-amber-500/50 bg-amber-500/10 px-4 py-3 text-center text-sm font-semibold tracking-wide"
      >
        SHADOW MODE — NO CALLS ARE BEING PLACED
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>{error}</div>
        </div>
      ) : null}

      {loading && !status ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {status && !status.serviceReachable ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <strong>The Dialer V2 service is not reachable.</strong>
            <div className="mt-1 text-muted-foreground">
              {status.serviceDetail}. No data below is live.
            </div>
          </div>
        </div>
      ) : null}

      {status?.emergencyStop ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <strong>Emergency stop is engaged.</strong> No new calls would be placed.
        </div>
      ) : null}

      {status ? (
        <section aria-labelledby="pipeline-heading" className="space-y-3">
          <h2 id="pipeline-heading" className="text-sm font-medium text-muted-foreground">
            Ingestion pipeline
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="FreeSWITCH ESL"
              value={status.eslConnected ? 'Connected' : 'Disconnected'}
              hint={status.eslDetail}
              tone={status.eslConnected ? 'good' : 'bad'}
            />
            <Stat
              label="Last event"
              value={formatAge(status.lastEventAgeMs)}
              hint={status.lastEventAgeMs === null ? 'no telephony event observed yet' : undefined}
              tone={status.ingestionHealthy ? 'good' : 'warn'}
            />
            <Stat
              label="Stale agents"
              value={String(status.staleAgentCount)}
              hint="excluded from predictive capacity"
              tone={status.staleAgentCount > 0 ? 'warn' : 'neutral'}
            />
            <Stat
              label="Unresolved events"
              value={String(status.unresolvedEventCount)}
              hint="quarantined, no tenant could be proven"
              tone={status.unresolvedEventCount > 0 ? 'warn' : 'neutral'}
            />
            <Stat
              label="Authentication"
              value={authenticated ? 'Verified' : 'Not verified'}
              hint="session-derived tenant, never a header"
              tone={authenticated ? 'good' : 'bad'}
            />
            <Stat
              label="Shadow mode"
              value={status.shadowEnabled ? 'Enabled' : 'Disabled'}
              tone={status.shadowEnabled ? 'good' : 'warn'}
            />
            <Stat
              label="Origination"
              value={status.originationImplemented ? 'IMPLEMENTED' : 'No code path'}
              hint="Dialer V2 cannot place a call in this build"
              tone={status.originationImplemented ? 'bad' : 'good'}
            />
          </div>
        </section>
      ) : null}

      {latest ? (
        <section aria-labelledby="pacing-heading" className="space-y-3">
          <h2 id="pacing-heading" className="text-sm font-medium text-muted-foreground">
            Most recent shadow decision
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Would originate"
              value={String(latest.recommendedOriginateCount)}
              hint="hypothetical — no call placed"
            />
            <Stat
              label="Pacing mode"
              value={latest.degradationMode}
              hint={latest.confidence ?? ''}
            />
            <Stat
              label="Agents available"
              value={String(latest.agentsAvailable)}
              hint={`${latest.agentsEligible} eligible`}
            />
            <Stat
              label="Abandonment"
              value={`${(latest.abandonRate * 100).toFixed(2)}%`}
              tone={latest.abandonRate >= 0.02 ? 'warn' : 'good'}
            />
          </div>
          <div className="rounded-lg border p-4 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Why it would act this way
            </div>
            <p className="mt-1">{latest.explanation}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Limiting factor: <code>{latest.bindingConstraint}</code>
              {latest.blockedBy.length > 0 ? ` · Blocked by: ${latest.blockedBy.join(', ')}` : ''}
            </p>
          </div>
        </section>
      ) : null}

      {agents ? (
        <section aria-labelledby="agents-heading" className="space-y-3">
          <h2 id="agents-heading" className="text-sm font-medium text-muted-foreground">
            Agents
          </h2>
          {agents.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No agents have reported to Dialer V2 yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Counted as capacity"
                value={String(agents.filter(a => a.countedAsCapacity).length)}
                hint="verified available and SIP-registered"
                tone="good"
              />
              <Stat
                label="Stale"
                value={String(agents.filter(a => a.state === 'STALE').length)}
                hint="excluded from predictive capacity"
                tone={agents.some(a => a.state === 'STALE') ? 'warn' : 'neutral'}
              />
              <Stat
                label="On calls"
                value={String(agents.filter(a => a.state === 'ON_CALL').length)}
              />
              <Stat
                label="SIP unregistered"
                value={String(agents.filter(a => !a.sipRegistered).length)}
                tone={agents.some(a => !a.sipRegistered) ? 'warn' : 'neutral'}
              />
            </div>
          )}
        </section>
      ) : null}

      {corrections && corrections.length > 0 ? (
        <section aria-labelledby="corrections-heading" className="space-y-3">
          <h2 id="corrections-heading" className="text-sm font-medium text-muted-foreground">
            Recent reconciliation corrections
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c, i) => (
                  <tr key={`${c.agentId}-${c.atMs}-${i}`} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {new Date(c.atMs).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2">{c.agentId}</td>
                    <td className="px-3 py-2">
                      {c.fromState} &rarr; {c.toState}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="decisions-heading" className="space-y-3">
        <h2 id="decisions-heading" className="text-sm font-medium text-muted-foreground">
          Recent shadow decisions
        </h2>

        {decisions && decisions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No shadow decisions have been recorded.</p>
            <p className="mt-1">
              Shadow mode has not observed any real campaign activity for your tenant yet. Nothing
              is being simulated or filled in — this table stays empty until real data arrives.
            </p>
          </div>
        ) : null}

        {decisions && decisions.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 text-right font-medium">Would dial</th>
                  <th className="px-3 py-2 text-right font-medium">Avail</th>
                  <th className="px-3 py-2 text-right font-medium">Dialing</th>
                  <th className="px-3 py-2 text-right font-medium">Waiting</th>
                  <th className="px-3 py-2 font-medium">Limiting factor</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr
                    key={`${d.campaignId}-${d.decidedAtMs}-${i}`}
                    className="border-b last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {new Date(d.decidedAtMs).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2">{d.campaignId}</td>
                    <td className="px-3 py-2">{d.degradationMode}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {d.recommendedOriginateCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.agentsAvailable}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.callsDialing}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.liveAnswersWaiting}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.bindingConstraint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <footer className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        <strong className="text-foreground">Shadow mode.</strong> Every row above is a decision the
        pacing controller would have made against observed state. Dialer V2 contains no code path
        that can place a call
        {status ? (status.originationImplemented ? '.' : ' in this build.') : '.'} Existing dialing
        — the Hopper, the agent softphone, and AI Voice — is unaffected by this page.
      </footer>
    </div>
  );
}
