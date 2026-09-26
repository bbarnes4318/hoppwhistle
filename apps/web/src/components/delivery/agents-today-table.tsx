'use client';

import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';

import { count, dollars, duration, pct, points } from '@/components/delivery/ledger';
import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { StatusChip } from '@/components/domain/status-chip';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * "Agents today": one row per agent, weakest closer first.
 *
 * Extracted from the Delivery page, which still renders it under its block and
 * rate, so the white-label Agents hub can show the same table on its own. The
 * rows, the sort and the agency line are unchanged; see `AgentsTodayTable`.
 */

export interface AgentRow {
  userId: string | null;
  name: string;
  email: string | null;
  callsTaken: number;
  applications: number;
  /**
   * Total annualized premium on those applications.
   *
   * The counts drive the price; this is what says whether the production is
   * worth what it costs. Zero for an agent who submitted nothing, and zero for
   * one whose applications all came from the carrier automation, which records
   * no premium of its own.
   */
  annualizedPremium: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  /** Seconds on the queue today. Null when nothing was recorded for the day. */
  availableSeconds: number | null;
  statusSince: string | null;
  hoursWorked: number | null;
  occupancyPct: number | null;
  currentStatus: string;
}

export interface AgentBreakdown {
  agencyClosingPct: number | null;
  /** The day's total annualized premium across every agent. */
  agencyAnnualizedPremium: number;
  agents: AgentRow[];
}

export type SortKey =
  | 'closingPct'
  | 'callsTaken'
  | 'applications'
  | 'annualizedPremium'
  | 'talkTimeSeconds'
  | 'availableSeconds'
  | 'name';

/**
 * Time on the queue, or an em dash.
 *
 * Null means no status transitions were recorded for that agent on that day,
 * which is a different fact from "was never available". Presence was held only
 * in Redis before Phase 4 -- one key per agent, overwritten on every change --
 * so days before it have nothing to read. Rendering that as 0m would put a
 * coaching decision on a number nobody recorded.
 */
function available(seconds: number | null): string {
  return seconds === null ? '—' : duration(seconds);
}

/**
 * The table's sort, and the rows in that order.
 *
 * Moved out of the Delivery panel unchanged, so the Agents hub's "Agents
 * today" tab sorts exactly as Delivery does.
 */
export function useAgentSort(agents: AgentRow[]) {
  const [sortKey, setSortKey] = useState<SortKey>('closingPct');
  /*
   * Ascending, so the agents dragging the agency's rate are at the top.
   *
   * This defaulted to descending, which put the best closers first. That is a
   * leaderboard, and this is a work list: the screen exists so a principal can
   * find who to coach or pull off the queue, and burying them under the top
   * performers is the opposite of what it is for.
   */
  const [sortAsc, setSortAsc] = useState(true);

  const sortedAgents = useMemo(() => {
    const rows = [...agents];
    rows.sort((a, b) => {
      if (sortKey === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      // Nulls last in both directions: an agent who took no calls has no
      // percentage, and a null at the top of a "who needs coaching" list reads
      // as a finding.
      const av: number | null = a[sortKey];
      const bv: number | null = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [agents, sortKey, sortAsc]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
      return;
    }
    setSortKey(key);
    // Closing percentage and name read best ascending -- the agents who need
    // attention, and A first. Counts read best descending: the busiest first.
    setSortAsc(key === 'name' || key === 'closingPct');
  }

  function sortIcon(key: SortKey): JSX.Element | null {
    if (key !== sortKey) return null;
    return sortAsc ? (
      <ArrowUp className="ml-1 inline h-3 w-3" aria-label="ascending" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" aria-label="descending" />
    );
  }

  return { sortedAgents, sortKey, sortAsc, toggleSort, sortIcon };
}

/**
 * Softphone presence, as a chip tone. Available is live; on a call is in
 * progress; away is a deliberate stop, so it takes the blocked violet rather
 * than a failure red; offline, unknown and "n/a" are neutral.
 */
function agentStatusTone(status: string): 'live' | 'ringing' | 'blocked' | 'neutral' {
  switch (status) {
    case 'available':
      return 'live';
    case 'on_call':
      return 'ringing';
    case 'away':
      return 'blocked';
    default:
      return 'neutral';
  }
}

/**
 * The per-agent table: the product's real lever.
 *
 * A principal decides who to coach or pull off the queue here. So: weakest
 * closer first, closing percentage the largest thing in the row, the agency's
 * own figure drawn THROUGH the table as a rule between the agents below it and
 * the agents above it, and a sticky header so 45 rows never scroll past the
 * column names. Every other column is support and set in the quieter data
 * face.
 */
export function AgentsTodayTable({
  agents,
  agencyClosingPct,
  agencyPremium,
  sortKey,
  sortAsc,
  onSort,
  sortIcon,
}: {
  agents: AgentRow[];
  agencyClosingPct: number | null;
  agencyPremium: number;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  sortIcon: (key: SortKey) => JSX.Element | null;
}): JSX.Element {
  /*
   * Where to draw the agency line. Only meaningful when the rows are ordered
   * by closing percentage: it goes before the first agent at or above the
   * agency figure (ascending) or the first one below it (descending). With any
   * other sort the reference is carried per row instead.
   */
  const lineBefore = useMemo(() => {
    if (sortKey !== 'closingPct' || agencyClosingPct === null) return -1;
    const index = agents.findIndex(a =>
      a.closingPct === null
        ? false
        : sortAsc
          ? a.closingPct >= agencyClosingPct
          : a.closingPct < agencyClosingPct
    );
    return index;
  }, [agents, sortKey, sortAsc, agencyClosingPct]);

  const header = (key: SortKey, label: string, extra?: { title?: string; numeric?: boolean }) => (
    <th
      scope="col"
      className={cn(extra?.numeric && 'num', 'cursor-pointer select-none')}
      aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      title={extra?.title}
    >
      <button
        type="button"
        onClick={() => onSort(key)}
        className="t-label text-ink-3 hover:text-ink"
      >
        {label}
        {sortIcon(key)}
      </button>
    </th>
  );

  const agencyLine = (
    <tr aria-hidden className="bg-sunken">
      <td colSpan={10} className="!h-6 !border-b-0 !py-0">
        <span className="flex items-center gap-2 t-meta text-ink-2">
          <span className="h-px flex-1 border-t border-dashed border-ink-3" />
          agency {pct(agencyClosingPct)}
          <span className="h-px flex-1 border-t border-dashed border-ink-3" />
        </span>
      </td>
    </tr>
  );

  return (
    <Panel className="min-w-0">
      <PanelHeader>
        <PanelTitle>Agents today</PanelTitle>
        <PanelDescription>
          Agency today <span className="t-num font-medium text-ink">{pct(agencyClosingPct)}</span> —
          the line each agent is read against ·{' '}
          <span className="t-num font-medium text-ink">{dollars(agencyPremium)}</span> annualized
          premium
        </PanelDescription>
      </PanelHeader>

      {agents.length === 0 ? (
        <PanelBody>
          <p className="t-body text-ink-3">No calls answered yet today.</p>
        </PanelBody>
      ) : (
        <PanelBody flush className="max-h-[calc(100vh-12rem)] overflow-auto rounded-b-card">
          <table
            className={cn(
              'w-full border-collapse text-left t-body',
              '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-sunken',
              '[&_thead_th]:h-10 [&_thead_th]:whitespace-nowrap [&_thead_th]:border-b [&_thead_th]:border-rule [&_thead_th]:px-3 [&_thead_th]:align-middle [&_thead_th]:t-label [&_thead_th]:text-ink-3',
              '[&_tbody_td]:h-row [&_tbody_td]:border-b [&_tbody_td]:border-rule [&_tbody_td]:px-3 [&_tbody_td]:py-0 [&_tbody_td]:align-middle',
              '[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr]:ease-out',
              '[&_tbody_tr:last-child_td]:border-b-0',
              '[&_th:first-child]:pl-5 [&_td:first-child]:pl-5 [&_th:last-child]:pr-5 [&_td:last-child]:pr-5',
              '[&_.num]:text-right [&_.num]:t-num [&_.num]:text-ink',
              '[&_th.num]:t-label [&_th.num]:text-ink-3'
            )}
          >
            <thead>
              <tr>
                {header('name', 'Agent')}
                {header('closingPct', 'Closing', { numeric: true })}
                <th
                  scope="col"
                  className="num"
                  title="Points against the agency's own figure today"
                >
                  vs agency
                </th>
                {header('callsTaken', 'Calls', { numeric: true })}
                {header('applications', 'Apps', { numeric: true })}
                {header('annualizedPremium', 'Premium', {
                  numeric: true,
                  title:
                    "Total annualized premium on the day's applications. The count is what " +
                    'the agency is charged on; this is what it bought.',
                })}
                {header('talkTimeSeconds', 'Talk', { numeric: true })}
                {header('availableSeconds', 'On queue', {
                  numeric: true,
                  title:
                    'Time on the queue today, waiting for a call. A low closer who was available all day and one who was available for forty minutes are different problems.',
                })}
                <th scope="col" className="num">
                  Occupancy
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => {
                const delta =
                  agent.closingPct !== null && agencyClosingPct !== null
                    ? agent.closingPct - agencyClosingPct
                    : null;
                return (
                  <Fragment key={agent.userId ?? 'unattributed'}>
                    {index === lineBefore && agencyLine}
                    <tr className="hover:bg-sunken">
                      <td
                        className={cn(
                          'max-w-[16rem] truncate font-medium text-ink',
                          agent.userId === null && 'italic font-normal text-ink-3'
                        )}
                        title={
                          agent.userId === null
                            ? 'Delivered calls with no agent recorded on them. Shown so this ' +
                              'table adds up to the agency total rather than quietly losing them.'
                            : (agent.email ?? undefined)
                        }
                      >
                        {agent.name}
                      </td>
                      {/*
                        The one number in the row. Set a step larger and heavier
                        than the support columns; coloured only when it is BELOW
                        the agency line, because below is the finding and above
                        is the norm.
                      */}
                      <td
                        className={cn(
                          'num !t-figure !text-[15px] font-medium',
                          delta !== null && delta < 0 ? '!text-dropped-ink' : '!text-ink',
                          agent.closingPct === null && '!text-ink-3 !font-normal'
                        )}
                      >
                        {pct(agent.closingPct)}
                      </td>
                      <td
                        className={cn(
                          'num',
                          delta !== null && delta < 0 ? '!text-dropped-ink' : '!text-ink-3'
                        )}
                      >
                        {delta === null ? '—' : points(delta)}
                      </td>
                      <td className="num">{count(agent.callsTaken)}</td>
                      <td className="num">{count(agent.applications)}</td>
                      <td className="num">{dollars(agent.annualizedPremium)}</td>
                      <td className="num !text-ink-2">{duration(agent.talkTimeSeconds)}</td>
                      <td className="num !text-ink-2">
                        {agent.availableSeconds === null ? (
                          <span title="No status transitions were recorded for this agent today. That is not the same as no time on the queue, so it is shown as absent rather than as zero.">
                            —
                          </span>
                        ) : (
                          available(agent.availableSeconds)
                        )}
                      </td>
                      <td className="num !text-ink-2">
                        {agent.occupancyPct === null ? (
                          <span title="Working hours have not been recorded for this agent today, so there is no denominator. An absent number, not 0%.">
                            —
                          </span>
                        ) : (
                          `${agent.occupancyPct.toFixed(0)}%`
                        )}
                      </td>
                      <td>
                        <StatusChip
                          value={agent.currentStatus}
                          label={agent.currentStatus.replace(/_/g, ' ')}
                          tone={agentStatusTone(agent.currentStatus)}
                          size="sm"
                        />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {lineBefore === -1 && sortKey === 'closingPct' && agencyClosingPct !== null && sortAsc
                ? agencyLine
                : null}
            </tbody>
          </table>
        </PanelBody>
      )}
    </Panel>
  );
}

/**
 * "Agents today" on its own: the Agents hub's Today tab.
 *
 * The same endpoint and the same table as the Delivery page, polled on the
 * same thirty seconds. Only the rows -- Delivery's block, rate and credits are
 * on Settings -> Plan & Billing.
 */
export function AgentsTodayPanel(): JSX.Element {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agencyClosingPct, setAgencyClosingPct] = useState<number | null>(null);
  const [agencyPremium, setAgencyPremium] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const platform = usePlatformContext();

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<AgentBreakdown>>('/api/v1/delivery/agents');
    if (response.error) {
      setError(response.error.message);
      return response.error.code === 'NO_ACTING_TENANT'
        ? ('refused' as const)
        : ('failed' as const);
    }
    const breakdown = payload(response);
    setError(null);
    setAgents(Array.isArray(breakdown?.agents) ? breakdown.agents : []);
    // The agency's own figure, served with the rows -- never summed from them.
    setAgencyClosingPct(breakdown?.agencyClosingPct ?? null);
    setAgencyPremium(breakdown?.agencyAnnualizedPremium ?? 0);
    return 'ok' as const;
  }, []);

  const { loading } = useLivePoll(load, {
    intervalMs: 30_000,
    enabled: !platform.loading && !platform.needsAgency,
  });
  const { sortedAgents, sortKey, sortAsc, toggleSort, sortIcon } = useAgentSort(agents);

  return (
    <div className="page-canvas">
      {error ? <Notice tone="error" title={error} /> : null}
      {loading && agents.length === 0 && !error ? (
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading agents
        </div>
      ) : (
        <AgentsTodayTable
          agents={sortedAgents}
          agencyClosingPct={agencyClosingPct}
          agencyPremium={agencyPremium}
          sortKey={sortKey}
          sortAsc={sortAsc}
          onSort={toggleSort}
          sortIcon={sortIcon}
        />
      )}
    </div>
  );
}
