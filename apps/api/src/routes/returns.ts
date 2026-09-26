/**
 * Returns: a buyer asking for a call back, and the agency deciding.
 *
 *   GET  /api/v1/returns?status=OPEN|ACCEPTED|DENIED&from=&to=&page=
 *   GET  /api/v1/returns?callId=<id>          one call's return, any status
 *   POST /api/v1/returns/:callId/decision   { decision: 'ACCEPT'|'DENY', note? }
 *
 * ── What a return is ─────────────────────────────────────────────────────────
 *
 * A call whose buyer disputed it (`POST /api/v1/calls/:callId/dispute` writes
 * `disputeStatus = 'DISPUTED'` and the reason on `metadata`). Until somebody
 * decides, it is OPEN: its revenue is counted as disputed and its publisher
 * payout is held. The decision closes it one of two ways, on the call itself:
 *
 *   ACCEPT   the call is given back. Revenue goes to zero, and so does the
 *            publisher's payout. When the publisher was already PAID for it,
 *            the payout becomes a CLAWBACK row in publisher_payments (a
 *            negative amount) that comes out of that publisher's next payment,
 *            and the call reads CLAWED_BACK. A prepaid
 *            (UPFRONT) buyer whose wallet was charged gets the ORIGINAL amount
 *            back through `buyerBillingService.addCredits`; anybody else's
 *            charge is waived.
 *   DENY     the call stands and counts as an ordinary call. A payout held
 *            for the dispute is payable again.
 *
 * `lib/dispute-status.ts` is why only 'DISPUTED' reads as open everywhere
 * else: every report, payout and sales figure asks `isOpenDispute`.
 *
 * ── Who, and whose ───────────────────────────────────────────────────────────
 *
 * A white-label OWNER or ADMIN, or a platform admin acting inside an agency
 * (`requireWhiteLabelOperator`). Every read and write is scoped to the acting
 * tenant from `resolveTenant`; another agency's call is a 404, the same as one
 * that does not exist.
 *
 * ── Deciding twice ───────────────────────────────────────────────────────────
 *
 * The decision is one interactive transaction, and its first write is an
 * update CONDITIONAL on the call still being 'DISPUTED'. Two operators
 * deciding the same return at once: the second blocks on the row until the
 * first commits, then matches nothing and is refused 409 -- before it has
 * credited a wallet or written anything else.
 */

import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import {
  ACCEPTED_DISPUTE,
  DENIED_DISPUTE,
  OPEN_DISPUTE,
  isOpenDispute,
} from '../lib/dispute-status.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import { buyerBillingService } from '../services/buyer-billing-service.js';
import { calendarDayBounds } from '../services/rating/calendar-day.js';

export const RETURNS_PAGE_SIZE = 50;
export const DECISION_NOTE_MAX_LENGTH = 500;

export type ReturnStatus = 'OPEN' | 'ACCEPTED' | 'DENIED';
export type ReturnDecision = 'ACCEPT' | 'DENY';

/** The screen's status names, to the value stored on `Call.disputeStatus`. */
const STORED_STATUS: Record<ReturnStatus, string> = {
  OPEN: OPEN_DISPUTE,
  ACCEPTED: ACCEPTED_DISPUTE,
  DENIED: DENIED_DISPUTE,
};

function isReturnStatus(value: unknown): value is ReturnStatus {
  return value === 'OPEN' || value === 'ACCEPTED' || value === 'DENIED';
}

/** Raised inside the decision transaction to roll it back with a 409. */
class AlreadyDecidedError extends Error {}

/** Money as dollars to the cent, the way payouts.ts shapes it. Null stays null. */
function money(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value.toFixed(2));
}

/** The columns a return row is built from. */
const RETURN_SELECT = {
  id: true,
  tenantId: true,
  createdAt: true,
  startedAt: true,
  disputeStatus: true,
  callerId: true,
  connectedDuration: true,
  buyerId: true,
  buyerName: true,
  publisherId: true,
  publisherName: true,
  campaignName: true,
  billable: true,
  cost: true,
  revenue: true,
  payout: true,
  profit: true,
  buyerBillableAmount: true,
  publisherPayoutAmount: true,
  publisherPayoutStatus: true,
  buyerChargeStatus: true,
  primaryRecordingId: true,
  metadata: true,
  buyer: { select: { id: true, name: true, billingType: true } },
  publisher: { select: { id: true, name: true } },
  campaign: { select: { name: true } },
  recordings: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.CallSelect;

type ReturnCall = Prisma.CallGetPayload<{ select: typeof RETURN_SELECT }>;

export interface ReturnRow {
  callId: string;
  startedAt: string | null;
  status: ReturnStatus;
  buyer: { id: string; name: string } | null;
  publisher: { id: string; name: string } | null;
  campaignName: string | null;
  callerId: string | null;
  connectedDuration: number | null;
  buyerBillableAmount: number | null;
  publisherPayoutAmount: number | null;
  publisherPayoutStatus: string | null;
  buyerChargeStatus: string | null;
  buyerBillingType: string | null;
  reason: string | null;
  disputedAt: string | null;
  disputedBy: string | null;
  recordingId: string | null;
  decision: {
    decision: ReturnDecision;
    decidedAt: string | null;
    decidedBy: string | null;
    note: string | null;
  } | null;
  /**
   * The deduction an accepted return made from a publisher who had already
   * been paid for the call: the CLAWBACK row, its (negative) amount, and the
   * payment it came out of -- null while it waits for the next one.
   */
  clawback: ReturnClawback | null;
}

// A type alias rather than an interface so it is assignable to Prisma's JSON
// input, where the audit row stores it.
export type ReturnClawback = {
  paymentId: string;
  amount: number;
  appliedToPaymentId: string | null;
};

/** The clawback rows a page of returns refers to, by id. */
export type ClawbackIndex = Map<string, ReturnClawback>;

/** The clawback row a call's metadata points at, or undefined when none. */
function clawbackIdOf(metadata: Prisma.JsonValue): string | undefined {
  const id = metadataOf(metadata).clawbackPaymentId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Load the clawback rows a set of calls point at, within one tenant. */
async function loadClawbacks(
  db: Pick<Prisma.TransactionClient, 'publisherPayment'>,
  tenantId: string,
  calls: Array<{ metadata: Prisma.JsonValue }>
): Promise<ClawbackIndex> {
  const ids = calls.map(c => clawbackIdOf(c.metadata)).filter((id): id is string => !!id);
  if (ids.length === 0) return new Map();
  const rows = await db.publisherPayment.findMany({
    where: { tenantId, id: { in: ids }, kind: 'CLAWBACK' },
    select: { id: true, amount: true, appliedToPaymentId: true },
  });
  return new Map(
    rows.map(r => [
      r.id,
      {
        paymentId: r.id,
        amount: Number(r.amount.toFixed(2)),
        appliedToPaymentId: r.appliedToPaymentId,
      },
    ])
  );
}

/** A call's metadata as an object, or an empty one when it is anything else. */
function metadataOf(metadata: Prisma.JsonValue): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function statusOf(disputeStatus: string | null): ReturnStatus {
  if (disputeStatus === ACCEPTED_DISPUTE) return 'ACCEPTED';
  if (disputeStatus === DENIED_DISPUTE) return 'DENIED';
  return 'OPEN';
}

/** A party on the call: the live row when there is one, else the call's snapshot. */
function partyOf(
  id: string | null,
  snapshotName: string | null,
  row: { id: string; name: string } | null
): { id: string; name: string } | null {
  if (row) return { id: row.id, name: row.name };
  if (id) return { id, name: snapshotName ?? 'Unknown' };
  return null;
}

export function returnRowOf(call: ReturnCall, clawbacks: ClawbackIndex = new Map()): ReturnRow {
  const meta = metadataOf(call.metadata);
  const decision = meta.disputeDecision;

  return {
    callId: call.id,
    /*
     * When the call happened. `startedAt` is null on rows no telephony leg
     * stamped (imports, some fixtures); the row's own creation is then the
     * best answer there is, rather than a blank date on a money screen.
     */
    startedAt: (call.startedAt ?? call.createdAt).toISOString(),
    status: statusOf(call.disputeStatus),
    buyer: partyOf(call.buyerId, call.buyerName, call.buyer),
    publisher: partyOf(call.publisherId, call.publisherName, call.publisher),
    campaignName: call.campaignName ?? call.campaign?.name ?? null,
    callerId: call.callerId,
    connectedDuration: call.connectedDuration,
    buyerBillableAmount: money(call.buyerBillableAmount),
    publisherPayoutAmount: money(call.publisherPayoutAmount),
    publisherPayoutStatus: call.publisherPayoutStatus,
    buyerChargeStatus: call.buyerChargeStatus,
    buyerBillingType: call.buyer?.billingType ?? null,
    reason: stringOrNull(meta.disputeReason),
    disputedAt: stringOrNull(meta.disputedAt),
    disputedBy: stringOrNull(meta.disputedBy),
    // The same id the Calls ledger's play button hands to
    // GET /api/v1/recordings/:id/url: the canonical row, else the newest.
    recordingId: call.primaryRecordingId ?? call.recordings[0]?.id ?? null,
    decision:
      decision === 'ACCEPT' || decision === 'DENY'
        ? {
            decision,
            decidedAt: stringOrNull(meta.decidedAt),
            decidedBy: stringOrNull(meta.decidedBy),
            note: stringOrNull(meta.decisionNote),
          }
        : null,
    clawback: clawbacks.get(clawbackIdOf(call.metadata) ?? '') ?? null,
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One end of the date filter as an instant, or `undefined` when absent.
 *
 * A bare `YYYY-MM-DD` is a calendar day on the platform clock (the one the
 * Leaderboard, Sales and Payouts count days on): `from` is its first instant
 * and `to` its last, so `to=2026-09-11` includes all of the 11th. A full ISO
 * timestamp is taken as the exact instant. Anything else is `null`, a 400.
 */
function dateBound(value: string | undefined, end: 'from' | 'to'): Date | null | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const text = value.trim();

  if (DAY_KEY.test(text)) {
    const probe = new Date(`${text}T12:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== text) return null;
    const bounds = calendarDayBounds(text);
    return end === 'from' ? bounds.start : new Date(bounds.endExclusive.getTime() - 1);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The money on a call before and after a decision, for the audit row. */
function moneySnapshot(call: {
  billable: boolean;
  revenue: Prisma.Decimal | null;
  payout: Prisma.Decimal | null;
  profit: Prisma.Decimal | null;
  buyerBillableAmount: Prisma.Decimal | null;
  publisherPayoutAmount: Prisma.Decimal | null;
  publisherPayoutStatus: string | null;
  buyerChargeStatus: string | null;
}) {
  const text = (value: Prisma.Decimal | null) => (value === null ? null : value.toFixed(4));
  return {
    billable: call.billable,
    revenue: text(call.revenue),
    payout: text(call.payout),
    profit: text(call.profit),
    buyerBillableAmount: text(call.buyerBillableAmount),
    publisherPayoutAmount: text(call.publisherPayoutAmount),
    publisherPayoutStatus: call.publisherPayoutStatus,
    buyerChargeStatus: call.buyerChargeStatus,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerReturnRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  fastify.get<{
    Querystring: { status?: string; from?: string; to?: string; page?: string; callId?: string };
  }>(
    '/api/v1/returns',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const parsedPage = parseInt(request.query.page ?? '1', 10);
      const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

      let where: Prisma.CallWhereInput;
      const callId = request.query.callId?.trim();

      if (callId) {
        /*
         * One call's return, whatever state it is in: the Calls page's call
         * detail asks this to draw its "Return requested" panel, and a decided
         * return is exactly what that panel has to show. The status and date
         * filters are ignored. Still the acting tenant's only, and a call that
         * was never disputed -- or is another agency's -- answers an empty
         * list, not a 404: "no return on this call" is an answer, not an error.
         */
        where = {
          tenantId,
          id: callId,
          disputeStatus: { in: Object.values(STORED_STATUS) },
        };
      } else {
        const status = request.query.status ?? 'OPEN';
        if (!isReturnStatus(status)) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'status must be one of: OPEN, ACCEPTED, DENIED',
            },
          });
        }

        const from = dateBound(request.query.from, 'from');
        const to = dateBound(request.query.to, 'to');
        if (from === null || to === null) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'from and to must be dates (YYYY-MM-DD) or ISO timestamps',
            },
          });
        }
        if (from && to && to < from) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'to must not be before from' },
          });
        }

        where = {
          tenantId,
          disputeStatus: STORED_STATUS[status],
          ...(from || to
            ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        };
      }

      /*
       * Newest first by the call. The moment of the dispute lives on
       * `metadata.disputedAt`, which Prisma cannot order by; the call's own
       * creation is the stable, indexed stand-in, with the id to break ties so
       * a page boundary never repeats or skips a row.
       */
      const [calls, total, openCount] = await Promise.all([
        prisma.call.findMany({
          where,
          select: RETURN_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: RETURNS_PAGE_SIZE,
          skip: (page - 1) * RETURNS_PAGE_SIZE,
        }),
        prisma.call.count({ where }),
        // Regardless of the filter: the tab label is "Returns (n)" on every tab.
        prisma.call.count({ where: { tenantId, disputeStatus: OPEN_DISPUTE } }),
      ]);

      const clawbacks = await loadClawbacks(prisma, tenantId, calls);

      return reply.send({
        data: calls.map(call => returnRowOf(call, clawbacks)),
        meta: {
          page,
          limit: RETURNS_PAGE_SIZE,
          total,
          totalPages: Math.ceil(total / RETURNS_PAGE_SIZE),
          openCount,
        },
      });
    }
  );

  fastify.post<{ Params: { callId: string }; Body: { decision?: unknown; note?: unknown } }>(
    '/api/v1/returns/:callId/decision',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const userId = getActingUserId(request);
      if (!userId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'A return is decided by a person, not a key.' },
        });
      }

      const body = request.body ?? {};
      const decision = body.decision;
      const problems: string[] = [];
      if (decision !== 'ACCEPT' && decision !== 'DENY') {
        problems.push("decision must be 'ACCEPT' or 'DENY'");
      }
      if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
        problems.push('note must be text');
      }
      const note = typeof body.note === 'string' ? body.note.trim() || null : null;
      if (note && note.length > DECISION_NOTE_MAX_LENGTH) {
        problems.push(`note must be at most ${DECISION_NOTE_MAX_LENGTH} characters`);
      }
      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }
      const chosen = decision as ReturnDecision;

      const { callId } = request.params;
      const existing = await prisma.call.findFirst({
        where: { id: callId, tenantId },
        select: { id: true, disputeStatus: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Call not found' } });
      }
      if (!isOpenDispute(existing.disputeStatus)) {
        return reply.code(409).send({
          error: { code: 'NOT_OPEN', message: 'This call has no open return to decide.' },
        });
      }

      // Recorded on the call as who decided, the same way the dispute records
      // who filed it: by email, which reads on the screen without a lookup.
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const decidedBy = actor?.email ?? null;

      try {
        await prisma.$transaction(async tx => {
          const call = await tx.call.findFirst({
            where: { id: callId, tenantId },
            select: {
              id: true,
              billable: true,
              cost: true,
              revenue: true,
              payout: true,
              profit: true,
              buyerId: true,
              publisherId: true,
              createdAt: true,
              buyerBillableAmount: true,
              publisherPayoutAmount: true,
              publisherPayoutStatus: true,
              buyerChargeStatus: true,
              metadata: true,
              buyer: { select: { id: true, billingType: true } },
            },
          });
          // Gone between the check above and here: nothing left to decide.
          if (!call) throw new AlreadyDecidedError();

          const decidedAt = new Date().toISOString();
          const metadata: Record<string, unknown> = {
            ...metadataOf(call.metadata),
            disputeDecision: chosen,
            decidedAt,
            decidedBy,
            decisionNote: note,
          };

          const data: Prisma.CallUpdateManyMutationInput = {};
          let refund: Prisma.Decimal | null = null;
          /** The payout to take back from an already-paid publisher, positive. */
          let clawback: { publisherId: string; amount: Prisma.Decimal } | null = null;

          if (chosen === 'ACCEPT') {
            const zero = new Prisma.Decimal(0);
            data.disputeStatus = ACCEPTED_DISPUTE;
            data.billable = false;
            data.buyerBillableAmount = zero;
            data.revenue = zero;

            let payout = call.payout ?? call.publisherPayoutAmount ?? zero;
            if (call.publisherPayoutStatus === 'PAYABLE' || call.publisherPayoutStatus === 'HELD') {
              data.publisherPayoutStatus = 'NOT_PAYABLE';
              data.publisherPayoutAmount = zero;
              data.payout = zero;
              payout = zero;
            } else if (call.publisherPayoutStatus === 'PAID') {
              /*
               * The publisher already has the money. It comes out of their next
               * payment: a CLAWBACK row is written below, once the conditional
               * update has proved this is the one decision. With no publisher
               * or nothing paid there is nothing to take back, and the payout
               * fields are left as they are.
               */
              const paid = (call.publisherPayoutAmount ?? zero).toDecimalPlaces(2);
              if (call.publisherId && paid.gt(0)) {
                clawback = { publisherId: call.publisherId, amount: paid };
                data.publisherPayoutStatus = 'CLAWED_BACK';
                data.publisherPayoutAmount = zero;
                data.payout = zero;
                payout = zero;
                metadata.originalPublisherPayout = (
                  call.publisherPayoutAmount ?? zero
                ).toString();
              }
            }
            data.profit = zero.minus(payout).minus(call.cost ?? zero);

            const original = call.buyerBillableAmount ?? zero;
            if (
              call.buyer?.billingType === 'UPFRONT' &&
              call.buyerChargeStatus === 'CHARGED' &&
              original.gt(0)
            ) {
              data.buyerChargeStatus = 'REFUNDED';
              refund = original;
            } else {
              data.buyerChargeStatus = 'WAIVED';
            }
          } else {
            data.disputeStatus = DENIED_DISPUTE;
            if (call.publisherPayoutStatus === 'HELD') data.publisherPayoutStatus = 'PAYABLE';
          }
          data.metadata = metadata as Prisma.InputJsonValue;

          // Conditional on the return still being open. See the file header.
          const updated = await tx.call.updateMany({
            where: { id: callId, tenantId, disputeStatus: OPEN_DISPUTE },
            data,
          });
          if (updated.count !== 1) throw new AlreadyDecidedError();

          let clawbackRow: ReturnClawback | null = null;
          if (clawback) {
            const row = await tx.publisherPayment.create({
              data: {
                kind: 'CLAWBACK',
                tenantId,
                publisherId: clawback.publisherId,
                callId,
                amount: clawback.amount.negated(),
                periodFrom: call.createdAt,
                periodTo: call.createdAt,
                method: 'RETURN',
                reference: `Return ${callId}`,
                paidAt: new Date(),
                createdById: userId,
                appliedToPaymentId: null,
              },
              select: { id: true, amount: true, appliedToPaymentId: true },
            });
            clawbackRow = {
              paymentId: row.id,
              amount: Number(row.amount.toFixed(2)),
              appliedToPaymentId: row.appliedToPaymentId,
            };
            metadata.clawbackPaymentId = row.id;
            await tx.call.update({
              where: { id: callId },
              data: { metadata: metadata as Prisma.InputJsonValue },
            });
          }

          if (refund && call.buyer) {
            const credited = await buyerBillingService.addCredits(
              call.buyer.id,
              refund.toNumber(),
              userId,
              `Return accepted for call ${callId}`,
              tx
            );
            if (!credited.success) {
              throw new Error(
                `Could not refund the buyer's wallet: ${credited.error ?? 'unknown'}`
              );
            }
          }

          const after = await tx.call.findUniqueOrThrow({
            where: { id: callId },
            select: {
              billable: true,
              revenue: true,
              payout: true,
              profit: true,
              buyerBillableAmount: true,
              publisherPayoutAmount: true,
              publisherPayoutStatus: true,
              buyerChargeStatus: true,
            },
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: chosen === 'ACCEPT' ? 'return.accepted' : 'return.denied',
              entityType: 'Call',
              entityId: callId,
              resource: request.url,
              method: request.method,
              requestId: request.id,
              ipAddress: request.ip,
              userAgent: request.headers['user-agent'],
              changes: {
                decision: chosen,
                note,
                before: moneySnapshot(call),
                after: moneySnapshot(after),
                walletRefund: refund ? refund.toFixed(2) : null,
                clawback: clawbackRow,
              },
            },
          });
        });
      } catch (error) {
        if (error instanceof AlreadyDecidedError) {
          return reply.code(409).send({
            error: { code: 'NOT_OPEN', message: 'This return has already been decided.' },
          });
        }
        throw error;
      }

      const row = await prisma.call.findFirstOrThrow({
        where: { id: callId, tenantId },
        select: RETURN_SELECT,
      });
      const clawbacks = await loadClawbacks(prisma, tenantId, [row]);
      return reply.send({ data: returnRowOf(row, clawbacks) });
    }
  );
}
