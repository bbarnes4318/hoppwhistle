import { Suspense } from 'react';

import { settle } from '@/lib/server/api';
import {
  fetchBuyerProfile,
  fetchBuyerTargets,
  scanBuyerCalls,
  type BuyerCall,
  type BuyerTarget,
} from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { PanelSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import { trailing30 } from '../_lib/range';

import { TargetingConsole, type TargetView } from './targeting-console';

/**
 * Targeting — change what you receive, and see the price and the volume move.
 *
 * The server's job here is to hand the console one honest histogram: for every
 * target, how many billable calls landed in each of the buckets its own cap is
 * measured in. Everything the buyer then toggles is arithmetic over that array,
 * done in the browser, so cause and effect land together.
 */

export const dynamic = 'force-dynamic';

export default async function BuyerTargetingPage() {
  const scope = await requireBuyerScope();

  const header = (
    <PageHeader
      title="Targeting"
      purpose="Change what you receive. The price per call and the volume you would have taken update as you go — from the last thirty days of real calls, not a projection."
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

  return (
    <>
      {header}
      <Suspense fallback={<PanelSkeleton title="Targets" lines={6} />}>
        <TargetingPanel token={scope.token} buyerId={scope.buyerId} />
      </Suspense>
    </>
  );
}

async function TargetingPanel({ token, buyerId }: { token: string; buyerId: string }) {
  const historyWindow = trailing30();

  const [profileResult, targetsResult, scanResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(fetchBuyerTargets(token, buyerId)),
    settle(
      scanBuyerCalls(token, {
        buyerId,
        startDate: historyWindow.startISO,
        endDate: historyWindow.endISO,
      })
    ),
  ]);

  if (targetsResult.error || !targetsResult.data) {
    return <PanelError title="Targets" message={targetsResult.error ?? 'No targets returned.'} />;
  }

  const targets = targetsResult.data;
  const calls = scanResult.data?.rows ?? [];
  const windowStart = Date.parse(historyWindow.startISO);

  const views: TargetView[] = targets.map(target => buildView(target, calls, windowStart));

  const attributed = new Set(targets.map(t => t.id));
  const unattributed = calls.filter(c => !c.targetId || !attributed.has(c.targetId)).length;

  const coverage = scanResult.error
    ? 'Call history could not be read, so the volume figures are zero rather than wrong.'
    : scanResult.data?.truncated
      ? `Counted from the ${calls.length.toLocaleString()} most recent of ${scanResult.data.total.toLocaleString()} calls in the window.`
      : `Counted from all ${calls.length.toLocaleString()} call${calls.length === 1 ? '' : 's'} in the window.`;

  return (
    <TargetingConsole
      buyerId={buyerId}
      targets={views}
      canPause={profileResult.data?.canPauseTargets ?? false}
      canSetCaps={profileResult.data?.canSetCaps ?? false}
      unattributedCalls={unattributed}
      coverage={coverage}
    />
  );
}

/** Bucket count for the trailing thirty days, in the units the cap is set in. */
function bucketCount(capPeriod: BuyerTarget['capPeriod']): number {
  if (capPeriod === 'HOUR') return 30 * 24;
  if (capPeriod === 'DAY') return 30;
  return 1;
}

function bucketIndex(
  capPeriod: BuyerTarget['capPeriod'],
  at: number,
  windowStart: number,
  buckets: number
): number {
  if (capPeriod === 'MONTH') return 0;
  const size = capPeriod === 'HOUR' ? 3_600_000 : 86_400_000;
  return Math.min(buckets - 1, Math.max(0, Math.floor((at - windowStart) / size)));
}

function buildView(target: BuyerTarget, calls: BuyerCall[], windowStart: number): TargetView {
  const buckets = bucketCount(target.capPeriod);
  const periodCounts = new Array<number>(buckets).fill(0);

  let observedCalls = 0;
  let observedSpend = 0;

  for (const call of calls) {
    if (call.targetId !== target.id) continue;
    observedCalls += 1;
    if (!call.billable) continue;
    observedSpend += call.buyerBillableAmount ?? 0;

    const at = Date.parse(call.createdAt);
    if (Number.isNaN(at)) continue;
    periodCounts[bucketIndex(target.capPeriod, at, windowStart, buckets)] += 1;
  }

  const states = target.acceptedStates ?? [];

  return {
    id: target.id,
    name: target.name,
    type: target.type,
    destination: target.destination,
    status: target.status,
    priority: target.priority,
    maxCap: target.maxCap,
    capPeriod: target.capPeriod,
    maxConcurrency: target.maxConcurrency,
    basePrice: target.basePrice,
    acceptedStates: states,
    // Derived rather than read: "national" means the accepted-state list is
    // empty, and computing it here is one fewer field that can disagree with
    // the list it is meant to describe.
    isNational: states.length === 0,
    pricingRuleCount: Array.isArray(target.pricingRules) ? target.pricingRules.length : 0,
    periodCounts,
    observedCalls,
    observedSpend,
  };
}
