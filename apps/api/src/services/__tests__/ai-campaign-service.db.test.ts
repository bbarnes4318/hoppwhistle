import { describe, it, expect, beforeAll } from 'vitest';
import { getPrismaClient } from '../../lib/prisma.js';
import {
  getRestartUnreachedPreview,
  executeRestartUnreached,
} from '../ai-campaign-service.js';

describe('AI Campaign Service — Real Database-backed Integration Tests', () => {
  let prisma: any;
  let isDbAvailable = false;

  beforeAll(async () => {
    prisma = getPrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch (e) {
      if (process.env.REQUIRE_DB_TESTS === 'true') {
        throw new Error('Database connection failed and REQUIRE_DB_TESTS is set to true');
      }
      console.warn('⚠️ Test database not reachable. Integration tests will be explicitly skipped.');
    }
  });

  it('verifies full database-backed campaign operations', async (ctx) => {
    if (!isDbAvailable) {
      ctx.skip();
      return;
    }

    const tenantId = 'db-test-tenant-1';
    const campaignId = 'db-test-campaign-123';

    // Cleanup any remnant test data
    try {
      await prisma.$executeRaw`DELETE FROM ai_campaign_calls WHERE "campaignId" = ${campaignId}::uuid`;
      await prisma.$executeRaw`DELETE FROM ai_campaign_contacts WHERE "campaignId" = ${campaignId}::uuid`;
      await prisma.$executeRaw`DELETE FROM ai_campaigns WHERE id = ${campaignId}::uuid`;
    } catch (e) {
      // Ignored
    }

    // 1. Create campaign
    await prisma.aICampaign.create({
      data: {
        id: campaignId,
        tenantId,
        name: 'DB Test Campaign',
        status: 'COMPLETED',
        vertical: 'INSURANCE',
        direction: 'OUTBOUND',
        carrier: 'TELNYX',
        agencyName: 'Test Agency',
        transferNumber: '+15555550000',
        maxConcurrent: 1,
        callsPerMinute: 1,
      },
    });

    // 2. Create contacts (never attempted, voicemail, active call)
    const c1 = await prisma.aICampaignContact.create({
      data: {
        campaignId,
        phoneNumber: '+15550000001',
        status: 'PENDING',
      },
    });

    const c2 = await prisma.aICampaignContact.create({
      data: {
        campaignId,
        phoneNumber: '+15550000002',
        status: 'FAILED',
      },
    });

    // Create a call for c2
    const call2 = await prisma.aICampaignCall.create({
      data: {
        campaignId,
        contactId: c2.id,
        status: 'COMPLETED',
        outcome: 'voicemail',
      },
    });

    // Test contact/call foreign key relation
    expect(call2.contactId).toBe(c2.id);

    // Test preview eligibility
    const preview = await getRestartUnreachedPreview(campaignId, tenantId);
    expect(preview.neverAttemptedEligible).toBe(1);
    expect(preview.voicemailEligible).toBe(1);
    expect(preview.totalEligible).toBe(2);

    // Test cross-tenant rejection
    await expect(getRestartUnreachedPreview(campaignId, 'wrong-tenant')).rejects.toThrow('Campaign not found or unauthorized');

    // Test execute update
    const result = await executeRestartUnreached(campaignId, tenantId);
    expect(result.totalEligible).toBe(2);

    const updatedC2 = await prisma.aICampaignContact.findUnique({
      where: { id: c2.id },
    });
    expect(updatedC2?.status).toBe('PENDING');

    // Clean up
    await prisma.$executeRaw`DELETE FROM ai_campaign_calls WHERE "campaignId" = ${campaignId}::uuid`;
    await prisma.$executeRaw`DELETE FROM ai_campaign_contacts WHERE "campaignId" = ${campaignId}::uuid`;
    await prisma.$executeRaw`DELETE FROM ai_campaigns WHERE id = ${campaignId}::uuid`;
  });
});
