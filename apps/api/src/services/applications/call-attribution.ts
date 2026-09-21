/**
 * Tying an application to the call that produced it.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * The closing percentage prices every agency. Its two sides were CORRELATED BY
 * AGENT AND DAY rather than joined: delivered calls counted through
 * `Call.answeredByUserId`, submitted applications through `createdById`. That
 * answers "this agent took 40 calls and wrote 4 applications" and cannot answer
 * "which call became this application", so an agency disputing the number that
 * sets its price had nothing to drill into.
 *
 * `InsuranceCarrierApplication.callId` existed and was barely used:
 *
 *   * OPTIONAL, so the agent's form almost never sent it and the column was
 *     almost always null; and
 *   * verified only against the TENANT. `routes/applications.ts` checked that
 *     the call belonged to the agency -- correctly, and that check is the
 *     reason another agency's call could never reach the column -- but not that
 *     it belonged to the submitting AGENT. So an agent could attribute their
 *     application to a colleague's call, and the per-agent closing percentages
 *     a principal decides coaching and pay from would describe the wrong
 *     people.
 *
 * ── What this does ───────────────────────────────────────────────────────────
 *
 * Resolves the call server-side, on evidence, and says which evidence:
 *
 *   CLIENT    the agent's form named a call, AND that call is this agency's and
 *             was answered by this agent. The tenant half is what the route
 *             already did; the agent half is new. Failing either is not
 *             downgraded quietly -- it is refused, because a client naming
 *             somebody else's call is a bug, not a hint.
 *
 *   INFERRED  no call was named, so the agent's own most recent answered call
 *             within a window is used.
 *
 *   NONE      nothing matched. Business written from a callback, from paper, or
 *             hours later legitimately lands here.
 *
 * ── Why INFERRED is a separate value and not just "callId is set" ────────────
 *
 * Because it can be wrong in a specific, knowable way: an agent who hangs up,
 * takes a second call and then writes the FIRST caller's business is matched to
 * the second. That is a rare shape and the match is still worth having, but a
 * dispute over a price needs to know which rows are a claim the agent made and
 * which are one the server inferred. Storing them as the same fact would hide
 * exactly the thing somebody is disputing.
 */

import type { CallAttribution, PrismaClient } from '@prisma/client';

import { logger } from '../../lib/logger.js';

/**
 * How far back an agent's last answered call still counts as "the call they
 * were on".
 *
 * Long enough to cover writing an application after the caller hangs up --
 * agents routinely finish the form in the minutes after the call ends. Short
 * enough that a form opened an hour later does not attach itself to a call the
 * agent has long since forgotten.
 *
 * It is deliberately generous in the direction of a MISS rather than a wrong
 * match: `NONE` is an honest absence, and a wrong `callId` is a number that
 * looks like evidence and is not.
 */
const INFERENCE_WINDOW_MS = Math.max(
  60_000,
  parseInt(process.env.APPLICATION_CALL_INFERENCE_WINDOW_MS || '', 10) || 30 * 60 * 1000
);

export interface AttributionResult {
  callId: string | null;
  attribution: CallAttribution;
}

/** Raised when a client named a call that is not this agent's to name. */
export class UnknownCallError extends Error {
  constructor(callId: string) {
    super(
      `Call ${callId} is not a call this agent answered in this agency. An application ` +
        'can only be attributed to a call the submitting agent took.'
    );
    this.name = 'UnknownCallError';
  }
}

/**
 * Which call this application belongs to.
 *
 * @param prisma      The client to read through.
 * @param tenantId    The acting agency, from the authenticated principal.
 * @param agentId     The submitting agent, from the authenticated principal.
 * @param claimedCallId  What the client sent, if anything.
 * @param at          When the application was submitted.
 */
export async function attributeCall(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  claimedCallId: string | null | undefined,
  at: Date = new Date()
): Promise<AttributionResult> {
  /*
   * A named call is verified, never trusted.
   *
   * Both halves matter and neither is redundant. `tenantId` stops one agency
   * attributing production to another agency's call -- the check the route
   * already made, moved here so there is one place that decides this rather
   * than two that can drift. `answeredByUserId` is the half that was missing:
   * it stops an agent inside an agency attributing their application to a
   * COLLEAGUE's call, which would make the per-agent closing percentages a
   * principal decides coaching and pay from describe the wrong people.
   */
  if (claimedCallId) {
    const call = await prisma.call.findFirst({
      where: { id: claimedCallId, tenantId, answeredByUserId: agentId },
      select: { id: true },
    });

    if (!call) {
      /*
       * Refused, not downgraded to INFERRED.
       *
       * A client naming a call that is not the agent's is a bug in the client
       * or an attempt to move production between agents. Quietly substituting
       * a different call would write a plausible-looking row for something
       * nobody asked for, and the caller would never learn their link was
       * wrong.
       */
      logger.warn({
        msg: 'Application named a call that is not this agents; refusing to attribute it',
        tenantId,
        agentId,
        claimedCallId,
      });
      throw new UnknownCallError(claimedCallId);
    }

    return { callId: call.id, attribution: 'CLIENT' };
  }

  /*
   * Nothing named: the agent's own most recent answered call inside the window.
   *
   * Scoped by `answeredByUserId` on purpose -- an agent's call, not the
   * agency's most recent. Ordered by `answeredAt` descending, which the
   * `(tenantId, answeredByUserId, answeredAt)` index already serves, so this
   * costs one indexed lookup on a path that runs once per application.
   */
  try {
    const recent = await prisma.call.findFirst({
      where: {
        tenantId,
        answeredByUserId: agentId,
        answeredAt: { gte: new Date(at.getTime() - INFERENCE_WINDOW_MS), lte: at },
      },
      orderBy: { answeredAt: 'desc' },
      select: { id: true },
    });

    if (recent) return { callId: recent.id, attribution: 'INFERRED' };
  } catch (error) {
    /*
     * An application must never fail because the inference failed. The row is
     * what the agency is measured on; the link is a convenience for reading it
     * afterwards. NONE is the honest answer when we could not look.
     */
    logger.error({
      msg: 'Could not infer the call for an application; recording it without one',
      tenantId,
      agentId,
      err: error,
    });
  }

  return { callId: null, attribution: 'NONE' };
}
