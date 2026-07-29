import { Prisma } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { auditLog } from './audit.js';

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

          // Auto-pause if not already paused
          if (buyer.status !== 'PAUSED') {
            await tx.buyer.update({
              where: { id: buyer.id },
              data: { status: 'PAUSED' },
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

        // Determine if buyer should be auto-paused after deduction
        const shouldPause = newBalance.lessThanOrEqualTo(0);

        // Update buyer
        await tx.buyer.update({
          where: { id: buyer.id },
          data: {
            walletBalance: newBalance,
            leadsRemaining: newLeadsRemaining,
            status: shouldPause ? 'PAUSED' : buyer.status,
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
   */
  async addCredits(
    buyerId: string,
    amount: number,
    adminId: string,
    description?: string
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    const prisma = getPrismaClient();

    if (amount <= 0) {
      return { success: false, newBalance: 0, error: 'Amount must be greater than 0' };
    }

    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

        // Update buyer balance
        await tx.buyer.update({
          where: { id: buyerId },
          data: {
            walletBalance: newBalance,
            leadsRemaining: newLeads,
            // Reactivate if was paused due to zero balance
            status: buyer.status === 'PAUSED' ? 'ACTIVE' : buyer.status,
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
        await auditLog({
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
        });

        if (buyer.status === 'PAUSED') {
          logger.info({
            msg: 'Buyer reactivated after deposit',
            buyerId,
            buyerName: buyer.name,
            newBalance: newBalance.toString(),
          });
        }

        return Number(newBalance);
      });

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
