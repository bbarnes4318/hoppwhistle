/**
 * Softphone dispositions that arrive before their call's CDR.
 *
 * An inbound softphone call's `calls` row is written by the FreeSWITCH CDR
 * after hangup, keyed `fs-<uuid>`. The softphone knows that key from the
 * `X-Call-Id` header on the INVITE, and sends it with the disposition -- which
 * the agent can save before the CDR lands. `POST /api/v1/calls/disposition`
 * used to create a call row for it then, which gave the one call two INBOUND
 * rows: one from the disposition, credited to the agent, and one from the CDR.
 *
 * Now the disposition waits in `pending_call_dispositions`, and the CDR
 * handler merges it into the row it creates.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { recordAgentApplication } from './applications/agent-entry.js';
import type { ApplicationInput } from './applications/input-schema.js';

/** The callSid a softphone call carries, from the INVITE's `X-Call-Id`. */
export function isSoftphoneCallSid(callSid: string | null | undefined): callSid is string {
  return typeof callSid === 'string' && /^fs-[0-9a-f-]{8,}$/i.test(callSid);
}

export interface PendingDispositionInput {
  tenantId: string;
  callSid: string;
  userId: string | null;
  disposition: string;
  notes: string | null;
  callSource: string | null;
  followUpAt: Date | null;
  duration: number | null;
  application: ApplicationInput | null;
}

type PendingClient = Pick<PrismaClient, 'pendingCallDisposition'>;

export async function savePendingDisposition(
  prisma: PendingClient,
  input: PendingDispositionInput
) {
  const data = {
    userId: input.userId,
    disposition: input.disposition,
    notes: input.notes,
    callSource: input.callSource,
    followUpAt: input.followUpAt,
    duration: input.duration,
    application: (input.application ?? undefined) as Prisma.InputJsonValue | undefined,
  };
  return prisma.pendingCallDisposition.upsert({
    where: { tenantId_callSid: { tenantId: input.tenantId, callSid: input.callSid } },
    create: { tenantId: input.tenantId, callSid: input.callSid, ...data },
    update: data,
  });
}

type MergeClient = Pick<PrismaClient, 'pendingCallDisposition' | 'call'>;

/**
 * Apply a waiting disposition to the call the CDR just created.
 *
 * The application, when there is one, is recorded first, exactly as the
 * disposition endpoint does: the label must not exist without the sale. If it
 * is refused the pending row is kept, so nothing is lost and nothing is
 * mislabelled.
 */
export async function mergePendingDisposition(
  prisma: MergeClient,
  input: { tenantId: string; callSid: string; callId: string },
  recordApplication: typeof recordAgentApplication = recordAgentApplication
): Promise<'merged' | 'none' | 'application_refused'> {
  const pending = await prisma.pendingCallDisposition.findUnique({
    where: { tenantId_callSid: { tenantId: input.tenantId, callSid: input.callSid } },
  });
  if (!pending) return 'none';

  const application = pending.application as ApplicationInput | null;
  if (application && pending.userId) {
    try {
      await recordApplication({
        tenantId: input.tenantId,
        createdById: pending.userId,
        clientRequestId: application.clientRequestId,
        callId: input.callId,
        insuranceLeadId: application.insuranceLeadId ?? null,
        carrier: application.carrier,
        product: application.product ?? null,
        planType: application.planType ?? null,
        faceAmount: application.faceAmount,
        modalPremium: application.modalPremium,
        paymentMode: application.paymentMode,
        carrierApplicationNumber: application.carrierApplicationNumber ?? null,
        firstName: application.firstName,
        lastName: application.lastName,
        dob: application.dob ?? null,
        state: application.state ?? null,
        phone: application.phone ?? null,
      });
    } catch (err) {
      console.error(
        `[PENDING-DISPOSITION] Application for ${input.callSid} was refused at merge; disposition kept pending:`,
        err
      );
      return 'application_refused';
    }
  }

  const call = await prisma.call.findUnique({
    where: { id: input.callId },
    select: { answeredByUserId: true },
  });

  await prisma.call.update({
    where: { id: input.callId },
    data: {
      disposition: pending.disposition,
      dispositionNotes: pending.notes,
      ...(pending.callSource ? { callSource: pending.callSource } : {}),
      ...(pending.followUpAt ? { followUpAt: pending.followUpAt, followUpStatus: 'PENDING' } : {}),
      // Only when the CDR could not name who answered: a fact from the
      // answered leg outranks the agent who wrote the call up.
      ...(call && call.answeredByUserId === null && pending.userId
        ? { answeredByUserId: pending.userId }
        : {}),
    },
  });

  await prisma.pendingCallDisposition.delete({ where: { id: pending.id } });
  return 'merged';
}
