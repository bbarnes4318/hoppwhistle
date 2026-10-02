import { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { auditLog } from './audit.js';
import { resolvePauseReason, withPauseReason } from './buyer-pause.js';
import { expectedBuyerPrice } from './routing-buyer-gates.js';

/**
 * Buyer Billing Service
 *
 * Handles real-time billing for Upfront (pre-pay) Buyers.
 * Processes call billing, adds credits, and monitors balances.
 */

export interface BillingResult {
  success: boolean;
  deducted: boolean;
  reason?: string;
  buyerId?: string;
  leadsRemaining?: number;
  walletBalance?: number;
  autoPaused?: boolean;
}

export interface UpfrontBuyerBalance {
  id: string;
  name: string;
  code: string;
  publisherName: string;
  leadsRemaining: number;
  walletBalance: number;
  status: string;
  isLowBalance: boolean;
}

/** How many calls' worth of balance an UPFRONT buyer is warned below. */
export const LOW_BALANCE_CALLS = 5;
/** The window a buyer's average call price is taken over. */
export const AVERAGE_PRICE_WINDOW_DAYS = 30;

export interface LowBalanceWarning {
  /** The wallet is below `threshold`. */
  isLow: boolean;
  /** `LOW_BALANCE_CALLS` times `averageCallPrice`, or null when there is no price to go on. */
  threshold: number | null;
  averageCallPrice: number | null;
  /**
   * Where the average came from: the buyer's own billable calls over the last
   * `AVERAGE_PRICE_WINDOW_DAYS` days, or -- with none -- the prices configured
   * on the campaigns it is assigned to.
   */
  basis: 'RECENT_CALLS' | 'CONFIGURED_PRICE' | null;
}

export class BuyerBillingService {
  /**
   * Process billing when a call completes.
   * Uses Prisma Interactive Transaction to prevent race conditions.
   *
   * Logic:
   * 1. Check if buyer.billingType === 'UPFRONT'
   * 2. Check if call.buyerChargeStatus is already 'CHARGED' or if a DEBIT transaction exists.
   * 3. Check if call.billable is true.
   * 4. If YES:
   *    - Deduct call.buyerBillableAmount from buyer.walletBalance
   *    - Update buyer.leadsRemaining to Math.floor(newBalance) for legacy UI compatibility
   *    - Create BuyerTransaction (DEBIT, -chargeAmount)
   *    - Set call.buyerChargeStatus = 'CHARGED' and call.buyerChargedAt = now()
   *    - SAFETY: If newBalance <= 0, auto-pause the buyer
   */
  async processCallBilling(callId: string): Promise<BillingResult> {
    const prisma = getPrismaClient();

    try {
      // Use interactive transaction with row-level locking
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Fetch call with buyer
        const call = await tx.call.findUnique({
          where: { id: callId },
          include: {
            buyer: true,
            campaign: { select: { billingModel: true } },
          },
        });

        if (!call) {
          return { success: false, deducted: false, reason: 'Call not found' };
        }

        if (!call.buyer) {
          return { success: true, deducted: false, reason: 'No buyer associated with call' };
        }

        const buyer = call.buyer;

        // Check 1: Is billing type UPFRONT?
        if (buyer.billingType !== 'UPFRONT') {
          return {
            success: true,
            deducted: false,
            reason: 'Buyer is TERMS billing (post-pay)',
            buyerId: buyer.id,
          };
        }

        // A PER_APPLICATION call's charge moves after the call ends: a second
        // application on it adds one, a void takes one away. Its single DEBIT
        // is kept equal to the call's charge rather than written once.
        if (call.campaign?.billingModel === 'PER_APPLICATION') {
          return syncApplicationDebit(tx, call, buyer);
        }

        // Check 1.2: Check if a DEBIT transaction already exists for this call and buyer to ensure database-level idempotency
        const existingTx = await tx.buyerTransaction.findFirst({
          where: {
            buyerId: buyer.id,
            callId: callId,
            type: 'DEBIT',
          },
        });

        if (existingTx) {
          // If transaction exists but the call wasn't marked as CHARGED, update call state to keep it consistent
          if (call.buyerChargeStatus !== 'CHARGED') {
            await tx.call.update({
              where: { id: callId },
              data: {
                buyerChargeStatus: 'CHARGED',
                buyerChargedAt: existingTx.createdAt,
              },
            });
          }
          return {
            success: true,
            deducted: false,
            reason: 'Call already charged (transaction exists)',
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
            walletBalance: Number(buyer.walletBalance),
          };
        }

        // Check 1.5: Has this call already been billed?
        if (call.buyerChargeStatus === 'CHARGED') {
          return {
            success: true,
            deducted: false,
            reason: 'Call already charged',
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
            walletBalance: Number(buyer.walletBalance),
          };
        }

        // Check 2: Is call billable?
        if (!call.billable) {
          if (call.buyerChargeStatus !== 'NOT_BILLABLE') {
            await tx.call.update({
              where: { id: callId },
              data: {
                buyerChargeStatus: 'NOT_BILLABLE',
              },
            });
          }
          return {
            success: true,
            deducted: false,
            reason: 'Call is not billable',
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
            walletBalance: Number(buyer.walletBalance),
          };
        }

        const chargeAmount = call.buyerBillableAmount || new Prisma.Decimal(0);
        if (chargeAmount.isZero()) {
          return {
            success: true,
            deducted: false,
            reason: 'Charge amount is 0',
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
            walletBalance: Number(buyer.walletBalance),
          };
        }

        // Check 3: Does buyer have sufficient wallet balance?
        if (buyer.walletBalance.lessThan(chargeAmount)) {
          logger.warn({
            msg: 'Buyer has insufficient wallet balance',
            buyerId: buyer.id,
            walletBalance: buyer.walletBalance.toString(),
            chargeAmount: chargeAmount.toString(),
            callId,
          });

          // Auto-pause if not already paused. The reason goes beside the
          // status so a later credit knows this pause is the wallet's to
          // lift (see services/buyer-pause.ts).
          if (buyer.status !== 'PAUSED') {
            await tx.buyer.update({
              where: { id: buyer.id },
              data: {
                status: 'PAUSED',
                metadata: withPauseReason(buyer.metadata, 'WALLET_EMPTY'),
              },
            });

            await auditLog({
              tenantId: call.tenantId,
              action: 'buyer.status.autopaused',
              entityType: 'Buyer',
              entityId: buyer.id,
              resource: 'status',
              changes: {
                previous: buyer.status,
                new: 'PAUSED',
                reason: 'Insufficient wallet balance',
              },
              ipAddress: 'system',
              success: true,
            });
          }

          return {
            success: true,
            deducted: false,
            reason: 'Insufficient wallet balance',
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
            walletBalance: Number(buyer.walletBalance),
          };
        }

        // All checks passed - deduct chargeAmount
        const newBalance = buyer.walletBalance.minus(chargeAmount);
        const newLeadsRemaining = Math.floor(Number(newBalance));

        // Determine if buyer should be auto-paused after deduction. A buyer
        // already paused keeps the pause it has: a charge landing on a buyer
        // an owner paused by hand (a call that was in flight) must not turn
        // that into a wallet pause the next top-up would lift.
        const shouldPause = newBalance.lessThanOrEqualTo(0) && buyer.status !== 'PAUSED';

        // Update buyer
        await tx.buyer.update({
          where: { id: buyer.id },
          data: {
            walletBalance: newBalance,
            leadsRemaining: newLeadsRemaining,
            ...(shouldPause
              ? { status: 'PAUSED', metadata: withPauseReason(buyer.metadata, 'WALLET_EMPTY') }
              : {}),
          },
        });

        // Create debit transaction
        await tx.buyerTransaction.create({
          data: {
            buyerId: buyer.id,
            amount: chargeAmount.negated(),
            type: 'DEBIT',
            description: `Call ID #${callId.substring(0, 8)}`,
            callId: callId,
          },
        });

        // Update call status
        await tx.call.update({
          where: { id: callId },
          data: {
            buyerChargeStatus: 'CHARGED',
            buyerChargedAt: new Date(),
          },
        });

        // Log audit event
        await auditLog({
          tenantId: call.tenantId,
          action: 'buyer.billing.debit',
          entityType: 'Buyer',
          entityId: buyer.id,
          resource: 'walletBalance',
          changes: {
            previous: buyer.walletBalance.toString(),
            new: newBalance.toString(),
            callId,
            autoPaused: shouldPause,
          },
          ipAddress: 'system',
          success: true,
        });

        if (shouldPause) {
          logger.warn({
            msg: 'Buyer auto-paused due to zero/negative balance',
            buyerId: buyer.id,
            buyerName: buyer.name,
          });

          await auditLog({
            tenantId: call.tenantId,
            action: 'buyer.status.autopaused',
            entityType: 'Buyer',
            entityId: buyer.id,
            resource: 'status',
            changes: {
              previous: buyer.status,
              new: 'PAUSED',
              reason: 'Zero/negative wallet balance',
            },
            ipAddress: 'system',
            success: true,
          });
        }

        return {
          success: true,
          deducted: true,
          buyerId: buyer.id,
          leadsRemaining: newLeadsRemaining,
          walletBalance: Number(newBalance),
          autoPaused: shouldPause,
        };
      });

      return result;
    } catch (error) {
      logger.error({
        msg: 'Error processing call billing',
        callId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        deducted: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Add credits to a buyer's wallet (admin action).
   *
   * @param buyerId - The buyer to credit
   * @param amount - Number of leads to add
   * @param adminId - ID of admin performing the action
   * @param description - Optional description for the transaction
   * @param client - A transaction to run inside instead of opening one. Given
   *   by a caller whose own writes must commit or fail with this credit -- a
   *   return being accepted refunds the wallet in the same transaction that
   *   zeroes the call. The audit row is then written through it too, so a
   *   rolled-back credit leaves no row claiming it happened. Omitted, this
   *   behaves exactly as it always has.
   */
  async addCredits(
    buyerId: string,
    amount: number,
    adminId: string,
    description?: string,
    client?: Prisma.TransactionClient
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    const prisma = getPrismaClient();

    if (amount <= 0) {
      return { success: false, newBalance: 0, error: 'Amount must be greater than 0' };
    }

    try {
      const credit = async (tx: Prisma.TransactionClient) => {
        // Fetch buyer
        const buyer = await tx.buyer.findUnique({
          where: { id: buyerId },
        });

        if (!buyer) {
          throw new Error('Buyer not found');
        }

        const previousBalance = buyer.walletBalance;
        const newBalance = previousBalance.plus(amount);
        const newLeads = Math.floor(Number(newBalance));

        /*
         * Reactivate only a buyer the WALLET paused, and only once the credit
         * leaves something to spend. A buyer its owner paused by hand stays
         * paused however much is added -- that pause is not about money, and
         * lifting it is the owner's call. A paused buyer with no recorded
         * reason is resolved from the audit trail, and reads as a manual pause
         * when that cannot say (services/buyer-pause.ts).
         */
        const pauseReason = await resolvePauseReason(tx, buyer);
        const resume = pauseReason === 'WALLET_EMPTY' && newBalance.greaterThan(0);

        // Update buyer balance
        await tx.buyer.update({
          where: { id: buyerId },
          data: {
            walletBalance: newBalance,
            leadsRemaining: newLeads,
            ...(resume
              ? { status: 'ACTIVE', metadata: withPauseReason(buyer.metadata, null) }
              : {}),
          },
        });

        // Create credit transaction
        await tx.buyerTransaction.create({
          data: {
            buyerId: buyerId,
            amount: new Prisma.Decimal(amount),
            type: 'CREDIT',
            description: description ?? `Admin added $${Number(amount).toFixed(2)}`,
            createdById: adminId,
          },
        });

        // Audit log
        const audit = {
          tenantId: buyer.tenantId,
          userId: adminId,
          action: 'buyer.billing.credit',
          entityType: 'Buyer',
          entityId: buyerId,
          resource: 'walletBalance',
          changes: {
            previous: previousBalance.toString(),
            new: newBalance.toString(),
            amount: amount.toString(),
          },
          ipAddress: 'admin',
          success: true,
        };
        if (client) {
          await tx.auditLog.create({ data: audit });
        } else {
          await auditLog(audit);
        }

        if (resume) {
          logger.info({
            msg: 'Buyer reactivated after deposit',
            buyerId,
            buyerName: buyer.name,
            newBalance: newBalance.toString(),
          });
        }

        return Number(newBalance);
      };

      const result = client ? await credit(client) : await prisma.$transaction(credit);

      return { success: true, newBalance: result };
    } catch (error) {
      logger.error({
        msg: 'Error adding funds to buyer',
        buyerId,
        amount,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        newBalance: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all Upfront buyers with their balances for dashboard widget.
   *
   * @param tenantId - The tenant to filter by
   * @param lowBalanceThreshold - Threshold for "low balance" alert (default: 10)
   */
  async getUpfrontBuyerBalances(
    tenantId: string,
    lowBalanceThreshold: number = 10
  ): Promise<UpfrontBuyerBalance[]> {
    const prisma = getPrismaClient();

    const buyers = await prisma.buyer.findMany({
      where: {
        tenantId,
        billingType: 'UPFRONT',
      },
      include: {
        publisher: {
          select: { name: true },
        },
      },
      orderBy: [{ leadsRemaining: 'asc' }, { name: 'asc' }],
    });

    return buyers.map(buyer => ({
      id: buyer.id,
      name: buyer.name,
      code: buyer.code,
      publisherName: buyer.publisher?.name || 'none',
      leadsRemaining: buyer.leadsRemaining,
      walletBalance: Number(buyer.walletBalance),
      status: buyer.status,
      isLowBalance: Number(buyer.walletBalance) < lowBalanceThreshold,
    }));
  }

  /**
   * Whether an UPFRONT buyer's wallet is running low.
   *
   * "Low" is measured in calls, not dollars: a $200 balance is weeks for a
   * buyer paying $8 a call and two calls for one paying $100. The balance is
   * low when it covers fewer than `LOW_BALANCE_CALLS` calls at the buyer's
   * average price -- what it actually paid per billable call over the last 30
   * days. A buyer with no billable calls in that window is priced from its
   * campaign assignments instead, resolved the way routing resolves the price
   * it holds the wallet to (`expectedBuyerPrice`). With neither there is no
   * price to measure against, and no warning.
   *
   * Null for a TERMS buyer: it has no wallet to run out of.
   */
  async getLowBalanceWarning(buyer: {
    id: string;
    tenantId: string;
    billingType: string;
    walletBalance: Prisma.Decimal;
  }): Promise<LowBalanceWarning | null> {
    if (buyer.billingType !== 'UPFRONT') return null;
    const prisma = getPrismaClient();

    const since = new Date(Date.now() - AVERAGE_PRICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await prisma.call.aggregate({
      where: {
        tenantId: buyer.tenantId,
        buyerId: buyer.id,
        billable: true,
        buyerBillableAmount: { gt: 0 },
        createdAt: { gte: since },
      },
      _avg: { buyerBillableAmount: true },
    });

    let averageCallPrice: number | null = null;
    let basis: LowBalanceWarning['basis'] = null;
    const recentAverage = recent._avg.buyerBillableAmount;
    if (recentAverage && recentAverage.gt(0)) {
      averageCallPrice = Number(recentAverage.toFixed(2));
      basis = 'RECENT_CALLS';
    } else {
      const assignments = await prisma.campaignBuyer.findMany({
        where: { tenantId: buyer.tenantId, buyerId: buyer.id, status: 'ACTIVE' },
        select: {
          pricePerBillableCall: true,
          campaign: { select: { buyerPricePerBillableCall: true } },
          buyerEndpoint: { select: { basePrice: true } },
        },
      });
      const prices = assignments
        .map(a =>
          expectedBuyerPrice({
            campaignBuyerPrice: a.pricePerBillableCall,
            campaignDefaultPrice: a.campaign?.buyerPricePerBillableCall,
            endpointBasePrice: a.buyerEndpoint?.basePrice,
          })
        )
        .filter(price => price > 0);
      if (prices.length > 0) {
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        averageCallPrice = Number(mean.toFixed(2));
        basis = 'CONFIGURED_PRICE';
      }
    }

    if (averageCallPrice === null) {
      return { isLow: false, threshold: null, averageCallPrice: null, basis: null };
    }
    const threshold = Number((averageCallPrice * LOW_BALANCE_CALLS).toFixed(2));
    return {
      isLow: Number(buyer.walletBalance) < threshold,
      threshold,
      averageCallPrice,
      basis,
    };
  }

  /**
   * Get transaction history for a buyer (the ledger).
   */
  async getBuyerTransactions(
    buyerId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<{
    transactions: Array<{
      id: string;
      amount: number;
      type: string;
      description: string;
      callId: string | null;
      createdAt: Date;
      createdByEmail?: string;
    }>;
    total: number;
  }> {
    const prisma = getPrismaClient();
    const { limit = 50, offset = 0, startDate, endDate } = options ?? {};

    const where: Prisma.BuyerTransactionWhereInput = {
      buyerId,
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.buyerTransaction.findMany({
        where,
        include: {
          createdBy: {
            select: { email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.buyerTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: Number(tx.amount),
        type: tx.type,
        description: tx.description,
        callId: tx.callId,
        createdAt: tx.createdAt,
        createdByEmail: tx.createdBy?.email,
      })),
      total,
    };
  }
}

export const buyerBillingService = new BuyerBillingService();

/**
 * Bring an UPFRONT buyer's DEBIT for a PER_APPLICATION call to the call's
 * current charge (`buyerBillableAmount`, or nothing once it is not billable).
 *
 * One DEBIT row per call (unique on buyer, call, type), so the row's amount is
 * moved and the wallet by the difference: up when an application is added,
 * back when one is voided. A raise the wallet cannot cover is refused and the
 * buyer paused, exactly as a first charge is.
 */
async function syncApplicationDebit(
  tx: Prisma.TransactionClient,
  call: {
    id: string;
    tenantId: string;
    billable: boolean;
    buyerBillableAmount: Prisma.Decimal | null;
  },
  buyer: {
    id: string;
    status: string;
    walletBalance: Prisma.Decimal;
    metadata: Prisma.JsonValue;
  }
): Promise<BillingResult> {
  const zero = new Prisma.Decimal(0);
  const target = call.billable ? (call.buyerBillableAmount ?? zero) : zero;
  const existing = await tx.buyerTransaction.findFirst({
    where: { buyerId: buyer.id, callId: call.id, type: 'DEBIT' },
  });
  const debited = existing ? existing.amount.negated() : zero;
  const delta = target.minus(debited); // > 0 charges more, < 0 gives back
  const unchanged = {
    success: true,
    deducted: false,
    buyerId: buyer.id,
    walletBalance: Number(buyer.walletBalance),
  };

  if (delta.isZero()) {
    if (target.gt(0)) {
      await tx.call.update({
        where: { id: call.id },
        data: { buyerChargeStatus: 'CHARGED' },
      });
    }
    return { ...unchanged, reason: 'Application charge already in step' };
  }

  if (delta.gt(0) && buyer.walletBalance.lessThan(delta)) {
    if (buyer.status !== 'PAUSED') {
      await tx.buyer.update({
        where: { id: buyer.id },
        data: { status: 'PAUSED', metadata: withPauseReason(buyer.metadata, 'WALLET_EMPTY') },
      });
    }
    return { ...unchanged, reason: 'Insufficient wallet balance' };
  }

  const newBalance = buyer.walletBalance.minus(delta);
  const shouldPause = newBalance.lessThanOrEqualTo(0) && buyer.status !== 'PAUSED';
  await tx.buyer.update({
    where: { id: buyer.id },
    data: {
      walletBalance: newBalance,
      leadsRemaining: Math.floor(Number(newBalance)),
      ...(shouldPause
        ? { status: 'PAUSED', metadata: withPauseReason(buyer.metadata, 'WALLET_EMPTY') }
        : {}),
    },
  });

  if (target.isZero()) {
    if (existing) await tx.buyerTransaction.delete({ where: { id: existing.id } });
  } else if (existing) {
    await tx.buyerTransaction.update({
      where: { id: existing.id },
      data: { amount: target.negated() },
    });
  } else {
    await tx.buyerTransaction.create({
      data: {
        buyerId: buyer.id,
        amount: target.negated(),
        type: 'DEBIT',
        description: `Applications on call ID #${call.id.substring(0, 8)}`,
        callId: call.id,
      },
    });
  }

  await tx.call.update({
    where: { id: call.id },
    data: target.gt(0)
      ? { buyerChargeStatus: 'CHARGED', buyerChargedAt: new Date() }
      : { buyerChargeStatus: 'NOT_BILLABLE' },
  });

  await auditLog({
    tenantId: call.tenantId,
    action: 'buyer.billing.application_debit',
    entityType: 'Buyer',
    entityId: buyer.id,
    resource: 'walletBalance',
    changes: {
      previous: buyer.walletBalance.toString(),
      new: newBalance.toString(),
      callId: call.id,
      debitedBefore: debited.toString(),
      debitedAfter: target.toString(),
      autoPaused: shouldPause,
    },
    ipAddress: 'system',
    success: true,
  });

  return {
    success: true,
    deducted: delta.gt(0),
    buyerId: buyer.id,
    walletBalance: Number(newBalance),
    autoPaused: shouldPause,
  };
}
