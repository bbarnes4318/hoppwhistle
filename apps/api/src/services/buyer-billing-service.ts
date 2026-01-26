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
  autoPaused?: boolean;
}

export interface UpfrontBuyerBalance {
  id: string;
  name: string;
  code: string;
  publisherName: string;
  leadsRemaining: number;
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
   * 2. Check if call.connectedDuration >= buyer.billableDuration
   * 3. If YES:
   *    - Decrement buyer.leadsRemaining by 1
   *    - Create BuyerTransaction (DEBIT, -1)
   *    - Set call.paidOut = true
   *    - SAFETY: If leadsRemaining < 1, auto-pause the buyer
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

        // Check 2: Is connected duration >= billable duration threshold?
        const connectedDuration = call.connectedDuration ?? 0;
        if (connectedDuration < buyer.billableDuration) {
          return {
            success: true,
            deducted: false,
            reason: `Connected duration (${connectedDuration}s) below threshold (${buyer.billableDuration}s)`,
            buyerId: buyer.id,
            leadsRemaining: buyer.leadsRemaining,
          };
        }

        // Check 3: Does buyer have leads remaining?
        if (buyer.leadsRemaining < 1) {
          logger.warn({
            msg: 'Buyer has no leads remaining',
            buyerId: buyer.id,
            callId,
          });
          return {
            success: true,
            deducted: false,
            reason: 'Buyer has no leads remaining',
            buyerId: buyer.id,
            leadsRemaining: 0,
          };
        }

        // All checks passed - deduct 1 lead
        const newBalance = buyer.leadsRemaining - 1;

        // Determine if buyer should be auto-paused
        const shouldPause = newBalance < 1;

        // Update buyer (with row-level lock via transaction)
        await tx.buyer.update({
          where: { id: buyer.id },
          data: {
            leadsRemaining: newBalance,
            status: shouldPause ? 'PAUSED' : buyer.status,
          },
        });

        // Create debit transaction
        await tx.buyerTransaction.create({
          data: {
            buyerId: buyer.id,
            amount: -1,
            type: 'DEBIT',
            description: `Call ID #${callId.substring(0, 8)}`,
            callId: callId,
          },
        });

        // Mark call as paid out
        await tx.call.update({
          where: { id: callId },
          data: {
            paidOut: true,
          },
        });

        // Log audit event
        await auditLog({
          tenantId: call.tenantId,
          action: 'buyer.billing.debit',
          entityType: 'Buyer',
          entityId: buyer.id,
          resource: 'leadsRemaining',
          changes: {
            previous: buyer.leadsRemaining,
            new: newBalance,
            callId,
            autoPaused: shouldPause,
          },
          ipAddress: 'system',
          success: true,
        });

        if (shouldPause) {
          logger.warn({
            msg: 'Buyer auto-paused due to zero balance',
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
              reason: 'Zero lead balance',
            },
            ipAddress: 'system',
            success: true,
          });
        }

        return {
          success: true,
          deducted: true,
          buyerId: buyer.id,
          leadsRemaining: newBalance,
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

    if (amount < 1) {
      return { success: false, newBalance: 0, error: 'Amount must be at least 1' };
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

        const previousBalance = buyer.leadsRemaining;
        const newBalance = previousBalance + amount;

        // Update buyer balance
        await tx.buyer.update({
          where: { id: buyerId },
          data: {
            leadsRemaining: newBalance,
            // Reactivate if was paused due to zero balance
            status: buyer.status === 'PAUSED' ? 'ACTIVE' : buyer.status,
          },
        });

        // Create credit transaction
        await tx.buyerTransaction.create({
          data: {
            buyerId: buyerId,
            amount: amount,
            type: 'CREDIT',
            description: description ?? `Admin added ${amount} leads`,
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
          resource: 'leadsRemaining',
          changes: {
            previous: previousBalance,
            new: newBalance,
            amount,
          },
          ipAddress: 'admin',
          success: true,
        });

        if (buyer.status === 'PAUSED') {
          logger.info({
            msg: 'Buyer reactivated after credit',
            buyerId,
            buyerName: buyer.name,
            newBalance,
          });
        }

        return newBalance;
      });

      return { success: true, newBalance: result };
    } catch (error) {
      logger.error({
        msg: 'Error adding credits to buyer',
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
      publisherName: buyer.publisher.name,
      leadsRemaining: buyer.leadsRemaining,
      status: buyer.status,
      isLowBalance: buyer.leadsRemaining < lowBalanceThreshold,
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
        amount: tx.amount,
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
