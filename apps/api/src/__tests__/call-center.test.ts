import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerCallCenterRoutes } from '../routes/call-center.js';

// Define the mock client
const mockPrisma = {
  insuranceLead: {
    findMany: vi.fn(),
  },
  lead: {
    findMany: vi.fn(),
  },
  prospectIntake: {
    findMany: vi.fn(),
  },
  call: {
    findMany: vi.fn(),
  },
};

vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

describe('Call Center Lookup API', () => {
  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = Fastify();
    
    // Setup simple auth decorator
    app.addHook('onRequest', async (request: any) => {
      request.user = { tenantId: 'test-tenant-id' };
    });
    
    void app.register(registerCallCenterRoutes);
  });

  it('should normalize phone to last 10 digits and perform lookups', async () => {
    mockPrisma.insuranceLead.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.prospectIntake.findMany.mockResolvedValue([]);
    mockPrisma.call.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/call-center/customer-lookup?phone=1+ (555) 019-9988',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customer).toBeNull();
    
    // Verify last-10-digit matching was passed to prisma
    expect(mockPrisma.insuranceLead.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'test-tenant-id',
        phone: { endsWith: '5550199988' },
      },
      include: expect.any(Object),
    });
  });

  it('should prefer InsuranceLead as canonical match and list duplicates', async () => {
    const mockLead1 = {
      id: 'lead-1',
      vertical: 'FE',
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      phone: '5550199988',
      email: 'jane@doe.com',
      status: 'NEW',
      doNotCall: false,
      submissions: [],
      activities: [],
      tasks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockIntake = {
      id: 'intake-1',
      phone: '5550199988',
      firstName: 'Duplicate',
      lastName: 'User',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.insuranceLead.findMany.mockResolvedValue([mockLead1]);
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.prospectIntake.findMany.mockResolvedValue([mockIntake]);
    mockPrisma.call.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/call-center/customer-lookup?phone=5550199988',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customer).not.toBeNull();
    expect(body.customer.id).toBe('lead-1');
    expect(body.customer.recordType).toBe('InsuranceLead');
    
    // Duplicate includes the prospect intake
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0].id).toBe('intake-1');
    expect(body.duplicates[0].recordType).toBe('ProspectIntake');
  });

  it('should mask banking fields if prospect intake is matched', async () => {
    const mockIntake = {
      id: 'intake-1',
      phone: '5550199988',
      firstName: 'Duplicate',
      lastName: 'User',
      routingNumber: '123456789',
      accountNumber: '987654321',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.insuranceLead.findMany.mockResolvedValue([]);
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.prospectIntake.findMany.mockResolvedValue([mockIntake]);
    mockPrisma.call.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/call-center/customer-lookup?phone=5550199988',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.customer.recordType).toBe('ProspectIntake');
    // Banking details should not be in the returned customer record
    expect(body.customer.routingNumber).toBeUndefined();
    expect(body.customer.accountNumber).toBeUndefined();
  });
});
