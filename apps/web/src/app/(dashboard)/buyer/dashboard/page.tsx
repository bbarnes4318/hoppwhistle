import { ArrowUpRight, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import {
  EmptyState,
  MoneyCell,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
} from '@/components/domain';
import { settle } from '@/lib/server/api';
import {
  fetchBuyerCalls,
  fetchBuyerProfile,
  fetchCostReport,
  fetchLiveMetrics,
  toMajor,
} from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { RecentCallsTable, type RecentCallRow } from '../_components/recent-calls-table';
import { PanelSkeleton, StatTileRowSkeleton, TableSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import { durationScale, thresholdFor } from '../_lib/calls';
import { resolveRange } from '../_lib/range';

/**
 * Dashboard — am I getting what I'm paying for?
 *
 * The page is built around one ratio: what the calls cost against what
 * proportion of them were worth paying for. Everything else on it either
 * qualifies that ratio (today's live figures, the campaigns the money went to)
 * or is the thing you would go do about it (open disputes, recent calls).
 *
 * Each panel is its own Suspense boundary against its own endpoint, so the live
 * figures do not wait on the thirty-day report and neither waits on the other.
 */

export const dynamic = 'force-dynamic';

export default async function BuyerDashboardPage() {
  const scope = await requireBuyerScope();
  const range = resolveRange({ range: '30d' });

  const header = (
    <PageHeader
      title="Your account"
      purpose="What you spent, what share of it was billable, and what is happening right now."
      action={
        <Link
          href="/buyer/calls"
          className="t-body inline-flex items-center gap-1 text-money underline"
        >
          Review calls <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
    />
  );

  if (!scope.buyerId) {
    return (
      <>
        {header}
        <NoBuyerScope />
      </>
    );
  }

  const common = { token: scope.token, buyerId: scope.buyerId };

  return (
    <>
      {header}

      <Suspense fallback={<StatTileRowSkeleton />}>
        <ValueSummary {...common} startISO={range.startISO} endISO={range.endISO} />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Suspense fallback={<PanelSkeleton title="Right now" lines={3} />}>
          <RightNowPanel token={scope.token} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton title="Balance" lines={3} />}>
          <BalancePanel {...common} startISO={range.startISO} endISO={range.endISO} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<TableSkeleton title="Latest calls" rows={6} columns={5} />}>
            <LatestCalls {...common} />
          </Suspense>
        </div>
        <Suspense fallback={<PanelSkeleton title="Where the money went" lines={5} />}>
          <TopCampaigns {...common} startISO={range.startISO} endISO={range.endISO} />
        </Suspense>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ panels */

async function ValueSummary({
  token,
  buyerId,
  startISO,
  endISO,
}: {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
}) {
  const [report, disputes] = await Promise.all([
    settle(fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO })),
    settle(
      fetchBuyerCalls(token, {
        buyerId,
        pageSize: 1,
        startDate: startISO,
        endDate: endISO,
        disputeStatus: 'DISPUTED',
      })
    ),
  ]);

  if (report.error || !report.data) {
    return (
      <PanelError title="Thirty-day summary" message={report.error ?? 'No report returned.'} />
    );
  }

  const { totals } = report.data;
  const spend = toMajor(totals.buyerCost);
  const perBillable = totals.billableCalls > 0 ? spend / totals.billableCalls : 0;
  const openDisputes = disputes.data?.total ?? 0;

  return (
    <StatTileRow>
      <StatTile
        label="Spend"
        figure={`$${spend.toFixed(2)}`}
        sub="Last 30 days"
        emphasis
        className="col-span-2 lg:col-span-1"
      />
      <StatTile
        label="Billable rate"
        figure={`${(totals.billableRate * 100).toFixed(1)}%`}
        sub={`${totals.billableCalls.toLocaleString()} of ${totals.totalCalls.toLocaleString()} calls`}
      />
      <StatTile
        label="Per billable call"
        figure={`$${perBillable.toFixed(2)}`}
        sub={`Average connect ${totals.averageDuration}s`}
      />
      <StatTile
        label="Open disputes"
        figure={openDisputes.toLocaleString()}
        sub={
          toMajor(totals.disputes) > 0
            ? `$${toMajor(totals.disputes).toFixed(2)} under dispute`
            : 'Nothing under dispute'
        }
      />
    </StatTileRow>
  );
}

/**
 * Today's figures, straight from the live endpoint.
 *
 * Any figure it cannot source correctly comes back null and is rendered as a
 * dash with the reason underneath — never as a zero. On a screen about someone
 * else's money, a fabricated zero is worse than an absent number.
 */
async function RightNowPanel({ token }: { token: string }) {
  const { data, error } = await settle(fetchLiveMetrics(token));

  if (error || !data) {
    return <PanelError title="Right now" message={error ?? 'No live figures returned.'} />;
  }

  const cap = data.callCapToday;
  const toward = data.callsTowardCapToday;

  const figures: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'Calls in flight',
      value: data.callsInFlight?.toLocaleString() ?? '—',
      sub:
        data.callsInFlight == null
          ? (data.unavailable?.callsInFlight ?? 'Not available')
          : 'Connected right now',
    },
    {
      label: 'Spend today',
      value: data.spendToday != null ? `$${toMajor(data.spendToday).toFixed(2)}` : '—',
      sub:
        data.spendToday == null
          ? (data.unavailable?.spendToday ?? 'Not available')
          : 'Since midnight',
    },
    {
      label: 'Against your cap',
      value:
        toward != null && cap != null ? `${toward} / ${cap}` : (toward?.toLocaleString() ?? '—'),
      sub:
        cap == null
          ? (data.unavailable?.callCapToday ?? 'No daily cap set')
          : 'Calls taken against the daily cap',
    },
  ];

  return (
    <Panel>
      <PanelHeader
        action={
          data.billableRate != null ? (
            <span className="t-meta text-ink-3">
              {(data.billableRate * 100).toFixed(0)}% billable this hour
            </span>
          ) : null
        }
      >
        <PanelTitle>Right now</PanelTitle>
      </PanelHeader>
      <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {figures.map(f => (
          <div key={f.label}>
            <p className="t-label text-ink-3">{f.label}</p>
            <p className="t-figure mt-1.5 text-ink">{f.value}</p>
            <p className="t-meta mt-1 text-ink-3">{f.sub}</p>
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}

async function BalancePanel({
  token,
  buyerId,
  startISO,
  endISO,
}: {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
}) {
  const [profileResult, reportResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO })),
  ]);

  if (profileResult.error || !profileResult.data) {
    return <PanelError title="Balance" message={profileResult.error ?? 'No profile returned.'} />;
  }

  const profile = profileResult.data;
  const spend = toMajor(reportResult.data?.totals.buyerCost ?? '0');
  const burnPerDay = spend / 30;
  const runwayDays = burnPerDay > 0 ? Math.floor(profile.walletBalance / burnPerDay) : null;
  const upfront = profile.billingType === 'UPFRONT';

  return (
    <Panel>
      <PanelHeader
        action={
          <Link href="/buyer/billing" className="t-meta text-money underline">
            Billing
          </Link>
        }
      >
        <PanelTitle>{upfront ? 'Balance' : 'Billed on terms'}</PanelTitle>
      </PanelHeader>
      <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="t-label text-ink-3">{upfront ? 'Balance' : 'Unbilled'}</p>
          <p className="t-figure mt-1.5 text-ink">
            <MoneyCell
              amount={
                upfront
                  ? profile.walletBalance
                  : toMajor(reportResult.data?.totals.pendingInvoice ?? '0')
              }
              unit="major"
              size="figure"
              tone="auto"
            />
          </p>
          <p className="t-meta mt-1 text-ink-3">
            {upfront ? 'Prepaid funds on hand' : 'Accrued since your last invoice'}
          </p>
        </div>
        <div>
          <p className="t-label text-ink-3">Burn rate</p>
          <p className="t-figure mt-1.5 text-ink">${burnPerDay.toFixed(2)}</p>
          <p className="t-meta mt-1 text-ink-3">Average per day over 30 days</p>
        </div>
        <div>
          <p className="t-label text-ink-3">Runway</p>
          <p className="t-figure mt-1.5 text-ink">
            {upfront ? (runwayDays != null ? `${runwayDays}d` : '—') : 'n/a'}
          </p>
          <p className="t-meta mt-1 text-ink-3">
            {upfront
              ? runwayDays != null
                ? 'At the current burn rate'
                : 'No spend to project from'
              : 'You are invoiced, not prepaid'}
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}

async function LatestCalls({ token, buyerId }: { token: string; buyerId: string }) {
  const [profileResult, callsResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(fetchBuyerCalls(token, { buyerId, pageSize: 6 })),
  ]);

  if (callsResult.error || !callsResult.data) {
    return <PanelError title="Latest calls" message={callsResult.error ?? 'No calls returned.'} />;
  }

  const profile = profileResult.data;
  const rows: RecentCallRow[] = callsResult.data.rows.map(call => ({
    id: call.id,
    createdAt: call.createdAt,
    callerId: call.callerId,
    campaignName: call.campaignName,
    connectedSeconds: call.connectedDuration ?? call.duration ?? 0,
    thresholdSeconds: thresholdFor(call, profile),
    amount: call.buyerBillableAmount,
  }));

  return (
    <Panel>
      <PanelHeader
        action={
          <Link href="/buyer/calls" className="t-meta text-money underline">
            All calls
          </Link>
        }
      >
        <PanelTitle>Latest calls</PanelTitle>
      </PanelHeader>
      <PanelBody flush>
        <RecentCallsTable
          rows={rows}
          scaleSeconds={durationScale(callsResult.data.rows, profile?.billableDuration ?? null)}
        />
      </PanelBody>
    </Panel>
  );
}

async function TopCampaigns({
  token,
  buyerId,
  startISO,
  endISO,
}: {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
}) {
  const { data, error } = await settle(
    fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO })
  );

  if (error || !data) {
    return <PanelError title="Where the money went" message={error ?? 'No report returned.'} />;
  }

  const rows = [...data.rows]
    .sort((a, b) => toMajor(b.buyerCost) - toMajor(a.buyerCost))
    .slice(0, 5);
  const top = toMajor(rows[0]?.buyerCost ?? '0');

  return (
    <Panel>
      <PanelHeader
        action={
          <Link href="/buyer/spend" className="t-meta text-money underline">
            Spend
          </Link>
        }
      >
        <PanelTitle>Where the money went</PanelTitle>
      </PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
          <EmptyState
            headline="No spend in the last 30 days"
            body="Once calls start billing, the campaigns they came from show up here."
            icon={ShieldAlert}
          />
        ) : (
          <ul className="space-y-2.5">
            {rows.map(row => {
              const cost = toMajor(row.buyerCost);
              const width = top > 0 ? Math.max(2, (cost / top) * 100) : 0;
              return (
                <li key={`${row.campaignId}-${row.destinationNumber}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-body min-w-0 truncate text-ink">
                      {row.campaignName || 'Unattributed'}
                    </span>
                    <MoneyCell amount={cost} unit="major" className="shrink-0" />
                  </div>
                  <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-money" style={{ width: `${width}%` }} />
                  </div>
                  <p className="t-meta mt-1 text-ink-3">
                    {row.billableCalls.toLocaleString()} billable of{' '}
                    {row.totalCalls.toLocaleString()}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
