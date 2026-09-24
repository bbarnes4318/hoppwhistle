'use client';

import { Building2, Calculator, DollarSign, Download, FileText, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Ledger, count, dollars } from '@/components/delivery/ledger';
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
  ToolbarSelect,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Applications: the business the agency wrote, both ways it can be recorded.
 *
 * ── What this screen is for ──────────────────────────────────────────────────
 *
 * This is the page an agency owner reconciles against carrier statements. It
 * has to answer, per row, four questions a statement asks: which carrier, which
 * application number, how much premium, and which agent. So those four are
 * columns, not detail behind a click.
 *
 * ── Two ways a row got here, and the difference is visible ───────────────────
 *
 * An application either came from the American Amicable RPA or an agent logged
 * it after writing the business themselves. Both count identically in the
 * closing percentage -- nothing prices them differently, and nothing on this
 * page should suggest otherwise -- but which is which matters when a number
 * does not match a statement, because the two have different things to check.
 * So `source` renders as a small label and nothing more than a label.
 *
 * ── A voided row stays on the page ───────────────────────────────────────────
 *
 * Voiding removes an application from the closing percentage and from the
 * totals above. It does NOT remove it from this table: a row that vanishes is a
 * row an owner spends an afternoon hunting for in a carrier statement. Voided
 * rows render struck through, with the reason on hover, and the summary strip
 * excludes them -- which is what makes the totals reconcile.
 *
 * Voiding is platform-staff-only and there is no control for it here. An agency
 * cannot void its own applications, because the numerator is what its price is
 * measured from.
 *
 * ── An agent sees their own rows ─────────────────────────────────────────────
 *
 * That narrowing is enforced server-side -- the endpoint overwrites any
 * `agentId` an agent sends -- so this page carries no role branch beyond hiding
 * the agent filter, which would otherwise be a control that does nothing.
 */

interface ApplicationRow {
  id: string;
  submittedAt: string | null;
  source: string;
  carrier: string;
  product: string | null;
  planType: string | null;
  faceAmount: number | null;
  modalPremium: number | null;
  paymentMode: string;
  annualizedPremium: number | null;
  /** First name and last initial. The server never sends more than that. */
  applicant: string;
  state: string | null;
  carrierApplicationNumber: string | null;
  agentId: string | null;
  agentName: string | null;
  callId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

interface ApplicationsResponse {
  applications: ApplicationRow[];
  nextCursor: string | null;
}

interface SummaryBreakdown {
  count: number;
  annualizedPremium: number;
}

interface ApplicationsSummary {
  count: number;
  totalAnnualizedPremium: number;
  averageAnnualizedPremium: number | null;
  byCarrier: (SummaryBreakdown & { carrier: string })[];
  byAgent: (SummaryBreakdown & { agentId: string | null; agentName: string })[];
}

const PLAN_LABELS: Record<string, string> = {
  LEVEL: 'Level',
  GRADED: 'Graded',
  ROP: 'Return of premium',
  GUARANTEED_ISSUE: 'Guaranteed issue',
};

const MODE_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUAL: 'Semi-annual',
  ANNUAL: 'Annual',
};

/** Today and thirty days back, in the platform's day keys. */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 29 * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** A CSV cell a spreadsheet cannot read as a formula. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS = [
  'submitted_at',
  'source',
  'carrier',
  'product',
  'plan_type',
  'face_amount',
  'modal_premium',
  'payment_mode',
  'annualized_premium',
  'applicant',
  'state',
  'application_number',
  'agent',
  'call_id',
  'voided_at',
  'void_reason',
];

function csvRow(row: ApplicationRow): unknown[] {
  return [
    row.submittedAt,
    row.source,
    row.carrier,
    row.product,
    row.planType,
    row.faceAmount,
    row.modalPremium,
    row.paymentMode,
    row.annualizedPremium,
    row.applicant,
    row.state,
    row.carrierApplicationNumber,
    row.agentName,
    row.callId,
    row.voidedAt,
    row.voidReason,
  ];
}

/** A day key rendered as a short local date and time. */
function submitted(value: string | null): string {
  if (!value) return '—';
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? '—'
    : at.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** The toolbar selects' "no filter" value; Radix Select cannot hold an empty string. */
const ALL = 'all';

export default function ApplicationsPage() {
  const [range, setRange] = useState(defaultRange);
  const [carrier, setCarrier] = useState('');
  const [agentId, setAgentId] = useState('');
  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [summary, setSummary] = useState<ApplicationsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const query = new URLSearchParams({ from: range.from, to: range.to, limit: '500' });
    if (carrier) query.set('carrier', carrier);
    if (agentId) query.set('agentId', agentId);

    const summaryQuery = new URLSearchParams({ from: range.from, to: range.to });

    try {
      const [list, totals] = await Promise.all([
        apiClient.get<Envelope<ApplicationsResponse>>(`/api/v1/applications?${query.toString()}`),
        apiClient.get<Envelope<ApplicationsSummary>>(
          `/api/v1/applications/summary?${summaryQuery.toString()}`
        ),
      ]);

      if (list.error) throw new Error(list.error.message);
      if (totals.error) throw new Error(totals.error.message);

      setRows(payload(list)?.applications ?? []);
      setSummary(payload(totals) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load applications.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, carrier, agentId]);

  /*
   * One load on mount and one per Apply, rather than a poll. This is a
   * reconciliation screen read against a paper statement, not a live board, and
   * a table that reorders itself under the reader's finger is worse than a
   * table that is a minute old.
   */
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: on mount and on Apply only
  }, []);

  /*
   * The agent filter is hidden when every row belongs to one agent, which is
   * what an AGENT's server-narrowed reading looks like. The narrowing itself is
   * server-side; this only avoids rendering a control that cannot do anything.
   */
  const agents = useMemo(() => summary?.byAgent ?? [], [summary]);
  const showAgentFilter = agents.length > 1;

  const carriers = useMemo(
    () => (summary?.byCarrier ?? []).map(row => row.carrier).sort((a, b) => a.localeCompare(b)),
    [summary]
  );

  const exportCsv = useCallback(() => {
    const body = rows.map(row => csvRow(row).map(csvCell).join(','));
    const text = [CSV_COLUMNS.map(csvCell).join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `applications-${range.from}-to-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [rows, range.from, range.to]);

  return (
    <div className="page-canvas">
      {/* Range, filters and export on one row -- the first thing on the page. */}
      <Toolbar aria-label="Application filters">
        <ToolbarDateRange
          from={range.from}
          to={range.to}
          onFromChange={from => setRange(prev => ({ ...prev, from }))}
          onToChange={to => setRange(prev => ({ ...prev, to }))}
        />
        <ToolbarSelect
          label="Carrier"
          allLabel="All carriers"
          value={carrier || ALL}
          onChange={value => setCarrier(value === ALL ? '' : value)}
          options={carriers.map(name => ({ value: name, label: name }))}
          allValue={ALL}
        />
        {showAgentFilter && (
          <ToolbarSelect
            label="Agent"
            allLabel="All agents"
            value={agentId || ALL}
            onChange={value => setAgentId(value === ALL ? '' : value)}
            // An unattributed bucket has no id the API can filter on, so it is not an option.
            options={agents.flatMap(agent =>
              agent.agentId ? [{ value: agent.agentId, label: agent.agentName }] : []
            )}
            allValue={ALL}
          />
        )}
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => {
            void load();
          }}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Apply'}
        </Button>
        <ToolbarActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <Download aria-hidden className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </ToolbarActions>
      </Toolbar>

      {/* The summary strip. Voided rows are excluded, which is what makes it reconcile. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Applications"
          figure={count(summary?.count)}
          data-figure-label="Applications"
          data-figure-value={count(summary?.count)}
          icon={FileText}
          sub={`${range.from} to ${range.to}`}
        />
        <StatTile
          label="Annualized premium"
          figure={dollars(summary?.totalAnnualizedPremium)}
          data-figure-label="Annualized premium"
          data-figure-value={dollars(summary?.totalAnnualizedPremium)}
          icon={DollarSign}
          tone="money"
          sub="total for the range"
        />
        <StatTile
          label="Average premium"
          figure={dollars(summary?.averageAnnualizedPremium)}
          data-figure-label="Average premium"
          data-figure-value={dollars(summary?.averageAnnualizedPremium)}
          icon={Calculator}
          sub="annualized, per application"
        />
        <StatTile
          label="Carriers"
          figure={count(summary?.byCarrier.length)}
          data-figure-label="Carriers"
          data-figure-value={count(summary?.byCarrier.length)}
          icon={Building2}
          sub="written in the range"
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <Panel className="min-w-0">
        <PanelHeader action={<span className="t-meta tabular-nums text-ink-3">{`${count(rows.length)} shown`}</span>}>
          <PanelTitle>Applications</PanelTitle>
        </PanelHeader>
        <PanelBody flush>
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 t-body text-ink-3">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Loading applications…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              headline="No applications submitted in this range."
              body="Applications appear here as agents enter them at the end of a call."
              icon={FileText}
            />
          ) : (
            <div className="overflow-x-auto">
              <Ledger
                className={cn(
                  '[&_thead_th]:h-10 [&_thead_th]:border-rule [&_thead_th]:bg-sunken [&_thead_th]:px-3',
                  '[&_tbody_td]:h-11 [&_tbody_td]:px-3',
                  '[&_td.num]:font-sans [&_td.num]:text-[13px] [&_td.num]:tabular-nums'
                )}
              >
                <thead>
                  <tr>
                    <th scope="col">Submitted</th>
                    <th scope="col">Carrier</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Applicant</th>
                    <th scope="col">Application no.</th>
                    <th scope="col" className="num">
                      Face
                    </th>
                    <th scope="col" className="num">
                      Premium
                    </th>
                    <th scope="col" className="num" title="The premium as written, annualized">
                      Annualized
                    </th>
                    <th scope="col">Agent</th>
                    <th scope="col">Entered</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const voided = row.voidedAt !== null;
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'transition-colors duration-150 ease-out hover:bg-sunken',
                          voided && 'line-through opacity-60'
                        )}
                        title={
                          voided
                            ? `Voided${row.voidReason ? `: ${row.voidReason}` : ''}. Excluded from the ` +
                              'totals above and from the closing percentage. The credit it consumed ' +
                              'was not reversed.'
                            : undefined
                        }
                      >
                        <td className="t-data whitespace-nowrap !text-ink-2">{submitted(row.submittedAt)}</td>
                        <td className="font-medium text-ink">{row.carrier}</td>
                        <td className="!text-ink-2">
                          {row.planType ? (PLAN_LABELS[row.planType] ?? row.planType) : '—'}
                        </td>
                        <td className="!text-ink-2">{row.applicant}</td>
                        <td className="t-data !text-ink-2">{row.carrierApplicationNumber || '—'}</td>
                        <td className="num">
                          {row.faceAmount === null ? '—' : `$${row.faceAmount.toLocaleString()}`}
                        </td>
                        <td className="num !text-ink-2" title={MODE_LABELS[row.paymentMode] ?? ''}>
                          {dollars(row.modalPremium)}
                        </td>
                        <td className="num">{dollars(row.annualizedPremium)}</td>
                        <td className="max-w-[12rem] truncate !text-ink-2">{row.agentName ?? '—'}</td>
                        <td>
                          {/*
                            A label, and only a label. Both paths count identically
                            in the closing percentage; this says which one to go and
                            check when a number does not match a statement.
                          */}
                          <span
                            className={cn(
                              'inline-flex h-[22px] items-center rounded-full px-2 t-meta font-medium',
                              row.source === 'AGENT_ENTRY'
                                ? 'bg-sunken text-ink-2'
                                : 'bg-brand-tint text-brand-ink'
                            )}
                            title={
                              row.source === 'AGENT_ENTRY'
                                ? 'Logged by the agent after they wrote the business'
                                : 'Submitted by the carrier automation'
                            }
                          >
                            {row.source === 'AGENT_ENTRY' ? 'Agent' : 'Automation'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Ledger>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
