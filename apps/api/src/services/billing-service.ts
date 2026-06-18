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
   * Billable means durationUsed is greater than or equal to the threshold.
   */
  isBillableCall(durationUsed: number, threshold: number): boolean {
    return durationUsed >= threshold;
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

        // 1. Resolve duration used: prefer connectedDuration, fall back to duration
        let durationUsed = 0;
        let connectedDurationFallbackUsed = false;
        if (call.connectedDuration !== null && call.connectedDuration !== undefined) {
          durationUsed = call.connectedDuration;
        } else if (call.duration !== null && call.duration !== undefined) {
          durationUsed = call.duration;
          connectedDurationFallbackUsed = true;
        }

        // 2. Resolve threshold: Campaign -> Buyer -> 60s
        let threshold = 60;
        let thresholdSource = 'default_60s';
        if (campaign && campaign.billableDurationSeconds !== null && campaign.billableDurationSeconds !== undefined) {
          threshold = campaign.billableDurationSeconds;
          thresholdSource = 'campaign';
        } else if (call.buyer && call.buyer.billableDuration !== null && call.buyer.billableDuration !== undefined) {
          threshold = call.buyer.billableDuration;
          thresholdSource = 'buyer';
        }

        // 3. Determine billability: >= threshold
        let billable = false;
        let noPayoutReason: string | null = null;
        let noConversionReason: string | null = null;

        if (call.blocked) {
          noPayoutReason = 'BLOCKED';
          noConversionReason = 'BLOCKED';
        } else if (call.isDuplicate) {
          noPayoutReason = 'DUPLICATE_CALLER';
          noConversionReason = 'DUPLICATE_CALLER';
        } else if (call.missedCall) {
          noPayoutReason = 'MISSED_CALL';
          noConversionReason = 'MISSED_CALL';
        } else if (call.status !== 'COMPLETED' && call.status !== 'ANSWERED') {
          noPayoutReason = 'CALL_NOT_ANSWERED';
          noConversionReason = 'CALL_NOT_ANSWERED';
        } else if (durationUsed < threshold) {
          noPayoutReason = 'BELOW_DURATION_THRESHOLD';
          noConversionReason = 'BELOW_DURATION_THRESHOLD';
        } else {
          billable = true;
        }

        // 4. Resolve Buyer Endpoint ID
        let buyerEndpointId: string | null = null;
        if (call.buyerId && call.targetNumber) {
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
          }
        }

        // 5. Resolve Buyer Revenue Rate
        let buyerPriceRate = new Prisma.Decimal(0);
        let pricingSource = 'default_0';

        // A. Check RTB winning bid (if ping/post)
        let rtbBidAmount: Prisma.Decimal | null = null;
        if (call.buyerId && call.did) {
          const pingRequests = await tx.pingRequest.findMany({
            where: {
              tenantId,
              status: 'SOLD',
              assignedPhoneNumber: {
                number: call.did,
              },
            },
            include: {
              bids: {
                where: {
                  buyerId: call.buyerId,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 5,
          });

          const normalizedCaller = this.normalizePhoneNumber(call.callerId);
          const match = pingRequests.find(pr => {
            if (!pr.callerNumber) return false;
            return this.normalizePhoneNumber(pr.callerNumber) === normalizedCaller;
          });

          if (match && match.bids.length > 0) {
            const winningBid = match.bids.find(b => b.buyerEndpointId === buyerEndpointId) || match.bids[0];
            rtbBidAmount = winningBid.amount;
          }
        }

        if (rtbBidAmount !== null) {
          buyerPriceRate = rtbBidAmount;
          pricingSource = 'rtb_winning_bid';
        } else if (campaign && call.buyerId && call.targetNumber) {
          // B. CampaignBuyer override
          const normalizedTarget = this.normalizePhoneNumber(call.targetNumber);
          const assignments = await tx.campaignBuyer.findMany({
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

          if (match && match.pricePerBillableCall !== null && match.pricePerBillableCall !== undefined) {
            buyerPriceRate = match.pricePerBillableCall;
            pricingSource = 'campaign_buyer_override';
            if (match.buyerEndpointId) {
              buyerEndpointId = match.buyerEndpointId;
            }
          } else {
            // C. Campaign default buyer price
            buyerPriceRate = campaign.buyerPricePerBillableCall;
            pricingSource = 'campaign_default';
          }
        }

        // D. BuyerEndpoint basePrice fallback
        if (buyerPriceRate.isZero() && buyerEndpointId) {
          const ep = await tx.buyerEndpoint.findUnique({
            where: { id: buyerEndpointId },
          });
          if (ep && !ep.basePrice.isZero()) {
            buyerPriceRate = ep.basePrice;
            pricingSource = 'buyer_endpoint_fallback';
          }
        }

        // 6. Resolve Publisher Payout Rate
        let publisherPayoutRate = new Prisma.Decimal(0);
        let payoutSource = 'default_0';

        if (campaign && call.publisherId) {
          // A. CampaignPublisher override
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
            payoutSource = 'campaign_publisher_override';
          } else {
            // B. Campaign default
            publisherPayoutRate = campaign.publisherPayoutPerBillableCall;
            payoutSource = 'campaign_default';
          }
        }

        // C. Publisher specific payout rule fallback
        if (publisherPayoutRate.isZero() && call.publisherId) {
          const publisher = await tx.publisher.findUnique({
            where: { id: call.publisherId },
          });
          const pubMeta = (publisher?.metadata as any) || {};
          if (pubMeta.defaultPayoutRate !== undefined) {
            publisherPayoutRate = new Prisma.Decimal(pubMeta.defaultPayoutRate);
            payoutSource = 'publisher_metadata';
          }
        }

        // 7. Resolve Carrier / Live-Transfer Cost
        let cost = new Prisma.Decimal(0);
        let costSource = 'estimated_rate_card';

        const callMetadata = (call.metadata as any) || {};

        if (call.cost !== null && call.cost !== undefined) {
          cost = new Prisma.Decimal(call.cost);
          costSource = callMetadata.costSource || 'freeswitch_cdr';
        } else {
          // No cost on call, try to estimate from route metadata or phone number metadata
          const route = await tx.didRoute.findFirst({
            where: { tenantId, did: call.did || '' },
            include: { phoneNumber: true }
          });

          let rate = 0.015; // default rate card rate if nothing is found (e.g. $0.015/min)
          if (route) {
            const routeMeta = (route.metadata as any) || {};
            const phoneMeta = (route.phoneNumber?.metadata as any) || {};

            if (routeMeta.carrierCostPerMinute !== undefined) {
              rate = Number(routeMeta.carrierCostPerMinute);
            } else if (phoneMeta.carrierCostPerMinute !== undefined) {
              rate = Number(phoneMeta.carrierCostPerMinute);
            }
          }

          // Calculate estimated cost: duration in minutes * rate
          const durationSeconds = call.duration || 0;
          cost = new Prisma.Decimal((durationSeconds / 60) * rate);
          costSource = 'estimated_rate_card';
        }

        // 8. Calculate final amounts
        const revenue = billable ? buyerPriceRate : new Prisma.Decimal(0);
        const payout = billable ? publisherPayoutRate : new Prisma.Decimal(0);
        const profit = revenue.minus(payout).minus(cost);

        // 9. Build billing rule snapshot
        const billingRuleSnapshot = {
          campaignId: campaign?.id || null,
          campaignName: campaign?.name || null,
          publisherId: call.publisherId || null,
          publisherName: call.publisherName || null,
          buyerId: call.buyerId || null,
          buyerName: call.buyerName || null,
          buyerEndpointId,
          durationUsed,
          connectedDuration: call.connectedDuration ?? null,
          duration: call.duration ?? null,
          connectedDurationFallbackUsed,
          thresholdUsed: threshold,
          thresholdSource,
          publisherPayoutRate: publisherPayoutRate.toString(),
          payoutSource,
          buyerPriceRate: buyerPriceRate.toString(),
          pricingSource,
          costSource,
          destinationNumber: call.targetNumber || null,
          trackingDID: call.did || null,
          calculatedAt: new Date().toISOString(),
        };

        // 10. Update Call record with semantic status tracking fields
        const isUpfront = call.buyer?.billingType === 'UPFRONT';
        
        let buyerChargeStatus = call.buyerChargeStatus;
        if (!billable) {
          buyerChargeStatus = 'NOT_BILLABLE';
        } else if (!isUpfront) {
          buyerChargeStatus = 'CHARGED'; // TERMS is immediately accrued/charged
        } else if (buyerChargeStatus !== 'CHARGED') {
          buyerChargeStatus = 'PENDING'; // UPFRONT starts as PENDING until balance is deducted
        }

        const publisherPayoutStatus = billable && payout.gt(0) ? 'PAYABLE' : 'NOT_PAYABLE';
        const publisherPayableAt = billable && payout.gt(0) ? new Date() : null;

        await tx.call.update({
          where: { id: callId },
          data: {
            billable,
            billableDurationThreshold: threshold,
            publisherPayoutAmount: payout,
            buyerBillableAmount: revenue,
            revenue,
            payout,
            cost, // store resolved/estimated cost
            profit,
            noPayoutReason: billable ? null : noPayoutReason,
            noConversionReason: billable ? null : noConversionReason,
            billingCalculatedAt: new Date(),
            billingRuleSnapshot: billingRuleSnapshot as any,
            buyerChargeStatus,
            publisherPayoutStatus,
            publisherPayableAt,
            // Only set buyerChargedAt if TERMS and we just marked it as CHARGED
            ...(buyerChargeStatus === 'CHARGED' && !call.buyerChargedAt ? { buyerChargedAt: new Date() } : {}),
          },
        });

        // 11. Generate Accrual Ledger Entries (unified ledger rows)
        // Find or create active BillingAccount for this tenant
        let billingAccount = await tx.billingAccount.findFirst({
          where: { tenantId, status: 'ACTIVE' },
          select: { id: true },
        });

        let billingAccountId = billingAccount?.id;
        if (!billingAccountId) {
          const newAccount = await tx.billingAccount.create({
            data: {
              tenantId,
              name: 'Default Billing Account',
              status: 'ACTIVE',
              currency: 'USD',
            },
            select: { id: true },
          });
          billingAccountId = newAccount.id;
        }

        const periodDate = new Date();
        periodDate.setHours(0, 0, 0, 0);

        const upsertLedgerEntry = async (
          type: 'BUYER_REVENUE' | 'PUBLISHER_PAYOUT' | 'CARRIER_COST' | 'PLATFORM_PROFIT',
          amount: Prisma.Decimal,
          buyerId: string | null,
          publisherId: string | null,
          description: string
        ) => {
          const idempotencyKey = `${tenantId}:${callId}:${type}:${buyerId || 'none'}:${publisherId || 'none'}`;

          const existing = await tx.accrualLedger.findUnique({
            where: { idempotencyKey },
          });

          if (existing) {
            if (!existing.closed) {
              await tx.accrualLedger.update({
                where: { id: existing.id },
                data: {
                  amount,
                  description,
                  updatedAt: new Date(),
                },
              });
            }
            return existing;
          } else {
            return await tx.accrualLedger.create({
              data: {
                tenantId,
                billingAccountId,
                callId,
                type,
                amount,
                currency: 'USD',
                description,
                periodDate,
                buyerId,
                publisherId,
                idempotencyKey,
                closed: false,
              },
            });
          }
        };

        if (billable) {
          // A. Buyer Revenue Accrual
          if (call.buyerId && revenue.gt(0)) {
            await upsertLedgerEntry(
              'BUYER_REVENUE',
              revenue,
              call.buyerId,
              null,
              `Lead Charge - Campaign: ${campaign?.name || 'Unknown'}`
            );
          }

          // B. Publisher Payout Accrual
          if (call.publisherId && payout.gt(0)) {
            await upsertLedgerEntry(
              'PUBLISHER_PAYOUT',
              payout.negated(),
              null,
              call.publisherId,
              `Lead Payout - Campaign: ${campaign?.name || 'Unknown'}`
            );
          }
        } else {
          // If call is not billable, clean up any unclosed buyer revenue and publisher payout accruals
          await tx.accrualLedger.deleteMany({
            where: {
              callId,
              type: { in: ['BUYER_REVENUE', 'PUBLISHER_PAYOUT'] },
              closed: false,
            },
          });
        }

        // C. Carrier Cost Accrual (billable or non-billable, if cost is incurred)
        if (cost.gt(0)) {
          await upsertLedgerEntry(
            'CARRIER_COST',
            cost.negated(),
            null,
            null,
            `Carrier Cost - Call SID: ${call.callSid}`
          );
        }

        // D. Platform Profit Accrual (billable or non-billable, if there is profit/loss)
        if (!profit.isZero()) {
          await upsertLedgerEntry(
            'PLATFORM_PROFIT',
            profit,
            null,
            null,
            `Platform Profit - Call SID: ${call.callSid}`
          );
        }

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
