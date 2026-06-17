import { Decimal } from '@prisma/client/runtime/library';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Define the mock client
const mockPrisma = {
  insuranceLead: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  insuranceLeadSubmission: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  insuranceActivity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  insuranceTask: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocking
import { ingestLead, retrySubmission } from '../insurance-lead-service.js';
import { postToAmeriquote } from '../insurance-lead-poster.js';

describe('Insurance Lead CRM Services', () => {
  beforeEach(() => {
    process.env.AMERIQUOTE_API_KEY = 'mock-key';
    vi.clearAllMocks();
  });

  describe('Ameriquote Blocked Posting / Retries', () => {
    it('should fail-safe and throw an error directly in postToAmeriquote', async () => {
      await expect(postToAmeriquote({})).rejects.toThrow('Ameriquote delivery is disabled by owner request.');
    });

    it('should update status to HOLD and return a disabled status on retrySubmission without posting', async () => {
      const mockSubmission = {
        id: 'sub-1',
        tenantId: 'tenant-1',
        insuranceLeadId: 'lead-1',
        validationStatus: 'VALID',
        postStatus: 'PENDING',
        postMode: 'TEST',
        receivedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.insuranceLeadSubmission.findFirst.mockResolvedValue(mockSubmission);
      mockPrisma.insuranceLeadSubmission.update.mockResolvedValue({
        ...mockSubmission,
        postStatus: 'HOLD',
      });
      mockPrisma.insuranceActivity.create.mockResolvedValue({});

      const result = await retrySubmission('tenant-1', 'lead-1', 'sub-1');

      expect(result).toEqual({
        success: false,
        postStatus: 'HOLD',
        disabled: true,
        message: 'Ameriquote delivery is disabled by owner request.',
      });

      expect(mockPrisma.insuranceLeadSubmission.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          postStatus: 'HOLD',
          ameriquoteErrorMessage: 'Ameriquote delivery is disabled by owner request.',
        }),
      });

      expect(mockPrisma.insuranceActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SUBMISSION',
            title: 'Ameriquote Post Blocked',
          }),
        })
      );
    });
  });

  describe('HOLD Ingestion status & activities', () => {
    it('should ingest valid leads, set postStatus to HOLD, and create activity timeline entries', async () => {
      const mockLead = { id: 'lead-1', createdAt: new Date(), updatedAt: new Date() };
      const mockSub = { id: 'sub-1', receivedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };

      mockPrisma.insuranceLead.findFirst.mockResolvedValue(null);
      mockPrisma.insuranceLead.create.mockResolvedValue(mockLead);
      mockPrisma.insuranceLeadSubmission.create.mockResolvedValue(mockSub);
      mockPrisma.insuranceLeadSubmission.update.mockResolvedValue({});
      mockPrisma.insuranceActivity.create.mockResolvedValue({});

      const validFEPayload = {
        firstName: 'John',
        lastName: 'Doe',
        phone: '1234567890',
        email: 'john.doe@example.com',
        address: '123 Main St',
        city: 'Nashville',
        state: 'TN',
        zipCode: '37211',
        birthDate: '01/01/1980',
        gender: 'Male',
      };

      const result = await ingestLead('tenant-1', 'FE', validFEPayload);

      expect(result.validationStatus).toBe('VALID');
      expect(result.postStatus).toBe('HOLD');

      expect(mockPrisma.insuranceLead.create).toHaveBeenCalled();
      expect(mockPrisma.insuranceLeadSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            postStatus: 'HOLD',
          }),
        })
      );

      // Check activity logging: Lead Ingested (SYSTEM), Submission Received (SUBMISSION), Lead Held (SYSTEM)
      expect(mockPrisma.insuranceActivity.create).toHaveBeenCalledTimes(3);
    });
  });
});
