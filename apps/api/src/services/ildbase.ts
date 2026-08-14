import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  insuranceLeadSubmission: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  insuranceActivity: {
    create: vi.fn(),
  },
};

const mockPostToAmeriquote = vi.fn();
const mockMapToAmeriquote = vi.fn();

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

vi.mock('../insurance-lead-config.js', () => ({
  getInsuranceLeadMode: () => 'TEST',
}));

vi.mock('../insurance-lead-mapper.js', () => ({
  mapToAmeriquote: mockMapToAmeriquote,
}));

vi.mock('../insurance-lead-poster.js', () => ({
  postToAmeriquote: mockPostToAmeriquote,
}));

import { deliverInsuranceLeadSubmission } from '../insurance-lead-delivery.js';

describe('deliverInsuranceLeadSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.insuranceLeadSubmission.findFirst.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'tenant-1',
      insuranceLeadId: 'lead-1',
      vertical: 'FE',
      validationStatus: 'VALID',
      postStatus: 'HOLD',
      postMode: 'TEST',
      normalizedPayload: {
        firstName: 'John',
        lastName: 'Doe',
        phone: '6155550100',
      },
      ameriquoteResponseStatus: null,
      ameriquoteLeadId: null,
      ameriquotePrice: null,
      ameriquoteErrorMessage: null,
    });

    mockMapToAmeriquote.mockReturnValue({
      fullPayload: { Key: 'secret', TYPE: '19', Mode: 'full' },
      redactedPayload: { Key: '[REDACTED]', TYPE: '19', Mode: 'full' },
    });

    mockPostToAmeriquote.mockResolvedValue({
      success: true,
      status: 'Matched',
      leadId: 'aq-123',
      price: '25.00',
      rawBody: '{"response":{"status":"Matched"}}',
    });

    mockPrisma.insuranceLeadSubmission.update.mockResolvedValue({});
    mockPrisma.insuranceActivity.create.mockResolvedValue({});
  });

  it('posts a valid HOLD submission and persists the matched result', async () => {
    const result = await deliverInsuranceLeadSubmission('tenant-1', 'lead-1', 'sub-1', {
      trigger: 'AUTO',
    });

    expect(mockPostToAmeriquote).toHaveBeenCalledWith({
      Key: 'secret',
      TYPE: '19',
      Mode: 'full',
    });

    expect(mockPrisma.insuranceLeadSubmission.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        postStatus: 'PENDING',
        postMode: 'TEST',
        mappedOutboundPayload: expect.objectContaining({ Key: '[REDACTED]' }),
      }),
    });

    expect(mockPrisma.insuranceLeadSubmission.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        postStatus: 'MATCHED',
        ameriquoteResponseStatus: 'Matched',
        ameriquoteLeadId: 'aq-123',
        ameriquotePrice: '25.00',
        attemptCount: { increment: 1 },
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        postStatus: 'MATCHED',
        postMode: 'TEST',
        ameriquoteStatus: 'Matched',
        ameriquoteLeadId: 'aq-123',
      })
    );
  });

  it('does not double-count an attempt already recorded by the retry handler', async () => {
    await deliverInsuranceLeadSubmission('tenant-1', 'lead-1', 'sub-1', {
      attemptAlreadyCounted: true,
      trigger: 'RETRY',
    });

    const finalUpdate = mockPrisma.insuranceLeadSubmission.update.mock.calls[1][0];
    expect(finalUpdate.data.attemptCount).toBeUndefined();
  });

  it('refuses to send B2B submissions through the Ameriquote mapping', async () => {
    mockPrisma.insuranceLeadSubmission.findFirst.mockResolvedValueOnce({
      id: 'sub-b2b',
      tenantId: 'tenant-1',
      insuranceLeadId: 'lead-b2b',
      vertical: 'B2B',
      validationStatus: 'VALID',
      postStatus: 'HOLD',
      postMode: 'TEST',
      normalizedPayload: {},
    });

    const result = await deliverInsuranceLeadSubmission('tenant-1', 'lead-b2b', 'sub-b2b');

    expect(result).toEqual({
      error: 'B2B submissions do not have an Ameriquote delivery mapping',
    });
    expect(mockPostToAmeriquote).not.toHaveBeenCalled();
  });
});
