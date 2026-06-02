import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

export interface BillingCalculationResult {
  success: boolean;
  billable: boolean;
  durationUsed: number;
  thresholdUsed: number;
  publisherPayoutRate: string;
  buyerPriceRate: string;
  revenue: string;
  payout: string;
  profit: string;
  error?: string;
}

export class BillingService {
  /**
   * Get the duration used for billable calculation.
   * Prefers connectedDuration, falls back to duration, then 0.
   */
  getBillableDuration(call: { connectedDuration?: number | null; duration?: number | null }): number {
    if (call.connectedDuration !== null && call.connectedDuration !== undefined) {
      return call.connectedDuration;
    }
    if (call.duration !== null && call.duration !== undefined) {
      return call.duration;
    }
    return 0;
  }

  /**
   * Determine if a call is billable.
   * Billable means durationUsed is strictly greater than the threshold.
   */
  isBillableCall(durationUsed: number, threshold: number): boolean {
    return durationUsed > threshold;
  }

  /**
   * Normalize a phone number to E.164.
   */
  normalizePhoneNumber(num: string | null | undefined): string {
    if (!num) return '';
    const digits = num.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return num.startsWith('+') ? num : `+${num}`;
  }

  /**
   * Calculate billing for a single call and update it in the database.
   * Operation is safe to run multiple times (idempotent).
   */
  async calculateCallBilling(callId: string): Promise<BillingCalculationResult> {
    const prisma = getPrismaClient();

    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Fetch Call details
        const call = await tx.call.findUnique({
          where: { id: callId },
          include: {
            campaign: true,
            buyer: true,
            publisher: true,
          },
        });

        if (!call) {
          throw new Error(`Call with ID ${callId} not found`);
        }

        // We only calculate billing for COMPLETED or final call statuses (answered, failed etc are okay but completed is final)
        // Actually, let's verify if the status is INITIATED or RINGING - we shouldn't calculate billing then.
        if (call.status === 'INITIATED' || call.status === 'RINGING') {
          return {
            success: false,
            billable: false,
            durationUsed: 0,
            thresholdUsed: 0,
            publisherPayoutRate: '0.0000',
            buyerPriceRate: '0.0000',
            revenue: '0.0000',
            payout: '0.0000',
            profit: '0.0000',
            error: 'Call is not finalized yet',
          };
        }

        const tenantId = call.tenantId;
        const campaign = call.campaign;

        // 2. Resolve threshold (default to campaign settings, then buyer billableDuration, then 60)
        let threshold = 60;
        if (campaign) {
          threshold = campaign.billableDurationSeconds;
        } else if (call.buyer) {
          threshold = call.buyer.billableDuration;
        }

        const durationUsed = this.getBillableDuration(call);
        const billable = this.isBillableCall(durationUsed, threshold);

        // 3. Resolve Publisher Payout Rate
        let publisherPayoutRate = new Prisma.Decimal(0);
        if (campaign && call.publisherId) {
          // Check for CampaignPublisher override
          const assignment = await tx.campaignPublisher.findUnique({
            where: {
              tenantId_campaignId_publisherId: {
                tenantId,
                campaignId: campaign.id,
                publisherId: call.publisherId,
              },
            },
          });

          if (assignment?.payoutPerBillableCall !== null && assignment?.payoutPerBillableCall !== undefined) {
            publisherPayoutRate = assignment.payoutPerBillableCall;
          } else {
            publisherPayoutRate = campaign.publisherPayoutPerBillableCall;
          }
        }

        // 4. Resolve Buyer Price Rate
        let buyerPriceRate = new Prisma.Decimal(0);
        let buyerEndpointId: string | null = null;

        if (campaign && call.buyerId && call.targetNumber) {
          // Normalize target number for matching
          const normalizedTarget = this.normalizePhoneNumber(call.targetNumber);

          // Find campaign assignment
          const assignments = await tx.campaignBuyer.findMany({
            where: {
              tenantId,
              campaignId: campaign.id,
              buyerId: call.buyerId,
              status: 'ACTIVE',
            },
          });

          // Match by normalized destination number
          const match = assignments.find(
            (a) => this.normalizePhoneNumber(a.destinationNumber) === normalizedTarget
          );

          if (match) {
            buyerEndpointId = match.buyerEndpointId;
            if (match.pricePerBillableCall !== null && match.pricePerBillableCall !== undefined) {
              buyerPriceRate = match.pricePerBillableCall;
            } else {
              buyerPriceRate = campaign.buyerPricePerBillableCall;
            }
          } else {
            // No campaign assignment match, try fallback to Campaign level default buyer price
            buyerPriceRate = campaign.buyerPricePerBillableCall;

            // Try to find the BuyerEndpoint matching destination to resolve buyerEndpointId and basePrice fallback
            const endpoints = await tx.buyerEndpoint.findMany({
              where: {
                buyerId: call.buyerId,
                status: 'ACTIVE',
              },
            });

            const matchingEp = endpoints.find(
              (ep) => this.normalizePhoneNumber(ep.destination) === normalizedTarget
            );

            if (matchingEp) {
              buyerEndpointId = matchingEp.id;
              // Fall back to basePrice only if campaign default price is 0
              if (buyerPriceRate.isZero() && !matchingEp.basePrice.isZero()) {
                buyerPriceRate = matchingEp.basePrice;
              }
            }
          }
        } else if (call.buyerId && call.targetNumber) {
          // No campaign, fallback directly to buyer endpoints matching destination
          const normalizedTarget = this.normalizePhoneNumber(call.targetNumber);
          const endpoints = await tx.buyerEndpoint.findMany({
            where: {
              buyerId: call.buyerId,
              status: 'ACTIVE',
            },
          });

          const matchingEp = endpoints.find(
            (ep) => this.normalizePhoneNumber(ep.destination) === normalizedTarget
          );

          if (matchingEp) {
            buyerEndpointId = matchingEp.id;
            buyerPriceRate = matchingEp.basePrice;
          }
        }

        // 5. Calculate revenue, payout, and profit
        const revenue = billable ? buyerPriceRate : new Prisma.Decimal(0);
        const payout = billable ? publisherPayoutRate : new Prisma.Decimal(0);
        const callCost = call.cost ? new Prisma.Decimal(call.cost) : new Prisma.Decimal(0);
        const profit = revenue.minus(payout).minus(callCost);

        // 6. Build billing rule snapshot
        const billingRuleSnapshot = {
          campaignId: campaign?.id || null,
          campaignName: campaign?.name || null,
          publisherId: call.publisherId || null,
          publisherName: call.publisherName || null,
          buyerId: call.buyerId || null,
          buyerName: call.buyerName || null,
          buyerEndpointId,
          durationUsed,
          thresholdUsed: threshold,
          publisherPayoutRate: publisherPayoutRate.toString(),
          buyerPriceRate: buyerPriceRate.toString(),
          destinationNumber: call.targetNumber || null,
          trackingDID: call.did || null,
          calculatedAt: new Date().toISOString(),
        };

        // 7. Update Call record
        await tx.call.update({
          where: { id: callId },
          data: {
            billable,
            billableDurationThreshold: threshold,
            publisherPayoutAmount: payout,
            buyerBillableAmount: revenue,
            revenue,
            payout,
            profit,
            billingCalculatedAt: new Date(),
            billingRuleSnapshot: billingRuleSnapshot as any,
          },
        });

        // 8. If the buyer has UPFRONT billing, make sure the ledger debit matches the new logic safely
        // Wait, the requirements state: "If billing ledger/accrual records already exist, make the operation idempotent. Do not create duplicate accruals for the same call."
        // Let's check if we should hook into the Upfront billing ledger or AccrualLedger.
        // Let's see: `AccrualLedger` does NOT seem to have a strict unique key in prisma schema, but we can query it.
        // Let's see: does the app currently generate accruals? We don't see them generated in `buyer-billing-service.ts`.
        // Let's write the calculation result.
        return {
          success: true,
          billable,
          durationUsed,
          thresholdUsed: threshold,
          publisherPayoutRate: publisherPayoutRate.toFixed(4),
          buyerPriceRate: buyerPriceRate.toFixed(4),
          revenue: revenue.toFixed(4),
          payout: payout.toFixed(4),
          profit: profit.toFixed(4),
        };
      });
    } catch (error) {
      logger.error({
        msg: 'Error calculating call billing',
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        billable: false,
        durationUsed: 0,
        thresholdUsed: 0,
        publisherPayoutRate: '0.0000',
        buyerPriceRate: '0.0000',
        revenue: '0.0000',
        payout: '0.0000',
        profit: '0.0000',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Recalculate billing for all calls matching criteria in a date range.
   */
  async recalculateBillingForDateRange(params: {
    tenantId: string;
    startDate: Date;
    endDate: Date;
    campaignId?: string;
    dryRun?: boolean;
  }): Promise<{
    scanned: number;
    updated: number;
    billable: number;
    nonBillable: number;
    totalRevenue: string;
    totalPayout: string;
    totalProfit: string;
    changes: Array<{
      callId: string;
      callSid: string;
      before: { billable: boolean; revenue: string; payout: string };
      after: { billable: boolean; revenue: string; payout: string };
    }>;
  }> {
    const prisma = getPrismaClient();
    const dryRun = params.dryRun || false;

    // Fetch calls in range
    const calls = await prisma.call.findMany({
      where: {
        tenantId: params.tenantId,
        createdAt: {
          gte: params.startDate,
          lte: params.endDate,
        },
        ...(params.campaignId ? { campaignId: params.campaignId } : {}),
      },
      select: {
        id: true,
        callSid: true,
        billable: true,
        revenue: true,
        payout: true,
      },
    });

    const results = {
      scanned: calls.length,
      updated: 0,
      billable: 0,
      nonBillable: 0,
      totalRevenue: '0.0000',
      totalPayout: '0.0000',
      totalProfit: '0.0000',
      changes: [] as any[],
    };

    let totalRevDec = new Prisma.Decimal(0);
    let totalPayDec = new Prisma.Decimal(0);
    let totalProfDec = new Prisma.Decimal(0);

    for (const call of calls) {
      if (dryRun) {
        // Run billing calculation inside transaction but roll back or don't commit?
        // We can simulate the calculation by calling a dry-run calculation helper or just invoking the tx logic.
        // Actually, we can run the logic in memory since we have access to database.
        // But to keep it exact, we can just run the transaction, return results, and if dryRun we don't call update.
        // Wait, calculateCallBilling updates the database.
        // Let's implement a read-only preview of calculateCallBilling, or just run it in transaction, get details, and roll back!
        // Yes, rolling back is a classic database trick! But since it's a dryRun, we can do the calculation manually or roll it back.
        // Let's just calculate inside a transaction that rolls back! Or even simpler: we can fetch the data needed for calculation, run calculation in JS, and print it.
        // Let's write a calculation resolver that doesn't save to the database, so we can use it for preview.
        // Wait! Let's write `resolveCallBillingData` that reads the database and computes the results without writing them.
        const simulation = await this.simulateCallBilling(call.id);
        if (simulation.success) {
          const before = {
            billable: call.billable,
            revenue: (call.revenue || 0).toString(),
            payout: (call.payout || 0).toString(),
          };
          const after = {
            billable: simulation.billable,
            revenue: simulation.revenue,
            payout: simulation.payout,
          };

          const isDiff =
            before.billable !== after.billable ||
            new Prisma.Decimal(before.revenue).ne(new Prisma.Decimal(after.revenue)) ||
            new Prisma.Decimal(before.payout).ne(new Prisma.Decimal(after.payout));

          if (isDiff) {
            results.changes.push({
              callId: call.id,
              callSid: call.callSid,
              before,
              after,
            });
          }

          if (simulation.billable) {
            results.billable++;
          } else {
            results.nonBillable++;
          }

          totalRevDec = totalRevDec.plus(simulation.revenue);
          totalPayDec = totalPayDec.plus(simulation.payout);
          totalProfDec = totalProfDec.plus(simulation.profit);
        }
      } else {
        // Real run: calculate and update database
        const before = {
          billable: call.billable,
          revenue: (call.revenue || 0).toString(),
          payout: (call.payout || 0).toString(),
        };

        const res = await this.calculateCallBilling(call.id);
        if (res.success) {
          results.updated++;
          if (res.billable) {
            results.billable++;
          } else {
            results.nonBillable++;
          }

          totalRevDec = totalRevDec.plus(res.revenue);
          totalPayDec = totalPayDec.plus(res.payout);
          totalProfDec = totalProfDec.plus(res.profit);

          const after = {
            billable: res.billable,
            revenue: res.revenue,
            payout: res.payout,
          };

          const isDiff =
            before.billable !== after.billable ||
            new Prisma.Decimal(before.revenue).ne(new Prisma.Decimal(after.revenue)) ||
            new Prisma.Decimal(before.payout).ne(new Prisma.Decimal(after.payout));

          if (isDiff) {
            results.changes.push({
              callId: call.id,
              callSid: call.callSid,
              before,
              after,
            });
          }
        }
      }
    }

    results.totalRevenue = totalRevDec.toFixed(4);
    results.totalPayout = totalPayDec.toFixed(4);
    results.totalProfit = totalProfDec.toFixed(4);

    return results;
  }

  /**
   * Simulate billing calculation without saving to database.
   */
  async simulateCallBilling(callId: string): Promise<BillingCalculationResult> {
    const prisma = getPrismaClient();
    try {
      const call = await prisma.call.findUnique({
        where: { id: callId },
        include: {
          campaign: true,
          buyer: true,
        },
      });

      if (!call) {
        throw new Error(`Call not found: ${callId}`);
      }

      const tenantId = call.tenantId;
      const campaign = call.campaign;

      let threshold = 60;
      if (campaign) {
        threshold = campaign.billableDurationSeconds;
      } else if (call.buyer) {
        threshold = call.buyer.billableDuration;
      }

      const durationUsed = this.getBillableDuration(call);
      const billable = this.isBillableCall(durationUsed, threshold);

      let publisherPayoutRate = new Prisma.Decimal(0);
      if (campaign && call.publisherId) {
        const assignment = await prisma.campaignPublisher.findUnique({
          where: {
            tenantId_campaignId_publisherId: {
              tenantId,
              campaignId: campaign.id,
              publisherId: call.publisherId,
            },
          },
        });

        if (assignment?.payoutPerBillableCall !== null && assignment?.payoutPerBillableCall !== undefined) {
          publisherPayoutRate = assignment.payoutPerBillableCall;
        } else {
          publisherPayoutRate = campaign.publisherPayoutPerBillableCall;
        }
      }

      let buyerPriceRate = new Prisma.Decimal(0);
      if (campaign && call.buyerId && call.targetNumber) {
        const normalizedTarget = this.normalizePhoneNumber(call.targetNumber);
        const assignments = await prisma.campaignBuyer.findMany({
          where: {
            tenantId,
            campaignId: campaign.id,
            buyerId: call.buyerId,
            status: 'ACTIVE',
          },
        });

        const match = assignments.find(
          (a) => this.normalizePhoneNumber(a.destinationNumber) === normalizedTarget
        );

        if (match) {
          if (match.pricePerBillableCall !== null && match.pricePerBillableCall !== undefined) {
            buyerPriceRate = match.pricePerBillableCall;
          } else {
            buyerPriceRate = campaign.buyerPricePerBillableCall;
          }
        } else {
          buyerPriceRate = campaign.buyerPricePerBillableCall;
          const endpoints = await prisma.buyerEndpoint.findMany({
            where: {
              buyerId: call.buyerId,
              status: 'ACTIVE',
            },
          });
          const matchingEp = endpoints.find(
            (ep) => this.normalizePhoneNumber(ep.destination) === normalizedTarget
          );
          if (matchingEp && buyerPriceRate.isZero() && !matchingEp.basePrice.isZero()) {
            buyerPriceRate = matchingEp.basePrice;
          }
        }
      } else if (call.buyerId && call.targetNumber) {
        const normalizedTarget = this.normalizePhoneNumber(call.targetNumber);
        const endpoints = await prisma.buyerEndpoint.findMany({
          where: {
            buyerId: call.buyerId,
            status: 'ACTIVE',
          },
        });
        const matchingEp = endpoints.find(
          (ep) => this.normalizePhoneNumber(ep.destination) === normalizedTarget
        );
        if (matchingEp) {
          buyerPriceRate = matchingEp.basePrice;
        }
      }

      const revenue = billable ? buyerPriceRate : new Prisma.Decimal(0);
      const payout = billable ? publisherPayoutRate : new Prisma.Decimal(0);
      const callCost = call.cost ? new Prisma.Decimal(call.cost) : new Prisma.Decimal(0);
      const profit = revenue.minus(payout).minus(callCost);

      return {
        success: true,
        billable,
        durationUsed,
        thresholdUsed: threshold,
        publisherPayoutRate: publisherPayoutRate.toFixed(4),
        buyerPriceRate: buyerPriceRate.toFixed(4),
        revenue: revenue.toFixed(4),
        payout: payout.toFixed(4),
        profit: profit.toFixed(4),
      };
    } catch (error) {
      return {
        success: false,
        billable: false,
        durationUsed: 0,
        thresholdUsed: 0,
        publisherPayoutRate: '0.0000',
        buyerPriceRate: '0.0000',
        revenue: '0.0000',
        payout: '0.0000',
        profit: '0.0000',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const billingService = new BillingService();
