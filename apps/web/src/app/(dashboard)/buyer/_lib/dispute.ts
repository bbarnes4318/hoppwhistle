/**
 * The dispute vocabulary, shared by the form and the server action.
 *
 * Kept out of actions.ts because a 'use server' module may only export async
 * functions — everything a client component needs to *render* a dispute lives
 * here, and only the write itself is an action.
 */

export const DISPUTE_REASONS = [
  { value: 'UNDER_THRESHOLD', label: 'Did not reach the billable threshold' },
  { value: 'WRONG_NUMBER', label: 'Wrong number or not a real prospect' },
  { value: 'DUPLICATE', label: 'Duplicate of a call I was already charged for' },
  { value: 'OUT_OF_TARGETING', label: 'Outside the targeting I set' },
  { value: 'NO_CONSENT', label: 'No consent on record' },
  { value: 'WRONG_AMOUNT', label: 'Charged the wrong amount' },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number]['value'];

export function isDisputeReason(value: string): value is DisputeReason {
  return DISPUTE_REASONS.some(r => r.value === value);
}

export interface DisputeEvidence {
  /** Connected seconds as measured, and the threshold they are judged against. */
  connectedSeconds: number | null;
  thresholdSeconds: number | null;
  billable: boolean;
  billableReason?: string | null;
  amount?: number | null;
  recordingUrl?: string | null;
  callCreatedAt?: string | null;
}

export interface DisputeInput {
  callId: string;
  reason: DisputeReason;
  note?: string;
  evidence: DisputeEvidence;
}

function formatSeconds(total: number | null | undefined): string {
  if (total === null || total === undefined) return 'unknown';
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Render the evidence into the reason text.
 *
 * The dispute endpoint stores one reason string. Composing the recording link
 * and the duration-against-threshold measurement into it is what makes the
 * evidence travel with the dispute today, rather than living only in a screen
 * the person reviewing it will never open. The same facts also go up as
 * structured fields, which the endpoint currently ignores and can adopt without
 * a change on this side.
 */
export function composeDisputeReason(
  reason: DisputeReason,
  note: string | undefined,
  evidence: DisputeEvidence
): string {
  const label = DISPUTE_REASONS.find(r => r.value === reason)?.label ?? reason;

  const measurement =
    evidence.thresholdSeconds != null
      ? `connected ${formatSeconds(evidence.connectedSeconds)} against a ${evidence.thresholdSeconds}s threshold`
      : `connected ${formatSeconds(evidence.connectedSeconds)}, no threshold configured`;

  const facts = [
    measurement,
    `marked ${evidence.billable ? 'billable' : 'not billable'}`,
    evidence.billableReason ? `reason on file: ${evidence.billableReason}` : null,
    evidence.amount != null ? `charged $${evidence.amount.toFixed(2)}` : null,
    evidence.recordingUrl ? `recording: ${evidence.recordingUrl}` : 'recording: none attached',
  ].filter(Boolean);

  const lines = [`[${reason}] ${label}`];
  if (note && note.trim()) lines.push(`Note: ${note.trim()}`);
  lines.push(`Evidence — ${facts.join('; ')}.`);
  return lines.join('\n');
}
