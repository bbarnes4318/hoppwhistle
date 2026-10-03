/**
 * How a prospect's stage moves when one of its agreements changes state.
 *
 * ── Forward only, and never out of a decision ────────────────────────────────
 *
 * An agreement event can move a prospect FORWARD along the pipeline, up to
 * AGREEMENT_SIGNED. It never moves one backwards, and it never touches a
 * prospect somebody has already marked WON or LOST: a late "viewed" on an old
 * envelope must not reopen a deal that is closed. Nor does a signature mark a
 * prospect WON -- "signed" and "won" are different business facts, and WON is
 * a person's explicit act.
 *
 * VOIDED, EXPIRED and CHANGES_REQUESTED change no stage. They are recorded on
 * the timeline, visibly, and the people working the deal decide what it means.
 */

import type { SalesActivityType, SalesProspectStage } from '@prisma/client';

export type AgreementLifecycleEvent =
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'COMPLETED'
  | 'VOIDED'
  | 'EXPIRED'
  | 'CHANGES_REQUESTED';

/** Pipeline order. WON and LOST are terminal and outside it. */
export const STAGE_ORDER: SalesProspectStage[] = [
  'NEW',
  'ATTEMPTING_CONTACT',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'AGREEMENT_SENT',
  'AGREEMENT_REVIEW',
  'AGREEMENT_SIGNED',
];

export const TERMINAL_STAGES: SalesProspectStage[] = ['WON', 'LOST'];

/** Open = still being worked. */
export function isOpenStage(stage: SalesProspectStage): boolean {
  return !TERMINAL_STAGES.includes(stage);
}

const TARGET: Partial<Record<AgreementLifecycleEvent, SalesProspectStage>> = {
  SENT: 'AGREEMENT_SENT',
  VIEWED: 'AGREEMENT_REVIEW',
  SIGNED: 'AGREEMENT_SIGNED',
  COMPLETED: 'AGREEMENT_SIGNED',
};

export const ACTIVITY_FOR_EVENT: Record<AgreementLifecycleEvent, SalesActivityType> = {
  SENT: 'AGREEMENT_SENT',
  VIEWED: 'AGREEMENT_VIEWED',
  SIGNED: 'AGREEMENT_SIGNED',
  COMPLETED: 'AGREEMENT_COMPLETED',
  VOIDED: 'AGREEMENT_VOIDED',
  EXPIRED: 'AGREEMENT_EXPIRED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
};

/** The stage after this event, or null when the stage does not change. */
export function nextStageForAgreementEvent(
  current: SalesProspectStage,
  event: AgreementLifecycleEvent
): SalesProspectStage | null {
  if (TERMINAL_STAGES.includes(current)) return null;
  const target = TARGET[event];
  if (!target) return null;
  return STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(current) ? target : null;
}
