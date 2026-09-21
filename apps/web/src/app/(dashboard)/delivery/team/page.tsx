'use client';

import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  Figure,
  FigureRow,
  SectionRule,
  count,
  dollars,
  duration,
  pct,
} from '@/components/delivery/ledger';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * What the team produced over a span of days.
 *
 * ── The question the product could not answer ────────────────────────────────
 *
 * `/delivery` shows one calendar day. An owner asking "how did my team do this
 * week" — or this month, or this pay period — had nowhere to look.
 * `/applications` takes a range and breaks down by agent, but carries no call
 * counts, so it cannot produce a closing percentage, which is the figure the
 * whole business is measured on.
 *
 * ── Why this is a separate screen from /delivery ─────────────────────────────
 *
 * /delivery is a LIVE panel beside today's block, today's overrun and tonight's
 * rate, and its per-agent table sorts ASCENDING — worst closer first — because
 * it is a work list: who to coach today, who to pull off the queue.
 *
 * This is a period report. It sorts descending, it carries no rate and no
 * money owed, and nothing on it moves during the day. Putting both readings on
 * one screen would mean one table whose sort order silently means two different
 * things depending on the dates in the box above it.
 *
 * ── Em dashes, never zeroes ──────────────────────────────────────────────────
 *
 * A closing percentage with no delivered calls behind it, an agent whose hours
 * were never recorded: em dashes. This is a screen somebody may decide pay or
 * headcount from, and a fabricated 0% is worse than an absent number — it reads
 * as a measurement.
 */

interface AgentRangeRow {
  userId: string | null;
  name: string;
  email: string | null;
  callsTaken: number;
  applications: number;
  annualizedPremium: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  hoursWorked: number | null;
  occupancyPct: number | null;
}

interface AgentRangeBreakdown {
  from: string;
  to: string;
  days: number;
  agencyCallsTaken: number;
  agencyApplications: number;
  agencyAnnualizedPremium: number;
  agencyClosingPct: number | null;
  agents: AgentRangeRow[];
}

/** `YYYY-MM-DD` for a date this many days before today, in the browser's zone. */
function dayKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** The ranges an owner actually asks for, so nobody types dates for the common case. */
const PRESETS: Array<{ label: string; from: () => string; to: () => string }> = [
  { label: 'Last 7 days', from: () => dayKey(6), to: () => dayKey(0) },
  { label: 'Last 30 days', from: () => dayKey(29), to: () => dayKey(0) },
  {
    label: 'This month',
    from: () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    },
    to: () => dayKey(0),
  },
];

function TeamRangeReport(): JSX.Element {
  const [from, setFrom] = useState(() => dayKey(6));
  const [to, setTo] = useState(() => dayKey(0));
  const [data, setData] = useState<AgentRangeBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  /*
   * The range is only invalid one way round, and it is worth catching here as
   * well as on the server: the server refuses it rather than silently swapping
   * the dates, so without this the owner would just see an error they could
   * have been told about before pressing anything.
   */
  const reversed = from > to;

  const load = useCallback(async () => {
    if (reversed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ data: AgentRangeBreakdown }>(
        `/api/v1/delivery/agents/range?from=${from}&to=${to}`
      );
      setData(response.data?.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [from, to, reversed]);

  useEffect(() => {
    if (platform.loading) return;
    if (withoutAgency) {
      setData(null);
      setLoading(false);
      return;
    }
    void load();
  }, [platform.loading, withoutAgency, load]);

  async function exportCsv(): Promise<void> {
    setExporting(true);
    try {
      /*
       * The range goes to the server, which selects the rows. Exporting what
       * the table happened to have loaded would export a different range from
       * the one on screen.
       */
      const response = await apiClient.get<string>(
        `/api/v1/delivery/agents/range?from=${from}&to=${to}&format=csv`,
        { responseType: 'text' }
      );
      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing.');
        return;
      }
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `agents-${from}-to-${to}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  /** Applications per recorded hour: the figure a pay period is read against. */
  const perHour = useMemo(() => {
    if (!data) return null;
    const hours = data.agents.reduce((total, agent) => total + (agent.hoursWorked ?? 0), 0);
    if (hours <= 0) return null;
    return data.agencyApplications / hours;
  }, [data]);

  if (withoutAgency) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Team" subtitle="Select an agency to see its team." />
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell>
      <CompactPageHeader
        title="Team"
        subtitle={
          data
            ? `${data.days} day${data.days === 1 ? '' : 's'}, ${data.from} to ${data.to}`
            : 'What the team produced over a span of days'
        }
      />

      {/* ── The range ───────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map(preset => {
          const presetFrom = preset.from();
          const presetTo = preset.to();
          const active = from === presetFrom && to === presetTo;
          return (
            <Button
              key={preset.label}
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setFrom(presetFrom);
                setTo(presetTo);
              }}
            >
              {preset.label}
            </Button>
          );
        })}

        <div className="flex items-end gap-2">
          <div>
            <label className="t-label text-ink-3" htmlFor="range-from">
              From
            </label>
            <Input
              id="range-from"
              type="date"
              value={from}
              max={to}
              onChange={event => setFrom(event.target.value)}
              className="h-8 w-[10rem]"
            />
          </div>
          <div>
            <label className="t-label text-ink-3" htmlFor="range-to">
              To
            </label>
            <Input
              id="range-to"
              type="date"
              value={to}
              min={from}
              onChange={event => setTo(event.target.value)}
              className="h-8 w-[10rem]"
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading || reversed}
        >
          <RefreshCw className={cn('mr-2 h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void exportCsv()}
          disabled={exporting || reversed || !data}
        >
          {exporting ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-2 h-3.5 w-3.5" />
          )}
          CSV
        </Button>
      </div>

      {reversed ? (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The start date is after the end date.
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* ── The agency's own figures for the range ──────────────────────── */}
      <SectionRule note={data ? `${data.from} → ${data.to}` : undefined}>The agency</SectionRule>
      <FigureRow className="mb-5">
        <Figure label="Calls taken" value={count(data?.agencyCallsTaken)} />
        <Figure label="Applications" value={count(data?.agencyApplications)} />
        <Figure
          label="Closing"
          value={pct(data?.agencyClosingPct ?? null)}
          size="hero"
          tone="money"
          title="Submitted applications as a share of delivered calls, over the whole range."
        />
        <Figure label="Annualized premium" value={dollars(data?.agencyAnnualizedPremium)} />
        <Figure
          label="Applications / hour"
          value={perHour === null ? '—' : perHour.toFixed(2)}
          sub="Across agents with recorded hours"
        />
      </FigureRow>

      {/* ── Per agent ───────────────────────────────────────────────────── */}
      <SectionRule
        note={
          data ? `${data.agents.length} agent${data.agents.length === 1 ? '' : 's'}` : undefined
        }
      >
        By agent
      </SectionRule>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading
        </div>
      ) : !data || data.agents.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <p>No calls or applications in this range.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Applications</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Annualized premium</TableHead>
              <TableHead className="text-right">Talk time</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Occupancy</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.agents.map(agent => (
              <TableRow
                key={agent.userId ?? 'unattributed'}
                /*
                 * The unattributed row is delivered calls with no agent
                 * recorded. It is not a person, nobody can be coached or paid
                 * on it, and it is here only so the rows reconcile with the
                 * agency total — so it reads quieter than the people.
                 */
                className={cn(agent.userId === null && 'text-muted-foreground')}
              >
                <TableCell>
                  <div className="font-medium">{agent.name}</div>
                  {agent.email ? (
                    <div className="text-xs text-muted-foreground">{agent.email}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{count(agent.callsTaken)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {count(agent.applications)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pct(agent.closingPct)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {dollars(agent.annualizedPremium)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {duration(agent.talkTimeSeconds)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {agent.hoursWorked === null ? '—' : agent.hoursWorked.toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(agent.occupancyPct, 1)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CompactPageShell>
  );
}

export default function TeamRangePage(): JSX.Element {
  /*
   * An agency principal's screen, matching the endpoint behind it: the range
   * report is gated on `requireAgencyPrincipal`, so an AGENT reaching this URL
   * would render a shell and then be refused 403 by every fetch.
   */
  return (
    <RoleGuard allowedRoles={['OWNER', 'ADMIN']}>
      <TeamRangeReport />
    </RoleGuard>
  );
}
