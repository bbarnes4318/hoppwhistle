#!/usr/bin/env tsx
import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';

async function main() {
  console.log('Starting CampaignPublisher backfill script...');
  const prisma = getPrismaClient();

  try {
    // Fetch all campaigns that have a publisherId
    const campaigns = await prisma.campaign.findMany({
      where: {
        NOT: {
          publisherId: '',
        },
      },
      select: {
        id: true,
        tenantId: true,
        publisherId: true,
        name: true,
      },
    });

    console.log(`Found ${campaigns.length} campaigns with a pre-existing publisherId.`);
    let createdCount = 0;
    let skippedCount = 0;

    for (const campaign of campaigns) {
      if (!campaign.publisherId) continue;

      // Check if assignment already exists
      const existing = await prisma.campaignPublisher.findUnique({
        where: {
          tenantId_campaignId_publisherId: {
            tenantId: campaign.tenantId,
            campaignId: campaign.id,
            publisherId: campaign.publisherId,
          },
        },
      });

      if (!existing) {
        // Create CampaignPublisher entry
        await prisma.campaignPublisher.create({
          data: {
            tenantId: campaign.tenantId,
            campaignId: campaign.id,
            publisherId: campaign.publisherId,
            payoutPerBillableCall: null, // Defaults to campaign's payout rate
            status: 'ACTIVE',
          },
        });
        console.log(`[CREATED] Assigned publisher to campaign: "${campaign.name}" (${campaign.id})`);
        createdCount++;
      } else {
        console.log(`[SKIPPED] Assignment already exists for: "${campaign.name}" (${campaign.id})`);
        skippedCount++;
      }
    }

    console.log(`\n=================== BACKFILL SUMMARY ===================`);
    console.log(`Total Campaigns Processed: ${campaigns.length}`);
    console.log(`Assignments Created:        ${createdCount}`);
    console.log(`Assignments Skipped:        ${skippedCount}`);
    console.log(`=======================================================`);

  } catch (error) {
    console.error('Error executing backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
