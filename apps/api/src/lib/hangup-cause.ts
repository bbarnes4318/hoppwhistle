import type { CallTerminationParty } from '@prisma/client';

/**
 * Who ended a call, derived from what FreeSWITCH tells us when it ends.
 *
 * This exists for one number: abandon rate, the share of offered calls where
 * the caller gave up before anyone answered. Nothing in the schema recorded
 * that before — `status` says the call did not complete, but a busy signal, a
 * ring-timeout and a caller hanging up after four seconds all land in that
 * bucket, and only the last is an abandon. Deriving abandon rate as
 * `1 - answerRate` counts all three, which is why it was never sourced.
 *
 * The mapping is over the hangup cause on the INBOUND leg — the caller's own
 * SIP session, which is what the Lua script reports on the CDR webhook. Causes
 * are Q.850 names as FreeSWITCH spells them in `hangup_cause`.
 */

/**
 * Causes that name the party outright. Anything absent from this table falls
 * through to UNKNOWN rather than being guessed at: a wrong party is worse than
 * an admitted gap, because the gap is visible in the metric and the wrong
 * answer is not.
 *
 * The CALLEE / SYSTEM split is best-effort and does not affect abandon rate,
 * which only reads CALLER. It is recorded because "the buyer rejected it" and
 * "our carrier could not reach anyone" are different operational problems.
 */
const CAUSE_TO_PARTY: Readonly<Record<string, CallTerminationParty>> = {
  // The caller hung up while we were still trying to connect them. This is the
  // abandon: combined with answeredAt IS NULL it is the whole numerator.
  ORIGINATOR_CANCEL: 'CALLER',

  // The far end refused, was busy, or never picked up.
  USER_BUSY: 'CALLEE',
  NO_ANSWER: 'CALLEE',
  NO_USER_RESPONSE: 'CALLEE',
  CALL_REJECTED: 'CALLEE',
  UNALLOCATED_NUMBER: 'CALLEE',
  NUMBER_CHANGED: 'CALLEE',
  SUBSCRIBER_ABSENT: 'CALLEE',
  INCOMPATIBLE_DESTINATION: 'CALLEE',

  // Nobody chose to end it — the network, a timer, or an operator did.
  NORMAL_TEMPORARY_FAILURE: 'SYSTEM',
  NETWORK_OUT_OF_ORDER: 'SYSTEM',
  SERVICE_UNAVAILABLE: 'SYSTEM',
  DESTINATION_OUT_OF_ORDER: 'SYSTEM',
  RECOVERY_ON_TIMER_EXPIRE: 'SYSTEM',
  MEDIA_TIMEOUT: 'SYSTEM',
  PROGRESS_TIMEOUT: 'SYSTEM',
  EXCHANGE_ROUTING_ERROR: 'SYSTEM',
  MANAGER_REQUEST: 'SYSTEM',
  SYSTEM_SHUTDOWN: 'SYSTEM',
  BLIND_TRANSFER: 'SYSTEM',
  ATTENDED_TRANSFER: 'SYSTEM',
};

/**
 * Causes that mean "the call ended cleanly" and say nothing about who did it.
 * A bridged call where the buyer hangs up and one where the caller hangs up
 * both report NORMAL_CLEARING on the inbound leg. Only `sip_hangup_disposition`
 * separates them.
 */
const AMBIGUOUS_CAUSES: ReadonlySet<string> = new Set(['NORMAL_CLEARING', 'NORMAL_UNSPECIFIED']);

/**
 * `sip_hangup_disposition` is written from OUR point of view on the leg. On the
 * inbound leg we are the caller's peer, so `recv_*` means the caller acted and
 * `send_*` means we did — and we send BYE to the caller when the buyer's leg
 * goes away, which is what makes send_bye a CALLEE hangup rather than a SYSTEM
 * one.
 *
 * The exception is our own fallback hangup in inbound_route.lua, which also
 * produces send_bye. It sets the cause to NO_USER_RESPONSE, which is matched by
 * CAUSE_TO_PARTY above and never reaches this table.
 */
const DISPOSITION_TO_PARTY: Readonly<Record<string, CallTerminationParty>> = {
  recv_bye: 'CALLER',
  recv_cancel: 'CALLER',
  recv_refuse: 'CALLER',
  send_bye: 'CALLEE',
  send_cancel: 'SYSTEM',
  send_refuse: 'SYSTEM',
};

/**
 * Derives the termination party for the inbound leg.
 *
 * @param hangupCause FreeSWITCH `hangup_cause`, e.g. "ORIGINATOR_CANCEL".
 * @param sipHangupDisposition FreeSWITCH `sip_hangup_disposition`, e.g.
 *   "recv_bye". Optional: FreeSWITCH deployments that have not picked up the
 *   Lua change yet do not send it, and every ambiguous cause from those simply
 *   records UNKNOWN.
 * @returns Never null. An unrecognised or missing cause is UNKNOWN, which is a
 *   recorded fact ("we saw this call end and could not attribute it"), distinct
 *   from the NULL column on rows written before this field existed.
 */
export function deriveTerminationParty(
  hangupCause: string | null | undefined,
  sipHangupDisposition?: string | null
): CallTerminationParty {
  const cause = (hangupCause ?? '').trim().toUpperCase();
  if (!cause) return 'UNKNOWN';

  if (AMBIGUOUS_CAUSES.has(cause)) {
    const disposition = (sipHangupDisposition ?? '').trim().toLowerCase();
    return DISPOSITION_TO_PARTY[disposition] ?? 'UNKNOWN';
  }

  return CAUSE_TO_PARTY[cause] ?? 'UNKNOWN';
}

/**
 * The verbatim cause, normalised only for whitespace and case so that
 * `GROUP BY "terminationCause"` does not split NORMAL_CLEARING from
 * normal_clearing. Null when FreeSWITCH sent nothing — we store what we were
 * told or nothing, never a placeholder that later reads as a real cause.
 */
export function normalizeHangupCause(hangupCause: string | null | undefined): string | null {
  const cause = (hangupCause ?? '').trim().toUpperCase();
  return cause === '' ? null : cause;
}
