'use client';

import { Download, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { count, dollars, duration, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
  Toolbar,
  ToolbarActions,
  ToolbarMeta,
  ToolbarSelect,
} from '@/components/domain';
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

/** The period picker's value when the dates match no preset. */
const CUSTOM = 'custom';

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

  /*
   * Which preset the dates match, if any. Typing a date by hand drops the
   * picker to "Custom" rather than leaving a preset lit that no longer
   * describes the range on screen.
   */
  const activePreset =
    PRESETS.find(preset => from === preset.from() && to === preset.to())?.label ?? CUSTOM;

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <EmptyState headline="Select an agency to see its team." />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      {/* ── The range, and what to do with it: one row ──────────────────── */}
      <Toolbar>
        <ToolbarSelect
          label="Period"
          value={activePreset}
          allValue={null}
          onChange={value => {
            const preset = PRESETS.find(p => p.label === value);
            if (!preset) return;
            setFrom(preset.from());
            setTo(preset.to());
          }}
          options={[
            ...PRESETS.map(preset => ({ value: preset.label, label: preset.label })),
            { value: CUSTOM, label: 'Custom range' },
          ]}
        />

        {/*
         * Not ToolbarDateRange: each bound carries min/max against the other so
         * the browser's picker cannot produce a reversed range in the first place.
         */}
        <div className="flex min-w-full shrink-0 items-center gap-1 sm:min-w-0">
          <Input
            id="range-from"
            type="date"
            aria-label="From date"
            value={from}
            max={to}
            onChange={event => setFrom(event.target.value)}
            className="h-8 w-full px-2 text-xs sm:w-[128px]"
          />
          <span aria-hidden className="t-meta text-ink-3">
            –
          </span>
          <Input
            id="range-to"
            type="date"
            aria-label="To date"
            value={to}
            min={from}
            onChange={event => setTo(event.target.value)}
            className="h-8 w-full px-2 text-xs sm:w-[128px]"
          />
        </div>

        {data ? (
          <ToolbarMeta title={`${data.from} → ${data.to}`}>
            {`${data.days} day${data.days === 1 ? '' : 's'}`}
          </ToolbarMeta>
        ) : null}

        <ToolbarActions>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading || reversed}
            className="h-8 text-xs"
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={exporting || reversed || !data}
            className="h-8 text-xs"
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

      {reversed ? <Notice tone="warning">The start date is after the end date.</Notice> : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {/* ── The agency's own figures for the range ──────────────────────── */}
      {/*
       * No heading row: the range is already stated in the toolbar, and a
       * "The agency" title above five self-labelled tiles only pushed the table
       * further down.
       */}
      <section aria-label="The agency" className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatTile
            label="Calls taken"
            figure={count(data?.agencyCallsTaken)}
            data-figure-label="Calls taken"
            data-figure-value={count(data?.agencyCallsTaken)}
          />
          <StatTile
            label="Applications"
            figure={count(data?.agencyApplications)}
            data-figure-label="Applications"
            data-figure-value={count(data?.agencyApplications)}
          />
          <StatTile
            label="Closing"
            figure={pct(data?.agencyClosingPct ?? null)}
            emphasis
            tone="money"
            title="Submitted applications as a share of delivered calls, over the whole range."
            data-figure-label="Closing"
            data-figure-value={pct(data?.agencyClosingPct ?? null)}
          />
          <StatTile
            label="Annualized premium"
            figure={dollars(data?.agencyAnnualizedPremium)}
            data-figure-label="Annualized premium"
            data-figure-value={dollars(data?.agencyAnnualizedPremium)}
          />
          <StatTile
            label="Applications / hour"
            figure={perHour === null ? '—' : perHour.toFixed(2)}
            sub="Across agents with recorded hours"
            data-figure-label="Applications / hour"
            data-figure-value={perHour === null ? '—' : perHour.toFixed(2)}
          />
        </div>
      </section>

      {/* ── Per agent ───────────────────────────────────────────────────── */}
      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>By agent</PanelTitle>
          {data ? (
            <PanelDescription>
              {`${data.agents.length} agent${data.agents.length === 1 ? '' : 's'}`}
            </PanelDescription>
          ) : null}
        </PanelHeader>

        {loading ? (
          <PanelBody className="t-body flex items-center justify-center py-12 text-ink-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading
          </PanelBody>
        ) : !data || data.agents.length === 0 ? (
          <EmptyState headline="No calls or applications in this range." />
        ) : (
          <PanelBody flush className="overflow-x-auto">
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
                    className={cn(agent.userId === null && 'text-ink-3')}
                  >
                    <TableCell>
                      {agent.userId ? (
                        /*
                         * The drill-down this report never had. It showed a
                         * closing percentage and a talk time with no way to reach
                         * the calls behind them, so "why is this agent at 4%" was
                         * a question the screen raised and could not answer.
                         *
                         * The window travels with the link. Landing on all-time
                         * calls from a seven-day figure would make the two screens
                         * disagree about the number the click started from.
                         */
                        <Link
                          href={`/calls?agentId=${encodeURIComponent(agent.userId)}&from=${from}&to=${to}`}
                          className="font-medium text-ink underline decoration-dotted underline-offset-4 transition-colors hover:text-brand-ink hover:decoration-solid"
                          title={`Every call ${agent.name} took in this window`}
                        >
                          {agent.name}
                        </Link>
                      ) : (
                        <div className="font-medium">{agent.name}</div>
                      )}
                      {agent.email ? <div className="t-meta text-ink-3">{agent.email}</div> : null}
                    </TableCell>
                    <TableCell className="t-num text-right">{count(agent.callsTaken)}</TableCell>
                    <TableCell className="t-num text-right">{count(agent.applications)}</TableCell>
                    <TableCell className="t-num text-right">{pct(agent.closingPct)}</TableCell>
                    <TableCell className="t-num text-right">
                      {dollars(agent.annualizedPremium)}
                    </TableCell>
                    <TableCell className="t-num text-right">
                      {duration(agent.talkTimeSeconds)}
                    </TableCell>
                    <TableCell className="t-num text-right">
                      {agent.hoursWorked === null ? '—' : agent.hoursWorked.toFixed(1)}
                    </TableCell>
                    <TableCell className="t-num text-right">{pct(agent.occupancyPct, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>
    </div>
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
