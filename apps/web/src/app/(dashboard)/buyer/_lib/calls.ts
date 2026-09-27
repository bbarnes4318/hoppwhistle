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

/**
 * What the call was billed before its return was decided.
 *
 * Deciding a return writes the call's amount to
 * `metadata.originalBuyerBillableAmount` before an acceptance zeroes it, so an
 * accepted return would otherwise read $0.00 -- as if the call had never cost
 * anything, rather than cost this and been given back. Null when the call
 * carries none (undecided, or decided before the field existed).
 */
export function originalAmountOf(call: BuyerCall): number | null {
  const meta = call.metadata as { originalBuyerBillableAmount?: unknown } | null;
  const raw = meta?.originalBuyerBillableAmount;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** The amount a row shows: the original for a decided return, else the current one. */
export function displayAmountOf(call: BuyerCall): number | null {
  const decided = call.disputeStatus === 'ACCEPTED' || call.disputeStatus === 'DENIED';
  return (decided ? originalAmountOf(call) : null) ?? call.buyerBillableAmount;
}

/** The note the agency left when it decided this call's return. */
export function decisionNoteOf(call: BuyerCall): string | null {
  const meta = call.metadata as { decisionNote?: unknown } | null;
  return typeof meta?.decisionNote === 'string' && meta.decisionNote.trim() !== ''
    ? meta.decisionNote
    : null;
}

export function disputedAtOf(call: BuyerCall): string | null {
  const meta = call.metadata as { disputedAt?: unknown } | null;
  return typeof meta?.disputedAt === 'string' ? meta.disputedAt : null;
}

/**
 * Whether the buyer has accepted this call.
 *
 * `metadata.acceptedByBuyerAt` is what the accept route writes. A VERIFIED
 * disposition is also read as accepted, for calls accepted before that route
 * existed, when the button wrote the disposition instead.
 */
export function acceptedByBuyer(call: BuyerCall): boolean {
  const meta = call.metadata as { acceptedByBuyerAt?: unknown } | null;
  return typeof meta?.acceptedByBuyerAt === 'string' || call.disposition === 'VERIFIED';
}

const STREAM_PATH = /\/api\/v1\/recordings\/([^/?#]+)\/stream/;

/** The recording id in a call's stream URL, or null for any other URL. */
export function recordingIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = STREAM_PATH.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}
