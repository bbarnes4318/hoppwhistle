import { Suspense } from 'react';

import {
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
} from '@/components/domain';
import { settle } from '@/lib/server/api';
import { fetchBuyerCalls, fetchBuyerProfile, fetchCostReport, toMajor } from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { StatTileRowSkeleton, TableSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import {
  disputedAtOf,
  disputeReasonOf,
  durationScale,
  recordingUrlFor,
  thresholdFor,
} from '../_lib/calls';
import { resolveRange } from '../_lib/range';

import { FilePanel, type FileableCall } from './file-panel';
import { FiledDisputesTable, type FiledDisputeRow } from './filed-table';

/**
 * Disputes — file in ten seconds, track the outcome.
 *
 * Filing is two clicks from a list you can scan: the recent charged calls, each
 * with its duration against the threshold already drawn, so the most common
 * dispute is visible before you open anything. Everything a reviewer needs —
 * the recording, the measurement — is attached by the page, not typed by you.
 */

export const dynamic = 'force-dynamic';

export default async function BuyerDisputesPage() {
  const scope = await requireBuyerScope();
  const range = resolveRange({ range: '30d' });

  const header = (
    <PageHeader
      title="Disputes"
      purpose="File against a call you should not have been charged for, and follow what happens to it. The recording and the duration measurement go with every dispute automatically."
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
    canViewRecordings: scope.canViewRecordings,
  };

  return (
    <>
      {header}

      <Suspense fallback={<StatTileRowSkeleton tiles={3} />}>
        <DisputeSummary {...args} />
      </Suspense>

      <Suspense fallback={<TableSkeleton title="File a dispute" columns={5} rows={6} />}>
        <FileSection {...args} />
      </Suspense>

      <Suspense fallback={<TableSkeleton title="Filed" columns={5} rows={5} />}>
        <FiledSection {...args} />
      </Suspense>
    </>
  );
}

interface Args {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
  canViewRecordings: boolean;
}

async function DisputeSummary({ token, buyerId, startISO, endISO }: Args) {
  const [reportResult, openResult] = await Promise.all([
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

  if (reportResult.error || !reportResult.data) {
    return <PanelError title="Disputes" message={reportResult.error ?? 'No report returned.'} />;
  }

  const spend = toMajor(reportResult.data.totals.buyerCost);
  const disputed = toMajor(reportResult.data.totals.disputes);
  const open = openResult.data?.total ?? 0;

  return (
    <StatTileRow>
      <StatTile
        label="Open disputes"
        figure={open.toLocaleString()}
        sub="Last 30 days"
        emphasis
        className="col-span-2 lg:col-span-1"
      />
      <StatTile
        label="Under dispute"
        figure={`$${disputed.toFixed(2)}`}
        sub={
          spend > 0
            ? `${((disputed / spend) * 100).toFixed(1)}% of what you spent`
            : 'No spend in the window'
        }
      />
      <StatTile
        label="Billable calls"
        figure={reportResult.data.totals.billableCalls.toLocaleString()}
        sub="Every one of them can be disputed"
      />
    </StatTileRow>
  );
}

async function FileSection({ token, buyerId, startISO, endISO, canViewRecordings }: Args) {
  const [profileResult, callsResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(
      fetchBuyerCalls(token, {
        buyerId,
        pageSize: 50,
        startDate: startISO,
        endDate: endISO,
        disputeStatus: 'NONE',
      })
    ),
  ]);

  if (callsResult.error || !callsResult.data) {
    return (
      <PanelError title="File a dispute" message={callsResult.error ?? 'No calls returned.'} />
    );
  }

  const profile = profileResult.data;

  if (profile && !profile.canDisputeConversions) {
    return (
      <Panel>
        <PanelHeader>
          <PanelTitle>File a dispute</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <EmptyState
            headline="Your account cannot file disputes"
            body="Disputes are switched off for this buyer account. Your account manager can turn them on."
          />
        </PanelBody>
      </Panel>
    );
  }

  // Only calls that actually cost something and are not already settled — a
  // call you were not charged for has nothing to dispute.
  const candidates = callsResult.data.rows.filter(
    call => call.billable && call.disposition !== 'VERIFIED'
  );
  const scale = durationScale(candidates, profile?.billableDuration ?? null);

  const rows: FileableCall[] = candidates.slice(0, 25).map(call => ({
    id: call.id,
    createdAt: call.createdAt,
    callerId: call.callerId,
    campaignName: call.campaignName,
    connectedDuration: call.connectedDuration ?? call.duration ?? 0,
    duration: call.duration,
    thresholdSeconds: thresholdFor(call, profile),
    billable: call.billable,
    billableReason: call.billableReason,
    amount: call.buyerBillableAmount,
    recordingUrl: recordingUrlFor(call, canViewRecordings),
    scaleSeconds: scale,
  }));

  return (
    <Panel>
      <PanelHeader
        action={<span className="t-meta text-ink-3">Reason, then file. The rest is attached.</span>}
      >
        <PanelTitle>File a dispute</PanelTitle>
      </PanelHeader>
      <PanelBody flush>
        <FilePanel calls={rows} />
      </PanelBody>
    </Panel>
  );
}

async function FiledSection({ token, buyerId, startISO, endISO }: Args) {
  const [profileResult, disputedResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(
      fetchBuyerCalls(token, {
        buyerId,
        pageSize: 50,
        startDate: startISO,
        endDate: endISO,
        disputeStatus: 'DISPUTED',
      })
    ),
  ]);

  if (disputedResult.error || !disputedResult.data) {
    return <PanelError title="Filed" message={disputedResult.error ?? 'No disputes returned.'} />;
  }

  const profile = profileResult.data;
  const calls = disputedResult.data.rows;
  const scale = durationScale(calls, profile?.billableDuration ?? null);

  const rows: FiledDisputeRow[] = calls.map(call => ({
    id: call.id,
    callerId: call.callerId,
    campaignName: call.campaignName,
    createdAt: call.createdAt,
    filedAt: disputedAtOf(call),
    status: call.disputeStatus ?? 'DISPUTED',
    reason: disputeReasonOf(call),
    amount: call.buyerBillableAmount,
    connectedSeconds: call.connectedDuration ?? call.duration ?? 0,
    thresholdSeconds: thresholdFor(call, profile),
    scaleSeconds: scale,
  }));

  return (
    <Panel>
      <PanelHeader
        action={<span className="t-meta text-ink-3">{rows.length} filed in the last 30 days</span>}
      >
        <PanelTitle>Filed</PanelTitle>
      </PanelHeader>
      <PanelBody flush>
        <FiledDisputesTable rows={rows} />
      </PanelBody>
    </Panel>
  );
}
