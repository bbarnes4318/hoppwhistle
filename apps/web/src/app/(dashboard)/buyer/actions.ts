'use server';

import { revalidatePath } from 'next/cache';

import { apiPatch, apiPost } from '@/lib/server/api';
import { getSession } from '@/lib/server/session';

import { composeDisputeReason, isDisputeReason, type DisputeInput } from './_lib/dispute';

/**
 * Every write the buyer makes.
 *
 * These are server actions rather than client fetches so the mutation and the
 * re-read are one round trip: the action writes, revalidatePath drops the
 * server render, and the page comes back with the new state already in the
 * markup — no client cache to reconcile and no refetch effect to fire.
 *
 * A 'use server' module may only export async functions, so the dispute
 * vocabulary the form renders from lives in ./_lib/dispute.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function authed(): Promise<{ token: string | null; error?: string }> {
  const session = await getSession();
  if (!session) return { token: null, error: 'Your session has expired. Sign in again.' };
  return { token: session.token };
}

function failure(err: unknown, fallback: string): ActionResult {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

const BUYER_PATHS = ['/buyer/dashboard', '/buyer/calls', '/buyer/disputes', '/buyer/spend'];

function revalidateBuyer(): void {
  for (const path of BUYER_PATHS) revalidatePath(path);
}

/**
 * Accept a call — the buyer confirming this was what they paid for.
 *
 * Recorded as the VERIFIED disposition, the platform's existing term for "this
 * connection was real". Accepting is not a charge event: the charge already
 * happened when the call crossed the threshold. What it settles is whether the
 * buyer is going to argue about it.
 */
export async function acceptCall(callId: string): Promise<ActionResult> {
  const auth = await authed();
  if (!auth.token) return { ok: false, error: auth.error };

  try {
    await apiPost(`/api/v1/calls/${callId}/disposition`, auth.token, { disposition: 'VERIFIED' });
    revalidateBuyer();
    return { ok: true };
  } catch (err) {
    return failure(err, 'Could not accept this call.');
  }
}

export async function disputeCall(input: DisputeInput): Promise<ActionResult> {
  const auth = await authed();
  if (!auth.token) return { ok: false, error: auth.error };

  if (!isDisputeReason(input.reason)) {
    return { ok: false, error: 'Pick a reason for the dispute.' };
  }

  try {
    await apiPost(`/api/v1/calls/${input.callId}/dispute`, auth.token, {
      reason: composeDisputeReason(input.reason, input.note, input.evidence),
      // The structured form of the same dispute, for when the endpoint takes it.
      reasonCode: input.reason,
      note: input.note?.trim() || null,
      evidence: input.evidence,
    });
    revalidateBuyer();
    return { ok: true };
  } catch (err) {
    return failure(err, 'Could not file this dispute.');
  }
}

export interface TargetPatch {
  status?: 'ACTIVE' | 'INACTIVE';
  maxCap?: number;
  maxConcurrency?: number;
  acceptedStates?: string[];
}

export async function updateTarget(
  buyerId: string,
  targetId: string,
  patch: TargetPatch
): Promise<ActionResult> {
  const auth = await authed();
  if (!auth.token) return { ok: false, error: auth.error };

  try {
    await apiPatch(`/api/v1/buyers/${buyerId}/targets/${targetId}`, auth.token, patch);
    revalidatePath('/buyer/targeting');
    revalidatePath('/buyer/dashboard');
    return { ok: true };
  } catch (err) {
    return failure(err, 'Could not update this target.');
  }
}
