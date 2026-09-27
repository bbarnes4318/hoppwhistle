/**
 * Buyer balances: every buyer in the agency, and where its money stands.
 *
 *   GET /api/v1/buyers/balances
 *
 * ── What each row says ───────────────────────────────────────────────────────
 *
 * One row per buyer in the acting tenant, whatever it is billed on:
 *
 *   UPFRONT  `walletBalance`, the prepaid wallet as it stands now.
 *   TERMS    `billedThisMonth`, the sum of `buyerBillableAmount` over this
 *            calendar month's billable calls for that buyer, the month reckoned
 *            in America/New_York like every other money figure
 *            (`resolvePeriod('THIS_MONTH')` over `salesCallWhere`).
 *
 * The other figure is null rather than zero: a TERMS buyer has no wallet, and
 * "$0.00" in that column would read as one that has run dry.
 *
 * `lastTopUp` is the latest CREDIT to the buyer's wallet that was money paid
 * in. An accepted return is also written as a CREDIT (`routes/returns.ts`
 * describes it "Return accepted for call ..."), and a refund is not a top-up.
 *
 * `pauseReason` is `Buyer.metadata.pauseReason` when it is one of the known
 * reasons, and null otherwise.
 *
 * This replaces the Balance tiles, which read the `balances` table -- a table
 * nothing writes.
 *
 * ── Who, and whose ───────────────────────────────────────────────────────────
 *
 * The agency's OWNER or ADMIN (or NetEnroll staff inside the agency), and the
 * acting tenant's buyers only. No parameter names a tenant.
 */

import { Prisma, RoleName } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { salesCallWhere } from '../services/reporting/call-money.js';

/** How an accepted return's wallet refund is described. Not a top-up. */
export const RETURN_REFUND_PREFIX = 'Return accepted';

export type BuyerPauseReason = 'WALLET_EMPTY' | 'MANUAL';

export interface BuyerBalanceRow {
  id: string;
  name: string;
  code: string;
  billingType: 'UPFRONT' | 'TERMS';
  /** UPFRONT only: the wallet now. Null for a TERMS buyer. */
  walletBalance: number | null;
  /** TERMS only: billed so far this New York calendar month. Null for UPFRONT. */
  billedThisMonth: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
  pauseReason: BuyerPauseReason | null;
  lastTopUp: { amount: number; at: string } | null;
}

function pauseReasonOf(metadata: Prisma.JsonValue | null): BuyerPauseReason | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const reason = (metadata as Record<string, unknown>).pauseReason;
  return reason === 'WALLET_EMPTY' || reason === 'MANUAL' ? reason : null;
}

export async function registerBuyerBalanceRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();
  const prisma = getPrismaClient();

  fastify.get(
    '/api/v1/buyers/balances',
    { preHandler: [authenticate, requireRole(RoleName.OWNER, RoleName.ADMIN)] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const month = resolvePeriod('THIS_MONTH');

      const buyers = await prisma.buyer.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          code: true,
          billingType: true,
          walletBalance: true,
          status: true,
          metadata: true,
        },
        orderBy: { name: 'asc' },
      });
      const ids = buyers.map(b => b.id);
      const termsIds = buyers.filter(b => b.billingType === 'TERMS').map(b => b.id);

      const [billed, topUps] = await Promise.all([
        termsIds.length === 0
          ? Promise.resolve([])
          : prisma.call.groupBy({
              by: ['buyerId'],
              where: {
                ...salesCallWhere(tenantId, month),
                buyerId: { in: termsIds },
                billable: true,
              },
              _sum: { buyerBillableAmount: true },
            }),
        ids.length === 0
          ? Promise.resolve([])
          : prisma.buyerTransaction.findMany({
              where: {
                buyerId: { in: ids },
                type: 'CREDIT',
                NOT: { description: { startsWith: RETURN_REFUND_PREFIX } },
              },
              orderBy: { createdAt: 'desc' },
              distinct: ['buyerId'],
              select: { buyerId: true, amount: true, createdAt: true },
            }),
      ]);

      const billedBy = new Map(
        billed.map(row => [row.buyerId, Number(row._sum.buyerBillableAmount ?? 0)])
      );
      const topUpBy = new Map(topUps.map(row => [row.buyerId, row]));

      const data: BuyerBalanceRow[] = buyers.map(buyer => {
        const upfront = buyer.billingType === 'UPFRONT';
        const topUp = topUpBy.get(buyer.id);
        return {
          id: buyer.id,
          name: buyer.name,
          code: buyer.code,
          billingType: buyer.billingType,
          walletBalance: upfront ? Number(buyer.walletBalance) : null,
          billedThisMonth: upfront ? null : (billedBy.get(buyer.id) ?? 0),
          status: buyer.status,
          pauseReason: pauseReasonOf(buyer.metadata),
          lastTopUp: topUp
            ? { amount: Number(topUp.amount), at: topUp.createdAt.toISOString() }
            : null,
        };
      });

      return reply.send({
        data,
        meta: { total: data.length, month: { from: month.from, to: month.to } },
      });
    }
  );
}
