'use client';

import { Download, Loader2, RefreshCw, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { count, dollars, duration, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  Toolbar,
  ToolbarActions,
  ToolbarDateRange,
  ToolbarMeta,
  ToolbarSelect,
} from '@/components/domain';
import {
  Board,
  Records,
  ScoringNote,
  showsOutbound,
  YourStanding,
} from '@/components/leaderboard/board';
import {
  isPeriodKey,
  isSendable,
  localDayKey,
  PERIOD_OPTIONS,
  periodQuery,
} from '@/components/leaderboard/period-picker';
import { Podium } from '@/components/leaderboard/podium';
import type { Leaderboard, PeriodKey } from '@/components/leaderboard/types';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDayLabel, formatDayRange } from '@/lib/format-time';
import { cn } from '@/lib/utils';

/**
 * The agency leaderboard.
 *
 * ── Who sees it, and what is deliberately not on it ──────────────────────────
 *
 * Everyone in the agency: principals and agents alike. That is a departure from
 * `/delivery` and `/delivery/team`, which are `RoleGuard`ed to OWNER and ADMIN
 * because they carry rates, balances, the Daily Block and tonight's projected
 * debit -- commercial terms an agent has no business reading.
 *
 * None of that is here, and that is a property of the endpoint rather than of
 * this file: `GET /api/v1/leaderboard` issues no query against the credit
 * ledger, the rate curve, the settlement tables or the billing profile, so
 * there is nothing on this screen to accidentally render. What it carries is
 * production -- calls, dials, applications, premium, time on the phone -- which
 * is what a sales floor has on the wall. A leaderboard nobody can see their
 * colleagues on is not a leaderboard.
 *
 * ── Two percentages, side by side, named apart ───────────────────────────────
 *
 * "Conversion" is applications over UNIQUE inbound callers: the floor's
 * question, and the one this screen was asked for. "Closing" is applications
 * over every delivered call: the figure the agency's price is actually set
 * from, defined once in `services/rating/measurement.ts`.
 *
 * Both are on every row. Showing only the first would put a number beside the
 * word "conversion" that is not the number on the invoice, on a screen forty
 * people read daily -- and the first time somebody compared the two, the board
 * would lose its credibility and take the invoice's with it.
 *
 * ── The period is a name; the server resolves it ─────────────────────────────
 *
 * See `components/leaderboard/period-picker.tsx`. The screen renders the range
 * the server says it measured, never the one it would have computed itself.
 */

/** Live enough for a floor to watch, quiet enough for forty tabs. See `useLivePoll`. */
const REFRESH_MS = 60_000;

export function LeaderboardView(): JSX.Element {
  const [period, setPeriod] = useState<PeriodKey>('TODAY');
  const [from, setFrom] = useState(() => localDayKey(6));
  const [to, setTo] = useState(() => localDayKey(0));

  /*
   * A period named in the URL, as Sales links here with its own
   * (`/leaderboard?period=THIS_WEEK`), so "your agents" on that screen opens
   * the same window on this one. Read once, after mount, from
   * `window.location`: `useSearchParams` would need a Suspense boundary around
   * the whole page for it to build, and the server render has no URL to read.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('period');
    if (!isPeriodKey(requested)) return;
    if (requested === 'CUSTOM') {
      const requestedFrom = params.get('from');
      const requestedTo = params.get('to');
      if (!requestedFrom || !requestedTo) return;
      setFrom(requestedFrom);
      setTo(requestedTo);
    }
    setPeriod(requested);
  }, []);

  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;
  const { upgrades, isPlatformAdmin, user } = useAuth();
  const previewing = platform.previewRole != null || user?.previewRole != null;
  const sendable = isSendable(period, from, to);
  const query = periodQuery(period, from, to);

  const load = useCallback(async () => {
    if (!sendable) return 'ok' as const;

    const response = await apiClient.get<Envelope<Leaderboard>>(`/api/v1/leaderboard?${query}`);
    if (response.error) {
      setError(response.error.message);
      /*
       * A platform operator who has entered no agency gets a refusal that will
       * be the same refusal in five seconds. Reporting it as terminal ends the
       * poll instead of producing a refused request a minute forever.
       */
      return response.error.code === 'NO_ACTING_TENANT'
        ? ('refused' as const)
        : ('failed' as const);
    }
    setError(null);
    setData(payload(response) ?? null);
    return 'ok' as const;
  }, [query, sendable]);

  const { loading, refresh } = useLivePoll(load, {
    intervalMs: REFRESH_MS,
    enabled: !platform.loading && !withoutAgency,
  });

  /*
   * Pressing "Last week" has to load last week NOW.
   *
   * `useLivePoll` deliberately holds its loader in a ref and restarts only on
   * `enabled`/`intervalMs`, so that a loader rebuilt on every render does not
   * reset the timer and poll far faster than asked. The consequence for a
   * screen whose loader encodes WHICH DATA to load is that a new period would
   * otherwise sit there until the next tick -- up to a minute of the board
   * showing one range under a button that says another.
   *
   * `refresh` is stable and de-duplicates against a request already in flight,
   * so the one it fires on mount costs nothing.
   */
  useEffect(() => {
    refresh();
  }, [query, refresh]);

  async function exportCsv(): Promise<void> {
    setExporting(true);
    try {
      /*
       * The period goes to the server, which selects the rows. Exporting what
       * the table happened to be holding would export whatever was last loaded
       * rather than the window on screen.
       */
      const response = await apiClient.get<string>(`/api/v1/leaderboard?${query}&format=csv`, {
        responseType: 'text',
      });
      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing.');
        return;
      }
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `leaderboard-${data?.period.from ?? from}-to-${data?.period.to ?? to}.csv`
      );
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  /** Applications per recorded hour: what a pay period is read against. */
  const perHour = useMemo(() => {
    if (!data) return null;
    const hours = data.rows.reduce((total, row) => total + (row.hoursWorked ?? 0), 0);
    if (hours <= 0) return null;
    return data.agency.applications / hours;
  }, [data]);

  // Out and Conn, and the outbound tile, only where dialling means something.
  const showOutbound = data ? showsOutbound(data, { upgrades, isPlatformAdmin, previewing }) : true;

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see its board." />
      </div>
    );
  }

  const custom = period === 'CUSTOM';
  /*
   * Caught here as well as on the server. The server refuses a reversed range
   * rather than silently swapping it, so without this the reader would see an
   * error for something they could have been told about before pressing
   * anything.
   */
  const reversed = custom && from > to;
  /* The range the SERVER says it measured -- never the one the browser asked for. */
  const resolved = data ? data.period : null;
  const ranked = data ? data.rows.filter(row => row.rank !== null).length : null;

  return (
    <div className="page-canvas">
      {/* Period, the measured range and the page's actions on one row. */}
      <Toolbar aria-label="Leaderboard period">
        <ToolbarSelect
          label="Period"
          value={period}
          allValue={null}
          onChange={next => setPeriod(next as PeriodKey)}
          options={PERIOD_OPTIONS}
          className="xl:max-w-[150px]"
        />
        {custom ? (
          <ToolbarDateRange from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        ) : null}
        {reversed ? (
          <ToolbarMeta className="text-dropped-ink">
            The start date is after the end date.
          </ToolbarMeta>
        ) : resolved ? (
          <ToolbarMeta>
            {/* Display only: the day labels sent to the server are unchanged. */}
            {resolved.from === resolved.to
              ? formatDayLabel(resolved.from)
              : `${formatDayRange(resolved.from, resolved.to)} · ${resolved.days} day${
                  resolved.days === 1 ? '' : 's'
                }`}
            {resolved.complete ? null : ' · still open'}
            {ranked === null ? null : ` · ${ranked} ranked`}
          </ToolbarMeta>
        ) : null}
        <ToolbarActions>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => refresh()}
            disabled={loading || !sendable}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => void exportCsv()}
            disabled={exporting || !sendable || !data}
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            CSV
          </Button>
        </ToolbarActions>
      </Toolbar>

      {error ? <Notice tone="error" title={error} /> : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading the board
        </div>
      ) : !data ? null : (
        <>
          <YourStanding data={data} rows={data.rows} />

          <Podium rows={data.rows} />

          {/* ── The agency, for the same period ──────────────────────────── */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="t-section text-ink">The agency</h2>
              <span className="t-meta text-ink-3">
                {data.period.complete
                  ? `against ${data.previousPeriod.label.toLowerCase()}`
                  : 'period still open'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatTile
                label="Conversion"
                figure={pct(data.agency.conversionPct, 1)}
                data-figure-label="Conversion"
                data-figure-value={pct(data.agency.conversionPct, 1)}
                tone="money"
                sub={`${count(data.agency.applications)} applications from ${count(
                  data.agency.uniqueInboundCallers
                )} unique callers`}
                title="Applications as a share of UNIQUE inbound callers. A caller who rings back four times is one opportunity, not four."
              />
              <StatTile
                label="Closing"
                figure={pct(data.agency.closingPct, 1)}
                data-figure-label="Closing"
                data-figure-value={pct(data.agency.closingPct, 1)}
                sub="applications ÷ delivered calls"
                title="Applications as a share of every answered inbound call. This is the definition the agency's rate is set from."
              />
              <StatTile
                label="Inbound calls"
                figure={count(data.agency.inboundCalls)}
                data-figure-label="Inbound calls"
                data-figure-value={count(data.agency.inboundCalls)}
                sub={
                  data.agencyChange
                    ? `${signed(data.agencyChange.inboundCalls)} vs ${data.previousPeriod.label.toLowerCase()}`
                    : `${count(data.agency.uniqueInboundCallers)} unique callers`
                }
              />
              {showOutbound ? (
                <StatTile
                  label="Outbound calls"
                  figure={count(data.agency.outboundCalls)}
                  data-figure-label="Outbound calls"
                  data-figure-value={count(data.agency.outboundCalls)}
                  sub={`${count(data.agency.outboundConnected)} connected`}
                />
              ) : (
                <StatTile
                  label="Unique callers"
                  figure={count(data.agency.uniqueInboundCallers)}
                  data-figure-label="Unique callers"
                  data-figure-value={count(data.agency.uniqueInboundCallers)}
                  sub={`${count(data.agency.inboundCalls)} inbound calls`}
                />
              )}
              <StatTile
                label="Applications"
                figure={count(data.agency.applications)}
                data-figure-label="Applications"
                data-figure-value={count(data.agency.applications)}
                sub={
                  data.agencyChange
                    ? `${signed(data.agencyChange.applications)} vs ${data.previousPeriod.label.toLowerCase()}`
                    : undefined
                }
              />
              <StatTile
                label="Annualized premium"
                figure={dollars(data.agency.annualizedPremium)}
                data-figure-label="Annualized premium"
                data-figure-value={dollars(data.agency.annualizedPremium)}
                tone="money"
              />
              <StatTile
                label="Talk time"
                figure={duration(data.agency.talkTimeSeconds)}
                data-figure-label="Talk time"
                data-figure-value={duration(data.agency.talkTimeSeconds)}
                sub="connected, on inbound calls"
              />
              <StatTile
                label="Applications / hour"
                figure={perHour === null ? '—' : perHour.toFixed(2)}
                data-figure-label="Applications / hour"
                data-figure-value={perHour === null ? '—' : perHour.toFixed(2)}
                sub="across agents with recorded hours"
              />
            </div>
          </section>

          {/* ── The board ────────────────────────────────────────────────── */}
          <Records data={data} />
          <Panel className="min-w-0">
            <PanelHeader
              action={
                <span className="t-meta tabular-nums text-ink-3">{`${data.rows.filter(row => row.rank !== null).length} ranked`}</span>
              }
            >
              <PanelTitle>The board</PanelTitle>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  headline="No calls, dials or applications in this period."
                  body="Rankings fill in as soon as your agents start taking calls."
                  icon={Trophy}
                />
              ) : (
                <Board
                  data={data}
                  viewerId={data.you?.userId ?? null}
                  showOutbound={showOutbound}
                />
              )}
            </PanelBody>
          </Panel>

          <ScoringNote data={data} showOutbound={showOutbound} />
        </>
      )}
    </div>
  );
}

/**
 * A signed count. Shown only for a period that has CLOSED — the server sends
 * `agencyChange: null` while one is still running, because a Tuesday morning
 * measured against the whole of last week always reads as a collapse.
 */
function signed(delta: number): string {
  if (delta === 0) return 'level';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}`;
}
