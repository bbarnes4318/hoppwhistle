/**
 * Agreement lifecycle → Sales CRM prospect.
 *
 * When an envelope sent from the Sales CRM changes state, its prospect gets a
 * timeline entry and, where `stage-policy.ts` allows, a stage change. Both are
 * written ONLY from what actually happened to the envelope: the event is read
 * back from the envelope's own row, never assumed.
 *
 * ── Never in the agreement's way ─────────────────────────────────────────────
 *
 * The agreement's evidence is committed before this runs, in its own
 * transaction, and nothing here can fail it: every error is logged and
 * swallowed. Each entry carries a `sourceKey` (`agreement:<envelope>:<event>`),
 * unique in the database, so a retried or repeated call writes it once.
 * `reconcileProspectAgreements` replays the same from the envelopes' current
 * state, so an entry a crash missed is filled in the next time the prospect is
 * opened.
 */

import type { AgreementEnvelope, Prisma, PrismaClient } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { onAgreementLifecycle } from '../agreements/envelopes.js';
import { agencyLabel } from '../agreements/party.js';

import {
  ACTIVITY_FOR_EVENT,
  nextStageForAgreementEvent,
  type AgreementLifecycleEvent,
} from './stage-policy.js';

const DESCRIPTIONS: Record<AgreementLifecycleEvent, (ref: string) => string> = {
  SENT: ref => `Agreement ${ref} sent for signature.`,
  VIEWED: ref => `Agreement ${ref} opened by the signer.`,
  SIGNED: ref => `Agreement ${ref} signed by the agency.`,
  COMPLETED: ref => `Agreement ${ref} fully executed; executed copies delivered.`,
  VOIDED: ref => `Agreement ${ref} voided.`,
  EXPIRED: ref => `Agreement ${ref} expired without a signature.`,
  CHANGES_REQUESTED: ref => `Changes requested on agreement ${ref}.`,
};

function occurredAtOf(envelope: AgreementEnvelope, event: AgreementLifecycleEvent): Date {
  switch (event) {
    case 'SENT':
      return envelope.sentAt;
    case 'VIEWED':
      return envelope.viewedAt ?? new Date();
    case 'SIGNED':
      return envelope.signedAt ?? new Date();
    case 'COMPLETED':
      return envelope.completedAt ?? new Date();
    case 'VOIDED':
      return envelope.voidedAt ?? new Date();
    case 'CHANGES_REQUESTED':
      return envelope.changesRequestedAt ?? new Date();
    default:
      return new Date();
  }
}

/** Whether the envelope's current row shows this event happened. */
function happened(envelope: AgreementEnvelope, event: AgreementLifecycleEvent): boolean {
  switch (event) {
    case 'SENT':
      return true;
    case 'VIEWED':
      return envelope.viewedAt !== null;
    case 'SIGNED':
      return envelope.signedAt !== null;
    case 'COMPLETED':
      return envelope.status === 'COMPLETED';
    case 'VOIDED':
      return envelope.status === 'VOIDED';
    case 'EXPIRED':
      return envelope.status === 'EXPIRED';
    case 'CHANGES_REQUESTED':
      return envelope.status === 'CHANGES_REQUESTED';
  }
}

/** Record one lifecycle event on the envelope's prospect. Idempotent. */
export async function syncAgreementToProspect(
  prisma: PrismaClient,
  envelopeId: string,
  event: AgreementLifecycleEvent
): Promise<void> {
  const envelope = await prisma.agreementEnvelope.findUnique({ where: { id: envelopeId } });
  if (!envelope?.salesProspectId || !happened(envelope, event)) return;
  const sourceKey = `agreement:${envelope.id}:${event}`;
  await prisma.$transaction(async tx => {
    // The prospect is read inside the issuing workspace: a prospect of another
    // workspace is never written, whatever the row says (a trigger also
    // refuses such a link).
    const prospect = await tx.salesProspect.findFirst({
      where: { id: envelope.salesProspectId!, workspaceId: envelope.salesWorkspaceId },
    });
    if (!prospect) return;
    const exists = await tx.salesProspectActivity.findUnique({ where: { sourceKey } });
    if (exists) return;
    const occurredAt = occurredAtOf(envelope, event);
    await tx.salesProspectActivity.create({
      data: {
        workspaceId: prospect.workspaceId,
        prospectId: prospect.id,
        type: ACTIVITY_FOR_EVENT[event],
        body: DESCRIPTIONS[event](envelope.reference),
        detail: {
          reference: envelope.reference,
          envelopeStatus: envelope.status,
          agency: agencyLabel(envelope),
          ...(event === 'VOIDED' && envelope.voidReason ? { reason: envelope.voidReason } : {}),
          ...(event === 'CHANGES_REQUESTED' && envelope.changesNote
            ? { note: envelope.changesNote }
            : {}),
        } as Prisma.InputJsonValue,
        agreementEnvelopeId: envelope.id,
        sourceKey,
        occurredAt,
      },
    });
    const next = nextStageForAgreementEvent(prospect.stage, event);
    if (next) {
      await tx.salesProspect.update({ where: { id: prospect.id }, data: { stage: next } });
      await tx.salesProspectActivity.create({
        data: {
          workspaceId: prospect.workspaceId,
          prospectId: prospect.id,
          type: 'STAGE_CHANGE',
          body: `Stage moved from ${prospect.stage} to ${next} by agreement ${envelope.reference}.`,
          detail: {
            from: prospect.stage,
            to: next,
            automatic: true,
            reference: envelope.reference,
          },
          agreementEnvelopeId: envelope.id,
          sourceKey: `${sourceKey}:stage`,
          occurredAt,
        },
      });
    }
  });
}

/** Best-effort wrapper the agreement engine calls. */
async function hook(
  prisma: PrismaClient,
  envelopeId: string,
  event: AgreementLifecycleEvent
): Promise<void> {
  try {
    await syncAgreementToProspect(prisma, envelopeId, event);
  } catch (error) {
    // A unique-key race on sourceKey means another request wrote it: fine.
    if ((error as { code?: string }).code === 'P2002') return;
    logger.error({
      msg: 'Sales CRM: could not record an agreement event on its prospect',
      envelopeId,
      event,
      err: error,
    });
  }
}

/** Register the hook. Called once when the sales routes are registered. */
export function installAgreementSync(): void {
  onAgreementLifecycle(hook);
}

const REPLAY_ORDER: AgreementLifecycleEvent[] = [
  'SENT',
  'VIEWED',
  'SIGNED',
  'COMPLETED',
  'CHANGES_REQUESTED',
  'VOIDED',
  'EXPIRED',
];

/** Fill in any entry a failed sync missed, from the envelopes' current state. */
export async function reconcileProspectAgreements(
  prisma: PrismaClient,
  workspaceId: string,
  prospectId: string
): Promise<void> {
  const envelopes = await prisma.agreementEnvelope.findMany({
    where: { salesWorkspaceId: workspaceId, salesProspectId: prospectId },
    orderBy: { sentAt: 'asc' },
  });
  for (const envelope of envelopes) {
    for (const event of REPLAY_ORDER) {
      if (happened(envelope, event)) await hook(prisma, envelope.id, event);
    }
  }
}
