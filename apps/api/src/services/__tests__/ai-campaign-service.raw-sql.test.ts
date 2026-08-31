import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { announceSkip, databaseGate } from '../../__tests__/helpers/live-services.js';
import { getPrismaClient } from '../../lib/prisma.js';
import {
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  uploadContacts,
  getContacts,
  startCampaign,
  pauseCampaign,
  handleVapiWebhook,
  getCampaignStats,
  getCalls,
} from '../ai-campaign-service.js';

/**
 * Every function in ai-campaign-service that reaches Postgres through raw SQL.
 *
 * The service compares text id columns against a ::uuid-cast parameter, which
 * Postgres rejects outright -- there is no text = uuid operator, and the schema
 * declares no uuid columns anywhere. Each case here drives one exported
 * function against a real database, so the failure is the endpoint's real
 * behaviour rather than an inference from reading the SQL.
 */
const gate = databaseGate();
announceSkip('AI Campaign Service (raw SQL)', gate);

describe.skipIf(!gate.available)('AI Campaign Service — raw SQL against a real database', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  const tenantId = randomUUID();
  const phoneNumberId = randomUUID();
  // Unique per run: vapi_templates.vertical is a unique column shared by the
  // whole database, so a fixed value would collide with a parallel suite.
  const TEST_VERTICAL = `RAW_SQL_TEST_${randomUUID().slice(0, 8)}`;
  let campaignId: string;

  beforeAll(async () => {
    prisma = getPrismaClient();
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Raw SQL Test Tenant', slug: `raw-sql-test-${tenantId}` },
    });
    await prisma.phoneNumber.create({
      data: { id: phoneNumberId, tenantId, number: '+15555558888' },
    });
    // handleCallEnded bills the call through deductFromWallet, which updates
    // this row. A real tenant has one; without it the webhook throws on the
    // billing step after the call row is already written.
    await prisma.tenantBudget.create({
      data: { tenantId, monthlyBudget: 500, alertEmails: [] },
    });
    // createCampaign resolves a template by vertical before it inserts.
    // The vertical column is unique, so this is upserted rather than created.
    await prisma.vapiTemplate.upsert({
      where: { vertical: TEST_VERTICAL },
      update: {},
      create: {
        name: 'Raw SQL Test Template',
        vertical: TEST_VERTICAL,
        basePrompt: 'You are an agent for {{agencyName}}.',
        firstMessage: 'Hello from {{agencyName}}.',
      },
    });
  });

  afterAll(async () => {
    await prisma.aICampaign.deleteMany({ where: { tenantId } });
    await prisma.vapiTemplate.deleteMany({ where: { vertical: TEST_VERTICAL } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  beforeEach(async () => {
    campaignId = randomUUID();
    await prisma.aICampaign.create({
      data: {
        id: campaignId,
        tenantId,
        name: 'Raw SQL Campaign',
        status: 'DRAFT',
        vertical: 'INSURANCE',
        agencyName: 'Test Agency',
        transferNumber: '+15555550000',
        phoneNumberId,
      },
    });
  });

  // listCampaigns is the control: it goes through the ORM, never touched raw
  // SQL, and passed even before this fix. It is the reason the feature looked
  // alive -- the campaign list rendered.
  describe('listCampaigns (the one path that always worked)', () => {
    it("returns the tenant's campaigns", async () => {
      const result = await listCampaigns(tenantId);
      expect(result.meta.total).toBeGreaterThan(0);
    });
  });

  // createCampaign's own INSERT has no cast and always succeeded. What failed
  // was the re-fetch on the way out: it calls getCampaign to pick up the
  // vapiAssistantId, and that carried the cast. So POST /api/v1/ai-campaigns
  // wrote the row and then threw, handing the caller a 500 for a campaign that
  // now existed. A retry made another one.
  describe('createCampaign', () => {
    it('inserts a campaign and returns it', async () => {
      const created = await createCampaign({
        tenantId,
        name: 'Control Group Campaign',
        vertical: TEST_VERTICAL,
        agencyName: 'Test Agency',
        transferNumber: '+15555550000',
        filters: {},
        phoneNumberId,
      });
      expect(created.id).toBeDefined();
      expect(created.name).toBe('Control Group Campaign');

      // The row the caller was handed is the row in the database. Before the
      // fix the row existed but the caller never saw it.
      const persisted = await prisma.aICampaign.findUnique({ where: { id: created.id } });
      expect(persisted?.name).toBe('Control Group Campaign');
    });
  });

  describe('getCampaign', () => {
    it('finds a campaign by id and tenant', async () => {
      const campaign = await getCampaign(campaignId, tenantId);
      expect(campaign?.id).toBe(campaignId);
    });

    it('returns null for another tenant', async () => {
      expect(await getCampaign(campaignId, randomUUID())).toBeNull();
    });
  });

  describe('updateCampaign', () => {
    it('renames a campaign', async () => {
      const updated = await updateCampaign(campaignId, tenantId, { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
    });
  });

  describe('uploadContacts', () => {
    it('imports contacts, skips duplicates, and promotes DRAFT to READY', async () => {
      const first = await uploadContacts({
        campaignId,
        contacts: [{ phoneNumber: '+15550001111' }, { phoneNumber: '+15550002222' }],
      });
      expect(first.imported).toBe(2);

      // The duplicate check is its own query, so it needs its own assertion.
      const second = await uploadContacts({
        campaignId,
        contacts: [{ phoneNumber: '+15550001111' }],
      });
      expect(second.imported).toBe(0);
      expect(second.skipped).toBe(1);

      expect((await getCampaign(campaignId, tenantId))?.status).toBe('READY');
    });
  });

  describe('getContacts', () => {
    beforeEach(async () => {
      await uploadContacts({
        campaignId,
        contacts: [{ phoneNumber: '+15550003333' }, { phoneNumber: '+15550004444' }],
      });
    });

    it('lists contacts without a status filter', async () => {
      const result = await getContacts(campaignId);
      expect(result.meta.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('lists contacts with a status filter', async () => {
      // A separate branch of the function, with its own pair of queries.
      const result = await getContacts(campaignId, 1, 50, 'PENDING');
      expect(result.meta.total).toBe(2);
    });
  });

  describe('startCampaign', () => {
    it('refuses a campaign with no pending contacts', async () => {
      // Reaching this error means the pending-contact count query ran. Before
      // that query could run at all, the call died on the cast instead.
      await expect(startCampaign(campaignId, tenantId)).rejects.toThrow(
        'No pending contacts to call'
      );
    });
  });

  describe('pauseCampaign', () => {
    it('moves a campaign to PAUSED', async () => {
      const paused = await pauseCampaign(campaignId, tenantId);
      expect(paused.status).toBe('PAUSED');
    });
  });

  describe('handleVapiWebhook', () => {
    it('marks a call IN_PROGRESS on call-started', async () => {
      const contact = await prisma.aICampaignContact.create({
        data: { campaignId, phoneNumber: '+15550005555', status: 'PENDING' },
      });
      const call = await prisma.aICampaignCall.create({
        data: { campaignId, contactId: contact.id, status: 'QUEUED' },
      });

      await handleVapiWebhook({
        message: {
          type: 'call-started',
          call: { id: 'vapi-1', status: 'in-progress', metadata: { callRecordId: call.id } },
        },
      });

      const updated = await prisma.aICampaignCall.findUnique({ where: { id: call.id } });
      expect(updated?.status).toBe('IN_PROGRESS');
    });

    it('records the outcome on call-ended', async () => {
      const contact = await prisma.aICampaignContact.create({
        data: { campaignId, phoneNumber: '+15550006666', status: 'PENDING' },
      });
      const call = await prisma.aICampaignCall.create({
        data: { campaignId, contactId: contact.id, status: 'IN_PROGRESS' },
      });

      await handleVapiWebhook({
        message: {
          type: 'call-ended',
          call: {
            id: 'vapi-2',
            status: 'ended',
            endedReason: 'customer-ended-call',
            duration: 60,
            metadata: { callRecordId: call.id },
          },
        },
      });

      const updated = await prisma.aICampaignCall.findUnique({ where: { id: call.id } });
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.outcome).toBe('customer-ended-call');
    });
  });

  describe('getCampaignStats', () => {
    it('aggregates contact, call and cost stats', async () => {
      await uploadContacts({ campaignId, contacts: [{ phoneNumber: '+15550007777' }] });
      const stats = await getCampaignStats(campaignId);
      expect(stats).toBeDefined();
    });
  });

  describe('getCalls', () => {
    it('lists calls for a campaign', async () => {
      const contact = await prisma.aICampaignContact.create({
        data: { campaignId, phoneNumber: '+15550008888', status: 'PENDING' },
      });
      await prisma.aICampaignCall.create({
        data: { campaignId, contactId: contact.id, status: 'COMPLETED' },
      });

      const result = await getCalls(campaignId);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('deleteCampaign', () => {
    it('deletes a campaign', async () => {
      await deleteCampaign(campaignId, tenantId);
      expect(await getCampaign(campaignId, tenantId)).toBeNull();
    });
  });
});
