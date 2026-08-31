import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { announceSkip, databaseGate } from '../../__tests__/helpers/live-services.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { getRestartUnreachedPreview, executeRestartUnreached } from '../ai-campaign-service.js';

// Reads and writes real rows, so it uses the same gate as the other
// database-backed suites rather than silently passing against no database.
const gate = databaseGate();
announceSkip('AI Campaign Service (database-backed)', gate);

describe.skipIf(!gate.available)('AI Campaign Service — Real Database-backed Integration Tests', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  // executeRestartUnreached casts the campaign id to ::uuid in raw SQL, so the
  // fixture has to use real UUIDs even though the column is text.
  const tenantId = randomUUID();
  const campaignId = randomUUID();
  const phoneNumberId = randomUUID();

  beforeAll(async () => {
    prisma = getPrismaClient();

    // AICampaign requires a PhoneNumber from the tenant's inventory, and
    // PhoneNumber has a foreign key to Tenant, so both have to exist first.
    await prisma.tenant.create({
      data: { id: tenantId, name: 'AI Campaign Test Tenant', slug: `ai-campaign-test-${tenantId}` },
    });

    await prisma.phoneNumber.create({
      data: { id: phoneNumberId, tenantId, number: '+15555559999' },
    });
  });

  afterAll(async () => {
    // The tenant cascades to the phone number; the campaign does not hang off
    // it (tenantId there is a bare string), so it goes explicitly.
    await prisma.aICampaign.deleteMany({ where: { id: campaignId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('verifies full database-backed campaign operations', async () => {
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
        phoneNumberId,
        maxConcurrent: 1,
        callsPerMinute: 1,
      },
    });

    // 2. Create contacts (never attempted, voicemail, active call)
    await prisma.aICampaignContact.create({
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

    // Create a call for c2. This is the shape handleCallEnded writes for a
    // voicemail: its outcomeMap turns endedReason 'voicemail' into status
    // VOICEMAIL, and stores the endedReason as the outcome. The fixture used
    // to say status COMPLETED, which classifyCall reads as UNKNOWN -- COMPLETED
    // returns early, before the outcome === 'voicemail' rule is ever reached --
    // so the contact was excluded rather than eligible.
    const call2 = await prisma.aICampaignCall.create({
      data: {
        campaignId,
        contactId: c2.id,
        status: 'VOICEMAIL',
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
    await expect(getRestartUnreachedPreview(campaignId, randomUUID())).rejects.toThrow(
      'Campaign not found or unauthorized'
    );

    // Test execute update
    const result = await executeRestartUnreached(campaignId, tenantId);
    expect(result.totalEligible).toBe(2);

    const updatedC2 = await prisma.aICampaignContact.findUnique({
      where: { id: c2.id },
    });
    expect(updatedC2?.status).toBe('PENDING');
  });
});
