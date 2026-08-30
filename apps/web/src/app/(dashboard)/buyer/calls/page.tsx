import { Suspense } from 'react';

import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
} from '@/components/domain';
import { settle } from '@/lib/server/api';
import {
  CALL_PAGE_SIZE,
  fetchBuyerCalls,
  fetchBuyerProfile,
  fetchCampaigns,
  fetchCostReport,
  toMajor,
} from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { StatTileRowSkeleton, TableSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import { UrlFilterBar } from '../_components/url-filter-bar';
import { UrlPagination } from '../_components/url-pagination';
import { durationScale, recordingUrlFor, thresholdFor } from '../_lib/calls';
import { firstParam, parsePage, RANGE_OPTIONS, resolveRange } from '../_lib/range';

import { CallsTable, type CallRowView } from './calls-table';

/**
 * Calls — review, accept, dispute, in that order of speed.
 *
 * A server component: the rows are in the HTML on first paint, with no effect
 * to fire and no spinner to sit through. The only client code on the page is
 * the filter bar, the pager and the table's own interaction — the leaves that
 * genuinely need a browser.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const OUTCOME_OPTIONS = [
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'NONE', label: 'Not disputed' },
];

export default async function BuyerCallsPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requireBuyerScope();
  const range = resolveRange(searchParams);
  const page = parsePage(searchParams.page);
  const search = firstParam(searchParams.q);
  const campaignId = firstParam(searchParams.campaign);
  const disputeStatus = firstParam(searchParams.outcome);

  const header = (
    <PageHeader
      title="Calls"
      purpose="Review what came in, then accept it or dispute it. Both are one click from the row — the detail panel is there when you want it, not because you need it to act."
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

  const filterKey = [range.startISO, range.endISO, search, campaignId, disputeStatus].join('|');

  return (
    <>
      {header}

      <Suspense key={`summary-${filterKey}`} fallback={<StatTileRowSkeleton />}>
        <CallsSummary
          token={scope.token}
          buyerId={scope.buyerId}
          startISO={range.startISO}
          endISO={range.endISO}
          campaignId={campaignId}
          rangeLabel={range.label}
        />
      </Suspense>

      <Suspense
        key={`list-${filterKey}-${page}`}
        fallback={<TableSkeleton title="Calls" columns={6} rows={CALL_PAGE_SIZE} />}
      >
        <CallsPanel
          token={scope.token}
          buyerId={scope.buyerId}
          canViewRecordings={scope.canViewRecordings}
          page={page}
          startISO={range.startISO}
          endISO={range.endISO}
          search={search}
          campaignId={campaignId}
          disputeStatus={disputeStatus}
        />
      </Suspense>
    </>
  );
}

async function CallsSummary({
  token,
  buyerId,
  startISO,
  endISO,
  campaignId,
  rangeLabel,
}: {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
  campaignId?: string;
  rangeLabel: string;
}) {
  const { data, error } = await settle(
    fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO, campaignId })
  );

  if (error || !data) {
    return <PanelError title="Call summary" message={error ?? 'No summary returned.'} />;
  }

  const { totals } = data;
  const spend = toMajor(totals.buyerCost);
  const avg = totals.billableCalls > 0 ? spend / totals.billableCalls : 0;

  return (
    <StatTileRow>
      <StatTile
        label="Calls received"
        figure={totals.totalCalls.toLocaleString()}
        sub={rangeLabel}
      />
      <StatTile
        label="Billable"
        figure={totals.billableCalls.toLocaleString()}
        sub={`${(totals.billableRate * 100).toFixed(1)}% of what came in`}
      />
      <StatTile
        label="Spend"
        figure={`$${spend.toFixed(2)}`}
        sub={`${totals.nonBillableCalls.toLocaleString()} calls cost you nothing`}
        emphasis
        className="col-span-2 lg:col-span-1"
      />
      <StatTile
        label="Per billable call"
        figure={`$${avg.toFixed(2)}`}
        sub={`Average connect ${totals.averageDuration}s`}
      />
    </StatTileRow>
  );
}

async function CallsPanel({
  token,
  buyerId,
  canViewRecordings,
  page,
  startISO,
  endISO,
  search,
  campaignId,
  disputeStatus,
}: {
  token: string;
  buyerId: string;
  canViewRecordings: boolean;
  page: number;
  startISO: string;
  endISO: string;
  search?: string;
  campaignId?: string;
  disputeStatus?: string;
}) {
  const [profileResult, callsResult, campaignsResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(
      fetchBuyerCalls(token, {
        buyerId,
        page,
        pageSize: CALL_PAGE_SIZE,
        startDate: startISO,
        endDate: endISO,
        search,
        campaignId,
        disputeStatus,
      })
    ),
    settle(fetchCampaigns(token)),
  ]);

  if (callsResult.error || !callsResult.data) {
    return <PanelError title="Calls" message={callsResult.error ?? 'No calls returned.'} />;
  }

  const profile = profileResult.data;
  const { rows, total, totalPages } = callsResult.data;
  const scale = durationScale(rows, profile?.billableDuration ?? null);

  const view: CallRowView[] = rows.map(call => ({
    id: call.id,
    createdAt: call.createdAt,
    callerId: call.callerId,
    toNumber: call.toNumber ?? call.targetNumber,
    campaignName: call.campaignName,
    targetName: call.targetName,
    status: call.status,
    connectedSeconds: call.connectedDuration ?? call.duration ?? 0,
    thresholdSeconds: thresholdFor(call, profile),
    billable: call.billable,
    billableReason: call.billableReason,
    amount: call.buyerBillableAmount,
    chargeStatus: call.buyerChargeStatus,
    disputeStatus: call.disputeStatus,
    disposition: call.disposition,
    recordingUrl: recordingUrlFor(call, canViewRecordings),
  }));

  const filtered = Boolean(search || campaignId || disputeStatus);

  return (
    <Panel>
      <PanelHeader
        action={
          <span className="t-meta text-ink-3">
            {total.toLocaleString()} call{total === 1 ? '' : 's'}
          </span>
        }
      >
        <PanelTitle>Calls</PanelTitle>
      </PanelHeader>

      <UrlFilterBar
        search={{ param: 'q', placeholder: 'Caller, number or call ID' }}
        selects={[
          {
            param: 'range',
            label: 'Range',
            allLabel: 'Last 30 days',
            options: RANGE_OPTIONS.map(o => ({ value: o.value, label: o.label })),
          },
          {
            param: 'campaign',
            label: 'Campaign',
            allLabel: 'All campaigns',
            options: (campaignsResult.data ?? []).map(c => ({ value: c.id, label: c.name })),
          },
          { param: 'outcome', label: 'Dispute', allLabel: 'Any', options: OUTCOME_OPTIONS },
        ]}
        dateRange
      />

      <PanelBody flush>
        <CallsTable
          rows={view}
          scaleSeconds={scale}
          canDispute={profile?.canDisputeConversions ?? false}
          emptyIsFiltered={filtered}
        />
      </PanelBody>

      {totalPages > 1 || total > CALL_PAGE_SIZE ? (
        <div className="border-t border-rule">
          <UrlPagination page={page} pageSize={CALL_PAGE_SIZE} total={total} noun="calls" />
        </div>
      ) : null}
    </Panel>
  );
}
