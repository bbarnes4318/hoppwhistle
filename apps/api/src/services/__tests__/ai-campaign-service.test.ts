import { describe, it, expect, beforeEach, vi } from 'vitest';

// Let's create an in-memory database store to act as a database back-end
let campaigns: any[] = [];
let contacts: any[] = [];
let calls: any[] = [];
let dncEntries: any[] = [];

// Helper to reset database
function resetDatabase() {
  campaigns = [];
  contacts = [];
  calls = [];
  dncEntries = [];
}

const mockPrisma = {
  aICampaign: {
    findFirst: vi.fn(async (args) => {
      const { id, tenantId } = args.where;
      return campaigns.find(c => c.id === id && (!tenantId || c.tenantId === tenantId)) || null;
    }),
    update: vi.fn(async (args) => {
      const { id } = args.where;
      const data = args.data;
      const campaign = campaigns.find(c => c.id === id);
      if (campaign) {
        Object.assign(campaign, data);
      }
      return campaign;
    }),
  },
  aICampaignContact: {
    findMany: vi.fn(async (args) => {
      const { campaignId } = args.where;
      const matched = contacts.filter(c => c.campaignId === campaignId);
      // Include relation calls sorted by startedAt desc
      return matched.map(contact => {
        const contactCalls = calls
          .filter(c => c.contactId === contact.id)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return {
          ...contact,
          calls: contactCalls,
        };
      });
    }),
    updateMany: vi.fn(async (args) => {
      const { id } = args.where;
      const idsToUpdate = id && id.in ? id.in : [];
      const data = args.data;
      let count = 0;
      contacts.forEach(c => {
        if (idsToUpdate.includes(c.id)) {
          Object.assign(c, data);
          count++;
        }
      });
      return { count };
    }),
  },
  $transaction: vi.fn(async (cb) => {
    return await cb(mockPrisma);
  }),
  $queryRaw: vi.fn(async (query, ...params) => {
    const queryStr = typeof query === 'string' ? query : query.join('');
    if (queryStr.includes('FOR UPDATE')) {
      const campaignId = params[0];
      const tenantId = params[1];
      const campaign = campaigns.find(c => c.id === campaignId && (!tenantId || c.tenantId === tenantId));
      if (!campaign) return [];
      return [{ id: campaign.id, status: campaign.status, archivedAt: campaign.archivedAt }];
    }
    return [];
  }),
  $executeRaw: vi.fn(async () => {
    return 1;
  }),
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

// Mock compliance service using checkDnc helper that queries our in-memory DNC entries
const mockComplianceService = {
  checkDnc: vi.fn(async (tenantId: string, phoneNumber: string, campaignId?: string) => {
    const isBlocked = dncEntries.some(
      e => e.phoneNumber === phoneNumber && e.tenantId === tenantId
    );
    if (isBlocked) {
      return { blocked: true, match: { listId: 'list-1', listName: 'DNC List' } };
    }
    return { blocked: false };
  }),
};
vi.mock('../compliance-service.js', () => ({
  complianceService: mockComplianceService,
}));

// Import after mocks are set up
import {
  classifyCall,
  getRestartUnreachedPreview,
  executeRestartUnreached,
} from '../ai-campaign-service.js';

describe('AI Campaign Service — Unit Tests (In-Memory Simulator)', () => {
  beforeEach(() => {
    resetDatabase();
    vi.clearAllMocks();
  });

  describe('classifyCall', () => {
    it('should classify customer-ended-call as HUMAN_REACHED', () => {
      expect(classifyCall({ status: 'COMPLETED', outcome: 'customer-ended-call' })).toBe('HUMAN_REACHED');
    });

    it('should classify assistant-ended-call as ASSISTANT_ENDED', () => {
      expect(classifyCall({ status: 'COMPLETED', outcome: 'assistant-ended-call' })).toBe('ASSISTANT_ENDED');
    });

    it('should classify COMPLETED with null/unknown outcome as UNKNOWN (ambiguous)', () => {
      expect(classifyCall({ status: 'COMPLETED', outcome: null })).toBe('UNKNOWN');
      expect(classifyCall({ status: 'COMPLETED', outcome: 'unknown-reason' })).toBe('UNKNOWN');
    });

    it('should classify voicemail as VOICEMAIL', () => {
      expect(classifyCall({ status: 'VOICEMAIL', outcome: 'voicemail' })).toBe('VOICEMAIL');
      expect(classifyCall({ status: 'FAILED', outcome: 'voicemail' })).toBe('VOICEMAIL');
    });

    it('should classify customer-did-not-answer and no-answer as NO_ANSWER', () => {
      expect(classifyCall({ status: 'NO_ANSWER', outcome: 'customer-did-not-answer' })).toBe('NO_ANSWER');
      expect(classifyCall({ status: 'NO_ANSWER', outcome: 'no-answer' })).toBe('NO_ANSWER');
    });

    it('should classify busy outcomes as BUSY', () => {
      expect(classifyCall({ status: 'BUSY', outcome: 'customer-busy' })).toBe('BUSY');
      expect(classifyCall({ status: 'BUSY', outcome: 'busy' })).toBe('BUSY');
    });

    it('should classify failed, silence-timeout, and error outcomes as FAILED', () => {
      expect(classifyCall({ status: 'FAILED', outcome: 'failed-to-connect' })).toBe('FAILED');
      expect(classifyCall({ status: 'FAILED', outcome: 'silence-timeout' })).toBe('FAILED');
      expect(classifyCall({ status: 'FAILED', outcome: 'error' })).toBe('FAILED');
    });
  });

  describe('Database Backed End-to-End Scenarios', () => {
    const tenantId = 'tenant-abc';
    const campaignId = 'camp-123';

    beforeEach(() => {
      // Seed campaign
      campaigns.push({
        id: campaignId,
        tenantId,
        status: 'COMPLETED',
        archivedAt: null,
      });
    });

    it('should report and restart never attempted contacts correctly', async () => {
      contacts.push({
        id: 'c-1',
        campaignId,
        phoneNumber: '+15555550001',
        status: 'PENDING',
        metadata: {},
      });

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.neverAttemptedEligible).toBe(1);
      expect(preview.totalEligible).toBe(1);

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(1);
      expect(contacts[0].status).toBe('PENDING');
      expect(campaigns[0].status).toBe('READY');
    });

    it('should exclude customer ended call (human reached) and assistant ended call (assistant ended)', async () => {
      contacts.push(
        { id: 'c-cust', campaignId, phoneNumber: '+15555550002', status: 'COMPLETED', metadata: {} },
        { id: 'c-asst', campaignId, phoneNumber: '+15555550003', status: 'COMPLETED', metadata: {} }
      );
      calls.push(
        { id: 'call-1', contactId: 'c-cust', campaignId, status: 'COMPLETED', outcome: 'customer-ended-call', startedAt: new Date() },
        { id: 'call-2', contactId: 'c-asst', campaignId, status: 'COMPLETED', outcome: 'assistant-ended-call', startedAt: new Date() }
      );

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.humanReachedExcluded).toBe(1); // Only customer-ended-call is HUMAN_REACHED
      expect(preview.totalEligible).toBe(0); // Both are ineligible

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(0);
    });

    it('should include voicemail, no answer, busy, silence timeout, and failed connection as eligible', async () => {
      contacts.push(
        { id: 'c-vm', campaignId, phoneNumber: '+15555550004', status: 'FAILED', metadata: {} },
        { id: 'c-na', campaignId, phoneNumber: '+15555550005', status: 'NO_ANSWER', metadata: {} },
        { id: 'c-by', campaignId, phoneNumber: '+15555550006', status: 'FAILED', metadata: {} },
        { id: 'c-st', campaignId, phoneNumber: '+15555550007', status: 'FAILED', metadata: {} },
        { id: 'c-fc', campaignId, phoneNumber: '+15555550008', status: 'FAILED', metadata: {} }
      );
      calls.push(
        { id: 'call-3', contactId: 'c-vm', campaignId, status: 'VOICEMAIL', outcome: 'voicemail', startedAt: new Date() },
        { id: 'call-4', contactId: 'c-na', campaignId, status: 'NO_ANSWER', outcome: 'customer-did-not-answer', startedAt: new Date() },
        { id: 'call-5', contactId: 'c-by', campaignId, status: 'BUSY', outcome: 'customer-busy', startedAt: new Date() },
        { id: 'call-6', contactId: 'c-st', campaignId, status: 'FAILED', outcome: 'silence-timeout', startedAt: new Date() },
        { id: 'call-7', contactId: 'c-fc', campaignId, status: 'FAILED', outcome: 'failed-to-connect', startedAt: new Date() }
      );

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.voicemailEligible).toBe(1);
      expect(preview.noAnswerEligible).toBe(1);
      expect(preview.busyEligible).toBe(1);
      expect(preview.failedOrSilenceEligible).toBe(2);
      expect(preview.totalEligible).toBe(5);

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(5);
      expect(contacts.every(c => c.status === 'PENDING')).toBe(true);
    });

    it('should exclude unknown completed outcome (legacy ambiguous records)', async () => {
      contacts.push({ id: 'c-unk', campaignId, phoneNumber: '+15555550009', status: 'COMPLETED', metadata: {} });
      calls.push({ id: 'call-8', contactId: 'c-unk', campaignId, status: 'COMPLETED', outcome: null, startedAt: new Date() });

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.totalEligible).toBe(0);

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(0);
      expect(contacts[0].status).toBe('COMPLETED'); // Unchanged
    });

    it('should exclude contacts placed on DNC or wrong numbers', async () => {
      contacts.push(
        { id: 'c-dnc', campaignId, phoneNumber: '+15555550010', status: 'PENDING', metadata: {} },
        { id: 'c-wn', campaignId, phoneNumber: '+15555550011', status: 'FAILED', metadata: { wrongNumber: true } }
      );
      // Place c-dnc on DNC list
      dncEntries.push({ phoneNumber: '+15555550010', tenantId, type: 'GLOBAL' });

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.dncExcluded).toBe(1);
      expect(preview.wrongNumberExcluded).toBe(1);
      expect(preview.totalEligible).toBe(0);

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(0);
    });

    it('should exclude contacts with active calls (QUEUED, RINGING, IN_PROGRESS)', async () => {
      contacts.push({ id: 'c-act', campaignId, phoneNumber: '+15555550012', status: 'CALLING', metadata: {} });
      calls.push({ id: 'call-9', contactId: 'c-act', campaignId, status: 'IN_PROGRESS', outcome: null, startedAt: new Date() });

      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.activeCallExcluded).toBe(1);
      expect(preview.totalEligible).toBe(0);

      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(0);
    });

    it('should prevent DNC contacts from being restarted when added to DNC after preview', async () => {
      contacts.push({ id: 'c-post-dnc', campaignId, phoneNumber: '+15555550013', status: 'FAILED', metadata: {} });
      calls.push({ id: 'call-10', contactId: 'c-post-dnc', campaignId, status: 'NO_ANSWER', outcome: 'no-answer', startedAt: new Date() });

      // 1. Run preview (eligible)
      const preview = await getRestartUnreachedPreview(campaignId, tenantId);
      expect(preview.totalEligible).toBe(1);

      // 2. Add to DNC list post-preview
      dncEntries.push({ phoneNumber: '+15555550013', tenantId, type: 'GLOBAL' });

      // 3. Execute restart (excluded)
      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result.totalEligible).toBe(0);
      expect(result.dncExcluded).toBe(1);
      expect(contacts[0].status).toBe('FAILED'); // Still FAILED, not reset to PENDING
    });

    it('should enforce tenant ownership (cross-tenant access)', async () => {
      await expect(getRestartUnreachedPreview(campaignId, 'different-tenant')).rejects.toThrow('Campaign not found');
      await expect(executeRestartUnreached(campaignId, 'different-tenant')).rejects.toThrow('Campaign not found');
    });

    it('should use raw row-locking to serialize two simultaneous restart requests', async () => {
      // Execute the restart
      const result = await executeRestartUnreached(campaignId, tenantId);
      expect(result).toBeDefined();

      // Verify that FOR UPDATE locking query was indeed dispatched
      expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
        campaignId,
        tenantId
      );
    });
  });
});
