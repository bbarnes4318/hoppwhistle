'use client';

import { ExternalLink, Loader2, Play, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { count, duration, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  RecordingPlayer,
  SheetDrawer,
  StatTile,
  StatusChip,
} from '@/components/domain';
import { isZeroFigure } from '@/components/domain/figures';
import type { StatusTone } from '@/components/domain/status-chip';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { AGENT_LIVE_STATUS_LABEL, agentLiveStatus } from '@/lib/agent-status';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { newYorkDayKey, nyDayBounds, PLATFORM_TIME_ZONE } from '@/lib/new-york-day';
import { cn, formatPhoneNumber } from '@/lib/utils';

/**
 * The Agents hub's Floor: who is on the phones right now, and how their day is
 * going.
 *
 * One card per agent, polled every five seconds while the tab is in front of
 * somebody. Clicking a card opens that agent's day -- every state change and
 * every call they answered, with the recording -- without leaving the floor.
 *
 * Today's figures are the server's (`getAgentBreakdown`, the table Delivery and
 * the Leaderboard read). Nothing here sums or divides them except to count
 * cards by status.
 */

/* ── The wire ─────────────────────────────────────────────────────────────── */

export interface FloorCurrentCall {
  callId: string;
  callerId: string | null;
  campaignName: string | null;
  buyerName: string | null;
  answeredAt: string;
  /** Seconds on the call when the server answered. */
  seconds: number;
}

export interface FloorAgent {
  id: string;
  name: string;
  extension: string | null;
  softphoneStatus: string;
  statusSince: string | null;
  availableForCalls: boolean;
  blockedBy: string | null;
  blockedReason: string | null;
  currentCall: FloorCurrentCall | null;
  today: {
    callsTaken: number;
    talkTimeSeconds: number;
    applications: number;
    annualizedPremium: number;
    closingPct: number | null;
    availableSeconds: number | null;
    occupancyPct: number | null;
  };
  lastCallAt: string | null;
}

export interface Floor {
  generatedAt: string;
  agents: FloorAgent[];
  /** The agency's own day, unattributed calls included. */
  agency?: { callsTaken: number; applications: number; closingPct: number | null };
}

export interface AgentActivityCall {
  id: string;
  createdAt: string;
  callerId: string | null;
  campaignName: string | null;
  buyerName: string | null;
  connectedDuration: number | null;
  disposition: string | null;
  primaryRecordingId: string | null;
}

export interface AgentActivity {
  stateEvents: Array<{ status: string; occurredAt: string }>;
  calls: AgentActivityCall[];
}

/* ── Status ───────────────────────────────────────────────────────────────── */

/** Where an agent stands on the floor, in the order the grid shows them. */
export type FloorStatus = 'ON_CALL' | 'READY' | 'AWAY' | 'BLOCKED' | 'OFFLINE';

const FLOOR_ORDER: Record<FloorStatus, number> = {
  ON_CALL: 0,
  READY: 1,
  AWAY: 2,
  BLOCKED: 3,
  OFFLINE: 4,
};

/*
 * The shared agent tones (`AGENT_LIVE_STATUS_TONE`) for the four presence
 * states, so a chip here matches the one on Today and on a campaign. A setup
 * blocker is the one state those screens have no chip for: it is a fault the
 * agency has to fix, so it takes the failure red.
 */
const FLOOR_TONE: Record<FloorStatus, StatusTone> = {
  READY: 'live',
  ON_CALL: 'ringing',
  AWAY: 'blocked',
  BLOCKED: 'dropped',
  OFFLINE: 'neutral',
};

/**
 * One agent's floor status.
 *
 * A call wins over everything: an agent holding a caller is on a call whatever
 * else is true. After that a setup blocker, because it is what stops the phone
 * ringing -- except the agent's own "phone off" switch, which is a person
 * stepping away and reads as Away, not as a fault.
 */
export function floorStatusOf(agent: FloorAgent): FloorStatus {
  const live = agentLiveStatus(agent.softphoneStatus);
  if (agent.currentCall || live === 'ON_CALL') return 'ON_CALL';
  if (agent.blockedBy === 'UNAVAILABLE') return 'AWAY';
  if (agent.blockedBy) return 'BLOCKED';
  return live;
}

function floorLabel(agent: FloorAgent, status: FloorStatus): string {
  if (status === 'BLOCKED') return "Can't take calls";
  if (status === 'AWAY' && agent.blockedBy === 'UNAVAILABLE') return 'Phone off';
  return AGENT_LIVE_STATUS_LABEL[status];
}

/** On a call, ready, away, blocked, offline; then by name. */
export function sortFloor(agents: FloorAgent[]): FloorAgent[] {
  return [...agents].sort(
    (a, b) =>
      FLOOR_ORDER[floorStatusOf(a)] - FLOOR_ORDER[floorStatusOf(b)] || a.name.localeCompare(b.name)
  );
}

/* ── Time ─────────────────────────────────────────────────────────────────── */

/** A clock that re-renders its caller every second. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** `m:ss`, or `h:mm:ss` past the hour -- a running timer's face. */
function timer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: PLATFORM_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

const TIME_WITH_SECONDS = new Intl.DateTimeFormat('en-US', {
  timeZone: PLATFORM_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

function clock(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/* ── The floor ────────────────────────────────────────────────────────────── */

const POLL_MS = 5_000;

export function AgentFloor(): JSX.Element {
  const [floor, setFloor] = useState<Floor | null>(null);
  /** When `floor` arrived, on this browser's clock -- timers run from here. */
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const platform = usePlatformContext();
  const now = useNow();

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<Floor>>('/api/v1/agent-roster/floor');
    if (response.error) {
      setError(response.error.message);
      return response.error.code === 'NO_ACTING_TENANT'
        ? ('refused' as const)
        : ('failed' as const);
    }
    const body = payload(response);
    setError(null);
    setFloor(body ? { ...body, agents: Array.isArray(body.agents) ? body.agents : [] } : null);
    setReceivedAt(Date.now());
    return 'ok' as const;
  }, []);

  const { loading } = useLivePoll(load, {
    intervalMs: POLL_MS,
    enabled: !platform.loading && !platform.needsAgency,
  });

  const agents = useMemo(() => sortFloor(floor?.agents ?? []), [floor]);

  const tally = useMemo(() => {
    const byStatus: Record<FloorStatus, number> = {
      ON_CALL: 0,
      READY: 0,
      AWAY: 0,
      BLOCKED: 0,
      OFFLINE: 0,
    };
    for (const agent of agents) byStatus[floorStatusOf(agent)] += 1;
    return byStatus;
  }, [agents]);

  /*
   * Seconds elapsed since the server's answer, on this browser's clock. Every
   * timer is the server's figure plus this, so a laptop whose clock is five
   * minutes out still counts a call from the right place.
   */
  const drift = Math.max(0, (now - receivedAt) / 1000);
  const serverNow = floor ? new Date(floor.generatedAt).getTime() : now;

  const secondsInStatus = (agent: FloorAgent): number | null =>
    agent.statusSince
      ? Math.max(0, (serverNow - new Date(agent.statusSince).getTime()) / 1000 + drift)
      : null;

  const opened = agents.find(agent => agent.id === openId) ?? null;

  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Ready', value: count(tally.READY) },
    { label: 'On a call', value: count(tally.ON_CALL) },
    {
      label: 'Away/Off',
      value: count(tally.AWAY + tally.OFFLINE + tally.BLOCKED),
      sub: tally.BLOCKED > 0 ? `${tally.BLOCKED} can't take calls` : undefined,
    },
    { label: 'Calls today', value: count(floor?.agency?.callsTaken ?? 0) },
    { label: 'Applications today', value: count(floor?.agency?.applications ?? 0) },
    { label: 'Closing % today', value: pct(floor?.agency?.closingPct ?? null, 1) },
  ];

  if (loading && !floor && !error) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading the floor
        </div>
      </div>
    );
  }

  return (
    <div className="page-canvas" data-testid="agent-floor">
      <PageHeader description="Who is ready, who is on a call, and how each agent's day is going." />

      {error ? <Notice tone="error" title={error} /> : null}

      {floor && agents.length === 0 ? (
        <EmptyState
          icon={Users}
          headline="No agents yet"
          body="Invite the agents who take your calls, and they will show up here as they sign in."
          action={{ label: 'Go to Roster', href: '/agents?tab=roster' }}
        />
      ) : null}

      {agents.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map(tile => (
              <StatTile
                key={tile.label}
                size={FLOOR_HEROES.has(tile.label) ? 'hero' : 'secondary'}
                label={tile.label}
                value={tile.value}
                sub={tile.sub}
                data-figure-label={tile.label}
                data-figure-value={tile.value}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1440px]:grid-cols-4">
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                secondsInStatus={secondsInStatus(agent)}
                callSeconds={agent.currentCall ? agent.currentCall.seconds + drift : null}
                onOpen={() => setOpenId(agent.id)}
              />
            ))}
          </div>
        </>
      ) : null}

      <AgentDayDrawer
        agent={opened}
        onOpenChange={open => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

/* ── A card ───────────────────────────────────────────────────────────────── */

function AgentCard({
  agent,
  secondsInStatus,
  callSeconds,
  onOpen,
}: {
  agent: FloorAgent;
  secondsInStatus: number | null;
  callSeconds: number | null;
  onOpen: () => void;
}): JSX.Element {
  const status = floorStatusOf(agent);
  const call = agent.currentCall;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-agent-card={agent.id}
      data-floor-status={status}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-card border border-rule bg-surface p-4 text-left shadow-card',
        'transition-shadow duration-150 ease-out ne-motion hover:border-rule-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="t-section truncate text-ink">{agent.name}</div>
          <div className="t-meta text-ink-3">
            {agent.extension ? `Ext ${agent.extension}` : 'No extension'}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip
            value={status}
            tone={FLOOR_TONE[status]}
            label={floorLabel(agent, status)}
            size="sm"
          />
          {secondsInStatus !== null ? (
            <span className="t-meta tabular-nums text-ink-3">{timer(secondsInStatus)}</span>
          ) : null}
        </div>
      </div>

      {status === 'BLOCKED' && agent.blockedReason ? (
        <div className="t-meta text-dropped-ink">{agent.blockedReason}</div>
      ) : null}

      {status === 'ON_CALL' ? (
        <div className="rounded-control bg-sunken px-3 py-2 t-meta text-ink-2">
          {call ? (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">
                  {call.callerId ? formatPhoneNumber(call.callerId) : 'Unknown caller'}
                </span>
                {call.campaignName ? ` · ${call.campaignName}` : null}
              </span>
              <span className="shrink-0 tabular-nums font-medium text-ink">
                {timer(callSeconds ?? call.seconds)}
              </span>
            </div>
          ) : (
            'On a call'
          )}
        </div>
      ) : null}

      <dl className="grid grid-cols-4 gap-2 border-t border-rule pt-3">
        <CardFigure label="Calls" value={count(agent.today.callsTaken)} />
        <CardFigure label="Talk" value={duration(agent.today.talkTimeSeconds)} />
        <CardFigure label="Apps" value={count(agent.today.applications)} />
        <CardFigure label="Close" value={pct(agent.today.closingPct, 0)} />
      </dl>
    </button>
  );
}

/** The floor's hero figures: who can take a call now, and the day so far. */
const FLOOR_HEROES = new Set(['Ready', 'On a call', 'Calls today', 'Applications today']);

function CardFigure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="t-caption text-ink-2">{label}</dt>
      <dd
        className={cn(
          't-body tabular-nums truncate',
          isZeroFigure(value) ? 'text-ink-3' : 'text-ink'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ── One agent's day ──────────────────────────────────────────────────────── */

function AgentDayDrawer({
  agent,
  onOpenChange,
}: {
  agent: FloorAgent | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const today = newYorkDayKey();
  const [day, setDay] = useState(today);
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agentId = agent?.id ?? null;

  // A different agent opens on today, not on whatever day the last one showed.
  useEffect(() => {
    setDay(newYorkDayKey());
  }, [agentId]);

  useEffect(() => {
    if (!agentId || !day) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActivity(null);
    void apiClient
      .get<Envelope<AgentActivity>>(
        `/api/v1/agent-roster/${agentId}/activity?${new URLSearchParams({ day }).toString()}`
      )
      .then(response => {
        if (cancelled) return;
        if (response.error) {
          setError(response.error.message);
          return;
        }
        const body = payload(response);
        setActivity({
          stateEvents: Array.isArray(body?.stateEvents) ? body.stateEvents : [],
          calls: Array.isArray(body?.calls) ? body.calls : [],
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, day]);

  const status = agent ? floorStatusOf(agent) : null;

  return (
    <SheetDrawer
      open={agent !== null}
      onOpenChange={onOpenChange}
      size="xl"
      title={agent?.name ?? 'Agent'}
      description={
        agent ? (
          <span className="inline-flex items-center gap-2">
            {agent.extension ? `Ext ${agent.extension}` : 'No extension'}
            {status ? (
              <StatusChip
                value={status}
                tone={FLOOR_TONE[status]}
                label={floorLabel(agent, status)}
                size="sm"
              />
            ) : null}
          </span>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
        <label htmlFor="agent-day" className="t-meta text-ink-3">
          Day
        </label>
        <Input
          id="agent-day"
          type="date"
          value={day}
          max={today}
          onChange={event => setDay(event.target.value || today)}
          className="h-8 w-[150px] px-2 text-xs"
        />
      </div>

      {error ? (
        <div className="px-4 py-3">
          <Notice tone="error" title={error} />
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-12 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading the day
        </div>
      ) : activity ? (
        <>
          <StatusLog events={activity.stateEvents} day={day} isToday={day === today} />
          <CallList calls={activity.calls} />
        </>
      ) : null}
    </SheetDrawer>
  );
}

/**
 * Every state change that day, each with how long it lasted: until the next
 * change, or -- for the last one -- until now on today, and the day's end on
 * any earlier day.
 */
function StatusLog({
  events,
  day,
  isToday,
}: {
  events: AgentActivity['stateEvents'];
  day: string;
  isToday: boolean;
}): JSX.Element {
  const dayEnd = nyDayBounds(day)?.endExclusive.getTime() ?? Date.now();
  const end = isToday ? Date.now() : dayEnd;

  return (
    <section className="border-b border-rule px-4 py-3">
      <h3 className="t-caption mb-2 text-ink-2">Status log</h3>
      {events.length === 0 ? (
        <p className="t-meta text-ink-3">No status changes recorded this day.</p>
      ) : (
        <ol className="space-y-1.5">
          {events.map((event, index) => {
            const from = new Date(event.occurredAt).getTime();
            const until =
              index + 1 < events.length ? new Date(events[index + 1].occurredAt).getTime() : end;
            const live = agentLiveStatus(event.status);
            const ongoing = isToday && index === events.length - 1;
            return (
              <li
                key={`${event.occurredAt}-${index}`}
                className="grid grid-cols-[80px_1fr_auto] items-center gap-3"
              >
                <span className="t-meta tabular-nums text-ink-3">
                  {TIME_WITH_SECONDS.format(new Date(event.occurredAt))}
                </span>
                <span>
                  <StatusChip
                    value={event.status}
                    tone={FLOOR_TONE[live]}
                    label={statusEventLabel(event.status)}
                    size="sm"
                  />
                </span>
                <span className="t-meta tabular-nums text-ink-2">
                  {duration(Math.max(0, Math.round((until - from) / 1000)))}
                  {ongoing ? ' so far' : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The state events carry the queue switch too, which presence does not. */
function statusEventLabel(status: string): string {
  if (status === 'on-queue') return 'Phone on';
  if (status === 'off-queue') return 'Phone off';
  if (status === 'dnd') return 'Do not disturb';
  return AGENT_LIVE_STATUS_LABEL[agentLiveStatus(status)];
}

function CallList({ calls }: { calls: AgentActivityCall[] }): JSX.Element {
  return (
    <section className="px-4 py-3">
      <h3 className="t-caption mb-2 text-ink-2">Calls</h3>
      {calls.length === 0 ? (
        <p className="t-meta text-ink-3">No calls answered this day.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {calls.map(call => (
            <CallRow key={call.id} call={call} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Resolve a recording id to something an `<audio>` can play, as Calls does. */
async function playableUrl(recordingId: string): Promise<string> {
  const response = await apiClient.get<{ url: string }>(`/api/v1/recordings/${recordingId}/url`);
  if (response.error || !response.data?.url) {
    throw new Error(response.error?.message || 'Playback failed');
  }
  let url = response.data.url;
  if (url.startsWith('/')) {
    const apiBaseUrl =
      typeof window !== 'undefined'
        ? window.location.origin
        : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    url = `${apiBaseUrl.replace(/\/$/, '')}${url}`;
  }
  return url;
}

function CallRow({ call }: { call: AgentActivityCall }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingId = call.primaryRecordingId;

  /*
   * Fetched on demand, not with the list. The URL is a short-lived signed
   * token, and a day can hold two hundred calls nobody is going to play.
   */
  const loadRecording = async (): Promise<void> => {
    if (!recordingId) return;
    setLoading(true);
    setError(null);
    try {
      setSrc(await playableUrl(recordingId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playback failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="space-y-2 py-3" data-call-row={call.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="t-meta tabular-nums text-ink-3">{clock(call.createdAt)}</span>
          <span className="ml-2 t-body font-medium text-ink">
            {call.callerId ? formatPhoneNumber(call.callerId) : 'Unknown caller'}
          </span>
        </div>
        <span className="t-meta tabular-nums text-ink-2">
          {call.connectedDuration !== null ? duration(call.connectedDuration) : '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-meta text-ink-3">
        <span>{call.campaignName ?? 'No campaign'}</span>
        {call.buyerName ? <span>→ {call.buyerName}</span> : null}
        {call.disposition ? (
          <StatusChip value={call.disposition} tone="neutral" dot={false} size="sm" />
        ) : null}
        <Link
          href={`/calls?call=${encodeURIComponent(call.id)}`}
          className="ml-auto inline-flex items-center gap-1 text-brand-ink hover:underline"
        >
          Open in Calls
          <ExternalLink aria-hidden className="h-3 w-3" />
        </Link>
      </div>
      {recordingId ? (
        src ? (
          <RecordingPlayer src={src} durationSeconds={call.connectedDuration ?? 0} />
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadRecording()}
              disabled={loading}
              className="h-7 rounded-control px-2 text-xs"
            >
              {loading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Play className="mr-1 h-3 w-3" />
              )}
              Recording
            </Button>
            {error ? <span className="t-meta text-dropped-ink">{error}</span> : null}
          </div>
        )
      ) : null}
    </li>
  );
}
