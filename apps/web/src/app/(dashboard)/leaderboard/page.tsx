'use client';

import { AlertTriangle, Download, Loader2, RefreshCw, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Figure,
  FigureRow,
  Notice,
  SectionRule,
  count,
  dollars,
  duration,
  pct,
} from '@/components/delivery/ledger';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Board, Records, ScoringNote, YourStanding } from '@/components/leaderboard/board';
import {
  PeriodPicker,
  isSendable,
  localDayKey,
  periodQuery,
} from '@/components/leaderboard/period-picker';
import { Podium } from '@/components/leaderboard/podium';
import type { Leaderboard, PeriodKey } from '@/components/leaderboard/types';
import { Button } from '@/components/ui/button';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
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

export default function LeaderboardPage(): JSX.Element {
  const [period, setPeriod] = useState<PeriodKey>('TODAY');
  const [from, setFrom] = useState(() => localDayKey(6));
  const [to, setTo] = useState(() => localDayKey(0));

  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;
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

  if (withoutAgency) {
    return (
      <CompactPageShell>
        <CompactPageHeader
          title="Leaderboard"
          subtitle="Select an agency to see its board."
          icon={Trophy}
        />
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Leaderboard"
        subtitle={
          data
            ? `${data.period.label} · ${data.rows.filter(row => row.rank !== null).length} ranked`
            : 'Who is closing, who is dialling, and who is on a run'
        }
        icon={Trophy}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={loading || !sendable}
          >
            <RefreshCw className={cn('mr-2 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={exporting || !sendable || !data}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-2 h-3.5 w-3.5" />
            )}
            CSV
          </Button>
        </div>
      </CompactPageHeader>

      <PeriodPicker
        period={period}
        from={from}
        to={to}
        resolved={data ? data.period : null}
        disabled={loading && !data}
        onChange={next => {
          setPeriod(next.period);
          setFrom(next.from);
          setTo(next.to);
        }}
      />

      {error ? (
        <Notice tone="dropped" icon={<AlertTriangle className="h-4 w-4" />} title={error} />
      ) : null}

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
          <SectionRule
            note={
              data.period.complete
                ? `against ${data.previousPeriod.label.toLowerCase()}`
                : 'period still open'
            }
          >
            The agency
          </SectionRule>
          <FigureRow>
            <Figure
              label="Conversion"
              value={pct(data.agency.conversionPct, 1)}
              size="hero"
              tone="money"
              sub={`${count(data.agency.applications)} applications from ${count(
                data.agency.uniqueInboundCallers
              )} unique callers`}
              title="Applications as a share of UNIQUE inbound callers. A caller who rings back four times is one opportunity, not four."
            />
            <Figure
              label="Closing"
              value={pct(data.agency.closingPct, 1)}
              size="quiet"
              sub="of every delivered call — the priced figure"
              title="Applications as a share of every answered inbound call. This is the definition the agency's rate is set from."
            />
            <Figure
              label="Inbound calls"
              value={count(data.agency.inboundCalls)}
              sub={
                data.agencyChange
                  ? `${signed(data.agencyChange.inboundCalls)} vs ${data.previousPeriod.label.toLowerCase()}`
                  : `${count(data.agency.uniqueInboundCallers)} unique callers`
              }
            />
            <Figure
              label="Outbound calls"
              value={count(data.agency.outboundCalls)}
              sub={`${count(data.agency.outboundConnected)} connected`}
            />
            <Figure
              label="Applications"
              value={count(data.agency.applications)}
              sub={
                data.agencyChange
                  ? `${signed(data.agencyChange.applications)} vs ${data.previousPeriod.label.toLowerCase()}`
                  : undefined
              }
            />
            <Figure
              label="Annualized premium"
              value={dollars(data.agency.annualizedPremium)}
              tone="money"
            />
            <Figure
              label="Talk time"
              value={duration(data.agency.talkTimeSeconds)}
              sub="connected, on inbound calls"
            />
            <Figure
              label="Applications / hour"
              value={perHour === null ? '—' : perHour.toFixed(2)}
              sub="across agents with recorded hours"
            />
          </FigureRow>

          {/* ── The board ────────────────────────────────────────────────── */}
          <SectionRule note={`${data.rows.filter(row => row.rank !== null).length} ranked`}>
            The board
          </SectionRule>
          <Records data={data} />
          <Board data={data} viewerId={data.you?.userId ?? null} />

          <ScoringNote data={data} />
        </>
      )}
    </CompactPageShell>
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
