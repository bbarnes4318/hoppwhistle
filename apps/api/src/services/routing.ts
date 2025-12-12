import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { analyticsService } from './analytics.js';

export class RoutingService {
  private prisma = getPrismaClient();

  /**
   * Select the best buyer for a campaign based on its routing mode
   */
  async selectBestBuyer(
    tenantId: string,
    campaignId: string
  ): Promise<{ buyerId: string; endpoint: string } | null> {
    try {
      // 1. Fetch Campaign and its Routing Mode
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          publisher: {
            include: {
              buyers: {
                where: { status: 'ACTIVE' },
                include: {
                  endpoints: {
                    where: { status: 'ACTIVE' },
                    orderBy: { priority: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!campaign || !campaign.publisher || campaign.publisher.buyers.length === 0) {
        logger.warn(`No active buyers found for campaign ${campaignId}`);
        return null;
      }

      const buyers = campaign.publisher.buyers.filter(b => b.endpoints.length > 0);
      if (buyers.length === 0) {
        logger.warn(`No active endpoints found for buyers of campaign ${campaignId}`);
        return null;
      }

      // 2. Check Routing Mode
      if (campaign.routingMode === 'STATIC') {
        // Fallback to simple static priority (using buyer creation order or name for now as explicit priority is on endpoint)
        // Or just pick the first one
        return {
          buyerId: buyers[0].id,
          endpoint: buyers[0].endpoints[0].destination,
        };
      }

      // 3. Performance/Hybrid Routing
      // Fetch scores
      const scores = await analyticsService.getBuyerScores(tenantId, campaignId);

      // 4. Sort Buyers
      // Hybrid Sort:
      // - Tier 1: Buyers with enough volume (score exists) -> Sort by Score DESC
      // - Tier 2: Buyers with low volume (score missing) -> Sort by Static Priority (here just random/stable sort)

      const tier1: typeof buyers = [];
      const tier2: typeof buyers = [];

      for (const buyer of buyers) {
        if (scores.has(buyer.id)) {
          tier1.push(buyer);
        } else {
          tier2.push(buyer);
        }
      }

      // Sort Tier 1 by Score DESC
      tier1.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));

      // Sort Tier 2 (Static fallback) - e.g. by name or creation
      tier2.sort((a, b) => a.name.localeCompare(b.name));

      // Merge: Tier 1 first, then Tier 2
      const sortedBuyers = [...tier1, ...tier2];
      const bestBuyer = sortedBuyers[0];

      logger.info({
        msg: 'Selected best buyer',
        campaignId,
        mode: campaign.routingMode,
        buyerId: bestBuyer.id,
        score: scores.get(bestBuyer.id),
        tier: tier1.includes(bestBuyer) ? 'performance' : 'static_fallback',
      });

      return {
        buyerId: bestBuyer.id,
        endpoint: bestBuyer.endpoints[0].destination,
      };
    } catch (error) {
      logger.error('Error selecting best buyer:', error);
      return null;
    }
  }
}

export const routingService = new RoutingService();
