'use server';

import { revalidatePath } from 'next/cache';

import { apiPatch, apiPost } from '@/lib/server/api';

import { composeDisputeReason, isDisputeReason, type DisputeInput } from './_lib/dispute';
import { MISSING_TOKEN_MESSAGE, normalizeToken } from './_lib/token';

/**
 * Every write the buyer makes.
 *
 * These are server actions rather than client fetches so the mutation and the
 * re-read are one round trip: the action writes, revalidatePath drops the
 * server render, and the page comes back with the new state already in the
 * markup — no client cache to reconcile and no refetch effect to fire.
 *
 * NONE OF THEM READ THE SESSION COOKIE. The token arrives as an argument the
 * caller supplies, so a cross-site POST that carries the user's cookie has
 * nothing to authenticate with. Reads still resolve the cookie — a GET changes
 * nothing — but no write does. See ./_lib/token for why this is an argument
 * rather than a trusted header check.
 *
 * Token first, matching the fetchers in src/lib/server/buyer.ts.
 *
 * A 'use server' module may only export async functions, so the dispute
 * vocabulary the form renders from lives in ./_lib/dispute.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
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
export async function acceptCall(token: string, callId: string): Promise<ActionResult> {
  const bearer = normalizeToken(token);
  if (!bearer) return { ok: false, error: MISSING_TOKEN_MESSAGE };

  try {
    await apiPost(`/api/v1/calls/${callId}/disposition`, bearer, { disposition: 'VERIFIED' });
    revalidateBuyer();
    return { ok: true };
  } catch (err) {
    return failure(err, 'Could not accept this call.');
  }
}

export async function disputeCall(token: string, input: DisputeInput): Promise<ActionResult> {
  const bearer = normalizeToken(token);
  if (!bearer) return { ok: false, error: MISSING_TOKEN_MESSAGE };

  if (!isDisputeReason(input.reason)) {
    return { ok: false, error: 'Pick a reason for the dispute.' };
  }

  try {
    await apiPost(`/api/v1/calls/${input.callId}/dispute`, bearer, {
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
  token: string,
  buyerId: string,
  targetId: string,
  patch: TargetPatch
): Promise<ActionResult> {
  const bearer = normalizeToken(token);
  if (!bearer) return { ok: false, error: MISSING_TOKEN_MESSAGE };

  try {
    await apiPatch(`/api/v1/buyers/${buyerId}/targets/${targetId}`, bearer, patch);
    revalidatePath('/buyer/targeting');
    revalidatePath('/buyer/dashboard');
    return { ok: true };
  } catch (err) {
    return failure(err, 'Could not update this target.');
  }
}
