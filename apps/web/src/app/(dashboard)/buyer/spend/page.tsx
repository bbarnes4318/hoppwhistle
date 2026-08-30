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
  fetchCampaigns,
  fetchCostReport,
  scanBuyerCalls,
  toMajor,
  type BuyerCall,
} from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { ChartSkeleton, StatTileRowSkeleton, TableSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import { UrlFilterBar } from '../_components/url-filter-bar';
import { firstParam, RANGE_OPTIONS, resolveRange } from '../_lib/range';

import { CampaignSpendTable, type CampaignSpendRow } from './campaign-table';
import { HourProfile, type HourBucket } from './hour-profile';

/**
 * Spend — where the money went, by campaign and by hour.
 *
 * Two cuts of the same window. By campaign says which of your sources you are
 * paying for; by hour says when the spend actually happens, which is what you
 * change if you want a different bill without changing what you buy.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BuyerSpendPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requireBuyerScope();
  const range = resolveRange(searchParams);
  const campaignId = firstParam(searchParams.campaign);

  const header = (
    <PageHeader
      title="Spend"
      purpose="Where the money went over the window you pick — broken down by campaign, and by the hour of day it was spent."
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

  const args = {
    token: scope.token,
    buyerId: scope.buyerId,
    startISO: range.startISO,
    endISO: range.endISO,
    campaignId,
  };
  const key = `${range.startISO}|${range.endISO}|${campaignId ?? ''}`;

  return (
    <>
      {header}

      <Suspense key={`totals-${key}`} fallback={<StatTileRowSkeleton />}>
        <SpendTotals {...args} rangeLabel={range.label} />
      </Suspense>

      <Suspense
        key={`campaigns-${key}`}
        fallback={<TableSkeleton title="By campaign" columns={5} rows={6} />}
      >
        <ByCampaign {...args} />
      </Suspense>

      <Suspense key={`hours-${key}`} fallback={<ChartSkeleton title="By hour" />}>
        <ByHour {...args} />
      </Suspense>
    </>
  );
}

interface PanelArgs {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
  campaignId?: string;
}

async function SpendTotals({ rangeLabel, ...args }: PanelArgs & { rangeLabel: string }) {
  const { data, error } = await settle(
    fetchCostReport(args.token, {
      buyerId: args.buyerId,
      startDate: args.startISO,
      endDate: args.endISO,
      campaignId: args.campaignId,
    })
  );

  if (error || !data) {
    return <PanelError title="Spend totals" message={error ?? 'No report returned.'} />;
  }

  const { totals } = data;
  const spend = toMajor(totals.buyerCost);
  const disputed = toMajor(totals.disputes);

  return (
    <StatTileRow>
      <StatTile
        label="Spend"
        figure={`$${spend.toFixed(2)}`}
        sub={rangeLabel}
        emphasis
        className="col-span-2 lg:col-span-1"
      />
      <StatTile
        label="Billable calls"
        figure={totals.billableCalls.toLocaleString()}
        sub={`${(totals.billableRate * 100).toFixed(1)}% of ${totals.totalCalls.toLocaleString()} calls`}
      />
      <StatTile
        label="Per billable call"
        figure={`$${(totals.billableCalls > 0 ? spend / totals.billableCalls : 0).toFixed(2)}`}
        sub={`Average connect ${totals.averageDuration}s`}
      />
      <StatTile
        label="Under dispute"
        figure={`$${disputed.toFixed(2)}`}
        sub={disputed > 0 ? 'Not yet resolved' : 'Nothing outstanding'}
      />
    </StatTileRow>
  );
}

async function ByCampaign(args: PanelArgs) {
  const [reportResult, campaignsResult] = await Promise.all([
    settle(
      fetchCostReport(args.token, {
        buyerId: args.buyerId,
        startDate: args.startISO,
        endDate: args.endISO,
        campaignId: args.campaignId,
      })
    ),
    settle(fetchCampaigns(args.token)),
  ]);

  if (reportResult.error || !reportResult.data) {
    return <PanelError title="By campaign" message={reportResult.error ?? 'No report returned.'} />;
  }

  const rows: CampaignSpendRow[] = reportResult.data.rows
    .map(row => ({
      key: `${row.campaignId}-${row.destinationNumber}`,
      campaignName: row.campaignName,
      destinationNumber: row.destinationNumber,
      totalCalls: row.totalCalls,
      billableCalls: row.billableCalls,
      billableRate: row.billableRate,
      averageDuration: row.averageDuration,
      pricePerBillableCall: toMajor(row.pricePerBillableCall),
      cost: toMajor(row.buyerCost),
      disputes: toMajor(row.disputes),
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>By campaign</PanelTitle>
      </PanelHeader>

      <UrlFilterBar
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
        ]}
        dateRange
      />

      <PanelBody flush>
        <CampaignSpendTable rows={rows} />
      </PanelBody>
    </Panel>
  );
}

/**
 * The hour profile is the one figure on this page that is not an aggregate the
 * API computes: there is no endpoint that groups a buyer's spend by hour, so it
 * is bucketed here from the individual calls. That scan is bounded, and when
 * the window holds more calls than it read the caption says so rather than
 * presenting a partial window as the whole one.
 */
async function ByHour(args: PanelArgs) {
  const { data, error } = await settle(
    scanBuyerCalls(args.token, {
      buyerId: args.buyerId,
      startDate: args.startISO,
      endDate: args.endISO,
      campaignId: args.campaignId,
    })
  );

  if (error || !data) {
    return <PanelError title="By hour" message={error ?? 'No calls returned.'} />;
  }

  const buckets = bucketByHour(data.rows);
  const coverage = data.truncated
    ? `From the ${data.rows.length.toLocaleString()} most recent of ${data.total.toLocaleString()} calls in this window.`
    : `All ${data.total.toLocaleString()} call${data.total === 1 ? '' : 's'} in this window.`;

  return (
    <Panel>
      <PanelHeader action={<span className="t-meta text-ink-3">Spend, not call count</span>}>
        <PanelTitle>By hour</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <HourProfile buckets={buckets} coverage={coverage} />
      </PanelBody>
    </Panel>
  );
}

function bucketByHour(calls: BuyerCall[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    calls: 0,
    billableCalls: 0,
    cost: 0,
  }));

  for (const call of calls) {
    const at = new Date(call.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = buckets[at.getUTCHours()];
    bucket.calls += 1;
    if (call.billable) bucket.billableCalls += 1;
    bucket.cost += call.buyerBillableAmount ?? 0;
  }

  return buckets;
}
