'use client';

import { AlertTriangle, Globe, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  Figure,
  FigureRow,
  Ledger,
  Notice,
  SectionRule,
  count,
  dollars,
  pct,
} from '@/components/delivery/ledger';
import { StatusChip } from '@/components/domain/status-chip';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Button } from '@/components/ui/button';
import { useLivePoll } from '@/hooks/use-live-poll';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Delivery, across every agency.
 *
 * ── Why this is the landing screen ───────────────────────────────────────────
 *
 * NetEnroll staff run the whole platform, and drilling into a single agency is
 * the exception. Before this, an operator with no agency selected was told
 * "Choose an agency" and could see nothing until they picked one — so the
 * question "how is the platform doing this morning" could only be answered one
 * agency at a time.
 *
 * This is the same figures the agency's own /delivery panel shows, one row per
 * agency, with the platform totals across the top. Selecting an agency in the
 * switcher narrows the page to that agency's own panel; leaving returns here.
 * The switcher is a filter, not a gate.
 *
 * ── Nothing here is an agency's view of another agency ───────────────────────
 *
 * The route behind it is gated on the platform capability. An agency OWNER
 * cannot reach it, sees only their own agency on /delivery, and gets a 403 from
 * the endpoint rather than an empty table.
 *
 * ── Nulls render as em dashes, never zeroes ──────────────────────────────────
 *
 * A closing percentage with no delivered calls behind it, a rate under review,
 * an agency with no settlement yet. All em dashes. A fabricated 0% on the
 * screen platform staff read every morning is worse than an absent number.
 */

interface PlatformAgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;
  enrolled: boolean;
  chargesEnabled: boolean;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  rate: number | null;
  rateOffset: number;
  curveRate: number | null;
  paymentMethod: string;
  applicationsRemainingOnBlock: number;
  dailyBlockApplications: number;
  overrunToday: number;
  overrunCeiling: number;
  distanceToCeiling: number;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  flags: {
    belowMinimumAndPaused: boolean;
    atCeiling: boolean;
    settlementFailedOrUnpaid: boolean;
    noValidMandate: boolean;
    suspended: boolean;
    enrolledNeverSettled: boolean;
    disputed: boolean;
  };
  dispute: {
    count: number;
    amount: number;
    latestStatus: string | null;
    openedAt: string | null;
  } | null;
  settlement: {
    status: string;
    totalCharged: number | null;
  };
}

interface PlatformTotals {
  agencies: number;
  agenciesExcluded: number;
  enrolled: number;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  applicationsRemainingOnBlock: number;
  overrunToday: number;
  flagged: number;
  disputed: number;
}

interface Overview {
  calendarDay: string;
  agencies: PlatformAgencyRow[];
  totals: PlatformTotals;
  includingNonProduction: boolean;
}

/**
 * The flags that need somebody to act, worst first.
 *
 * A dispute leads, because it is money already taken back and delivery is
 * already stopped. It is its own flag rather than folded into "suspended",
 * even though a dispute does suspend the agency: an operator needs to know
 * which of the two they are looking at.
 *
 * Each flag carries the tone it is shown in. A dispute, an unpaid settlement
 * and a missing payment method are money that is not arriving: dropped. A
 * suspension is a deliberate stop: blocked. The ceiling and the curve minimum
 * are the system working as designed and the agency needing to know: ringing.
 * Never settled is information, not alarm.
 */
type FlagTone = 'dropped' | 'blocked' | 'ringing' | 'neutral';

function flags(row: PlatformAgencyRow): Array<{ label: string; tone: FlagTone; rank: number }> {
  const out: Array<{ label: string; tone: FlagTone; rank: number }> = [];
  if (row.flags.disputed) out.push({ label: 'disputed', tone: 'dropped', rank: 0 });
  if (row.flags.suspended && !row.flags.disputed)
    out.push({ label: 'suspended', tone: 'blocked', rank: 1 });
  if (row.flags.settlementFailedOrUnpaid)
    out.push({ label: 'unpaid settlement', tone: 'dropped', rank: 2 });
  if (row.flags.noValidMandate) out.push({ label: 'no payment method', tone: 'dropped', rank: 3 });
  if (row.flags.atCeiling) out.push({ label: 'at ceiling', tone: 'ringing', rank: 4 });
  if (row.flags.belowMinimumAndPaused)
    out.push({ label: 'below minimum', tone: 'ringing', rank: 5 });
  if (row.flags.enrolledNeverSettled)
    out.push({ label: 'never settled', tone: 'neutral', rank: 6 });
  return out;
}

/** How a settlement status reads, and in what tone. */
function settlementChip(status: string): {
  label: string;
  tone: 'live' | 'ringing' | 'dropped' | 'neutral';
} {
  switch (status) {
    case 'SETTLED':
      return { label: 'settled', tone: 'live' };
    case 'DRY_RUN':
      return { label: 'dry run', tone: 'neutral' };
    case 'NOT_YET_RUN':
      return { label: 'not yet run', tone: 'ringing' };
    case 'NOT_ENROLLED':
      return { label: 'not enrolled', tone: 'neutral' };
    default:
      return { label: status.replace(/_/g, ' ').toLowerCase(), tone: 'dropped' };
  }
}

export function PlatformDeliveryView(): JSX.Element {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Demo and fixture tenants, off by default.
   *
   * Production has five tenants and none is a real agency. They are excluded
   * from the totals whether or not this is on: hiding a row and excluding a
   * number are two decisions, and only the first one is this toggle.
   */
  const [includeNonProduction, setIncludeNonProduction] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<Overview>>(
      `/api/v1/platform/delivery/overview${includeNonProduction ? '?includeNonProduction=true' : ''}`
    );
    setError(response.error ? response.error.message : null);
    setOverview(payload(response) ?? null);
  }, [includeNonProduction]);

  /**
   * Mark a tenant as not a real agency, or unmark it.
   *
   * Deletes nothing, suspends nothing and un-enrols nothing: it excludes the
   * tenant from the totals and hides its row behind the toggle above. The same
   * call reverses it, and the server audits both directions.
   *
   * Which of the production tenants are fixtures is deliberately not something
   * this software decides. A name that looks like a demo is not evidence, and
   * one of them could be carrying live client traffic — so an operator marks
   * them, from the volume figures.
   */
  const setNonProduction = useCallback(
    async (tenantId: string, next: boolean) => {
      const response = await apiClient.put(`/api/v1/platform/tenants/${tenantId}/non-production`, {
        isNonProduction: next,
      });
      if (response.error) {
        setError(response.error.message);
        return;
      }
      await load();
    },
    [load]
  );

  // Live while somebody is looking, on the same terms as the agency panel: a
  // hidden tab does no work and a returning one refreshes immediately.
  const { loading, refresh } = useLivePoll(load, { intervalMs: 30_000 });

  /*
   * Flagged agencies first, worst flag first, then by name. The screen exists
   * so somebody can find what needs acting on, and sorting alphabetically
   * buries it. Enrolled agencies come before unenrolled ones within each
   * group, because an unenrolled agency has nothing on this screen to act on.
   */
  const rows = useMemo(() => {
    const list = overview?.agencies ?? [];
    return [...list]
      .map(row => ({ row, flags: flags(row) }))
      .sort((a, b) => {
        const ar = a.flags.length > 0 ? Math.min(...a.flags.map(f => f.rank)) : 99;
        const br = b.flags.length > 0 ? Math.min(...b.flags.map(f => f.rank)) : 99;
        if (ar !== br) return ar - br;
        if (a.row.enrolled !== b.row.enrolled) return a.row.enrolled ? -1 : 1;
        return a.row.name.localeCompare(b.row.name);
      });
  }, [overview]);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading every agency
        </div>
      </CompactPageShell>
    );
  }

  if (error || !overview) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Delivery — every agency" icon={Globe} />
        <p className="t-body text-ink-3">{error ?? 'No delivery data yet.'}</p>
      </CompactPageShell>
    );
  }

  const { totals } = overview;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Delivery — every agency"
        subtitle={`${overview.calendarDay} · ${count(totals.agencies)} ${
          totals.agencies === 1 ? 'agency' : 'agencies'
        }, ${count(totals.enrolled)} enrolled`}
        icon={Globe}
      >
        <div className="flex items-center gap-2">
          {totals.flagged > 0 && (
            <StatusChip
              value="FLAGGED"
              tone="dropped"
              label={`${count(totals.flagged)} needing attention`}
            />
          )}
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
        </div>
      </CompactPageHeader>

      {totals.disputed > 0 && (
        <Notice
          tone="dropped"
          icon={<AlertTriangle className="h-4 w-4" />}
          title={`${count(totals.disputed)} ${
            totals.disputed === 1 ? 'agency has' : 'agencies have'
          } a disputed payment`}
        >
          Delivery is stopped for each of them and no overrun is being extended. Nothing has been
          refunded or credited — a chargeback is contained, not reversed. Delivery resumes only when
          a platform admin stands the dispute down.
        </Notice>
      )}

      {/*
        The totals, across the production agencies only. What NetEnroll has
        settled today is the one number staff open this page for, so it is the
        hero; the rest are the support that explains it. `agenciesExcluded` is
        stated underneath so a total is never quietly smaller than the table.
      */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1.4fr_2fr]">
        <Figure
          size="hero"
          label="Settled today"
          value={dollars(totals.revenue)}
          sub={`margin ${dollars(totals.margin)} after ${dollars(totals.callCost)} of call cost`}
        />
        <FigureRow className="md:grid-cols-4 md:border-l md:border-rule md:pl-6">
          <Figure label="Calls answered" value={count(totals.deliveredCalls)} />
          <Figure label="Applications" value={count(totals.applications)} />
          <Figure
            label="Closing"
            value={pct(totals.closingPct)}
            sub="applications as a share of answered calls"
          />
          <Figure
            label="On the block"
            value={count(totals.applicationsRemainingOnBlock)}
            sub={`paid and remaining · ${count(totals.overrunToday)} in overrun`}
          />
        </FigureRow>
      </div>

      <SectionRule
        note={
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeNonProduction}
              onChange={event => setIncludeNonProduction(event.target.checked)}
              className="accent-brand-ink"
            />
            Show non-production tenants
          </label>
        }
      >
        Agencies
        <span className="ml-2 t-meta font-normal text-ink-3">
          {totals.agenciesExcluded > 0
            ? `${count(totals.agenciesExcluded)} non-production ${
                totals.agenciesExcluded === 1 ? 'tenant is' : 'tenants are'
              } excluded from the totals above`
            : 'every active tenant is counted in the totals above'}
        </span>
      </SectionRule>

      <div className="overflow-auto rounded-card border border-rule bg-surface">
        <Ledger>
          <thead>
            <tr>
              <th scope="col">Agency</th>
              <th scope="col">Attention</th>
              <th scope="col" className="num">
                Calls
              </th>
              <th scope="col" className="num">
                Apps
              </th>
              <th scope="col" className="num">
                Closing
              </th>
              <th
                scope="col"
                className="num"
                title="Paid applications remaining today / daily block"
              >
                On block
              </th>
              <th scope="col" className="num">
                Overrun
              </th>
              <th scope="col" className="num">
                To ceiling
              </th>
              <th scope="col" className="num">
                Rate
              </th>
              <th scope="col">Settlement</th>
              <th scope="col" className="num">
                Charged
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center t-body text-ink-3">
                  No agencies.
                </td>
              </tr>
            )}
            {rows.map(({ row, flags: rowFlags }) => {
              const chip = settlementChip(row.settlement.status);
              const worst = rowFlags[0]?.tone;
              return (
                <tr
                  key={row.tenantId}
                  className={cn(
                    'hover:bg-sunken',
                    // A 2px mark at the left edge, in the tone of the worst
                    // flag, so a flagged row is findable from across the room
                    // without tinting the whole row and burying its numbers.
                    worst === 'dropped' && 'shadow-[inset_2px_0_0_var(--dropped)]',
                    worst === 'blocked' && 'shadow-[inset_2px_0_0_var(--blocked)]',
                    worst === 'ringing' && 'shadow-[inset_2px_0_0_var(--ringing)]',
                    !row.enrolled && 'text-ink-3'
                  )}
                >
                  <td className="max-w-[18rem]">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate',
                          row.enrolled ? 'font-medium text-ink' : 'text-ink-3'
                        )}
                        title={row.slug}
                      >
                        {row.name}
                      </span>
                      {row.isNonProduction && (
                        <span className="shrink-0 t-meta text-ink-3">non-production</span>
                      )}
                      {!row.enrolled && (
                        <span className="shrink-0 t-meta text-ink-3">not enrolled</span>
                      )}
                      {/*
                        Offered only while the toggle is on, because that is
                        the state an operator is in when they are deciding
                        which tenants are fixtures. It changes nothing about
                        delivery or billing.
                      */}
                      {includeNonProduction && (
                        <button
                          type="button"
                          onClick={() => void setNonProduction(row.tenantId, !row.isNonProduction)}
                          className="shrink-0 t-meta text-brand-ink underline-offset-2 hover:underline"
                        >
                          {row.isNonProduction ? 'mark as production' : 'mark non-production'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {rowFlags.length === 0 ? (
                      <span className="t-meta text-ink-3">—</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {rowFlags.map(flag => (
                          <StatusChip
                            key={flag.label}
                            value={flag.label}
                            label={flag.label}
                            tone={flag.tone}
                            size="sm"
                          />
                        ))}
                        {row.dispute && row.dispute.count > 0 && (
                          <span
                            className="t-meta text-dropped-ink"
                            title={row.dispute.latestStatus ?? undefined}
                          >
                            {count(row.dispute.count)} × {dollars(row.dispute.amount)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num">{count(row.deliveredCalls)}</td>
                  <td className="num">{count(row.applications)}</td>
                  <td className="num font-medium">{pct(row.closingPct)}</td>
                  {/*
                    Every billing figure is an em dash for an agency that is
                    not in the billing system. A zero there would read as
                    "out of credit" rather than "not metered".
                  */}
                  <td className="num">
                    {row.enrolled
                      ? `${count(row.applicationsRemainingOnBlock)} / ${count(row.dailyBlockApplications)}`
                      : '—'}
                  </td>
                  <td className="num">{row.enrolled ? count(row.overrunToday) : '—'}</td>
                  <td
                    className={cn(
                      'num',
                      row.enrolled && row.distanceToCeiling === 0 && '!text-ringing-ink'
                    )}
                  >
                    {row.enrolled ? count(row.distanceToCeiling) : '—'}
                  </td>
                  <td className="num">
                    <span
                      title={
                        row.rateOffset > 0
                          ? `curve ${dollars(row.curveRate)} + offset ${dollars(row.rateOffset)}`
                          : undefined
                      }
                    >
                      {dollars(row.rate)}
                      {/*
                        The offset is part of the price, not a fee. Marked, and
                        explained on hover, rather than spelled out in every
                        row: the column has to stay scannable.
                      */}
                      {row.rateOffset > 0 && <span className="text-ink-3">*</span>}
                    </span>
                  </td>
                  <td>
                    <StatusChip
                      value={row.settlement.status}
                      label={chip.label}
                      tone={chip.tone}
                      size="sm"
                    />
                  </td>
                  <td className="num !text-ink-2">
                    {row.settlement.totalCharged !== null
                      ? dollars(row.settlement.totalCharged)
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Ledger>
      </div>

      <p className="t-meta text-ink-3">
        * rate includes an agreed offset above the curve; hover for the two halves. Enter an agency
        in the switcher to narrow this page to it; leaving returns here.
      </p>
    </CompactPageShell>
  );
}
