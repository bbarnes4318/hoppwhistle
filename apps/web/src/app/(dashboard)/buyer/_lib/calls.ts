import type { BuyerCall, BuyerProfile } from '@/lib/server/buyer';

import type { DisputableCall } from '../_components/dispute-drawer';

/**
 * The threshold a given call is judged against.
 *
 * The call carries the threshold that was in force when it ran, which is the
 * one that decided whether it was billable. The buyer's current setting is only
 * a fallback for rows recorded before the field existed — using it first would
 * re-judge old calls against a rule they were never billed under.
 */
export function thresholdFor(call: BuyerCall, profile: BuyerProfile | null): number | null {
  if (call.billableDurationThreshold != null) return call.billableDurationThreshold;
  return profile?.billableDuration ?? null;
}

export function connectedSeconds(call: BuyerCall): number {
  return call.connectedDuration ?? call.duration ?? 0;
}

export function recordingUrlFor(call: BuyerCall, allowed: boolean): string | null {
  if (!allowed) return null;
  return call.absoluteRecordingUrl || call.recordingUrl || null;
}

/**
 * One shared bar scale for the whole visible table.
 *
 * DurationBar is only comparable across rows when every row is drawn to the
 * same scale. The 90th percentile rather than the maximum, so a single
 * forty-minute call does not flatten every other bar into a stub; anything past
 * it is drawn clipped, which the component marks.
 */
export function durationScale(calls: BuyerCall[], threshold: number | null): number {
  const floor = Math.max(60, (threshold ?? 60) * 3);
  if (calls.length === 0) return floor;

  const sorted = calls.map(connectedSeconds).sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(floor, Math.ceil(p90 / 30) * 30);
}

export function toDisputable(
  call: BuyerCall,
  profile: BuyerProfile | null,
  canViewRecordings: boolean
): DisputableCall {
  return {
    id: call.id,
    createdAt: call.createdAt,
    callerId: call.callerId,
    campaignName: call.campaignName,
    connectedDuration: call.connectedDuration,
    duration: call.duration,
    thresholdSeconds: thresholdFor(call, profile),
    billable: call.billable,
    billableReason: call.billableReason,
    amount: call.buyerBillableAmount,
    recordingUrl: recordingUrlFor(call, canViewRecordings),
  };
}

/** The dispute reason text the file-a-dispute form composed, read back out. */
export function disputeReasonOf(call: BuyerCall): string | null {
  const meta = call.metadata as { disputeReason?: unknown } | null;
  return typeof meta?.disputeReason === 'string' ? meta.disputeReason : null;
}

export function disputedAtOf(call: BuyerCall): string | null {
  const meta = call.metadata as { disputedAt?: unknown } | null;
  return typeof meta?.disputedAt === 'string' ? meta.disputedAt : null;
}
