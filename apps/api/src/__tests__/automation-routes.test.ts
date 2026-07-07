/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- tests assert over parsed JSON responses and vi.fn mock call records, which are dynamically typed */
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────
const mockPrisma = {
  insuranceCarrierApplication: {
    create: vi.fn(),
    update: vi.fn(),
  },
  apiKey: {
    findUnique: vi.fn(),
  },
};

vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

const mockRunAutomation = vi.fn();
vi.mock('../services/carrier-rpa/american-amicable.js', () => ({
  runAmericanAmicableAutomation: (...args: unknown[]) => mockRunAutomation(...args),
}));

import { registerAutomationRoutes } from '../routes/automation.js';

// ── Helpers ──────────────────────────────────────────────────────────────
const TENANT_HEADER = { 'x-demo-tenant-id': 'tenant-a' };

const validPayload = {
  firstName: 'John',
  lastName: 'Doe',
  dob: '1960-01-15',
  gender: 'M',
  tobacco: 'no',
  state: 'IL',
  address: '123 Main St',
  city: 'Chicago',
  zip: '60601',
  phone: '(312) 555-0100',
  weight: 180,
  height: '5\'9"',
  selectedCoverage: 15000,
  selectedPlanType: 'Level',
  beneficiaryName: 'Jane Doe',
  beneficiaryRelation: 'Spouse',
  bankName: 'Chase',
  bankCityState: 'Chicago, IL',
  routingNumber: '071000013',
  accountNumber: '123456789',
  ssn: '123-45-6789',
  draftDay: '15',
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(registerAutomationRoutes);
  return app;
}

describe('Automation routes (American Amicable RPA)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.insuranceCarrierApplication.create.mockResolvedValue({ id: 'app-1' });
    mockPrisma.insuranceCarrierApplication.update.mockResolvedValue({ id: 'app-1' });
    mockRunAutomation.mockResolvedValue({
      success: true,
      applicationNumber: 'M001234567',
    });
  });

  it('rejects unauthenticated requests with 401 and does not start the RPA', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(mockRunAutomation).not.toHaveBeenCalled();
    expect(mockPrisma.insuranceCarrierApplication.create).not.toHaveBeenCalled();
  });

  it('returns 400 for missing required fields and never launches Puppeteer', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/automation/american-amicable/run',
      headers: TENANT_HEADER,
      payload: { firstName: 'OnlyFirst' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.errors).toContain('Last Name is required');
    expect(mockRunAutomation).not.toHaveBeenCalled();
    expect(mockPrisma.insuranceCarrierApplication.create).not.toHaveBeenCalled();
  });

  it('returns jobId immediately without waiting for the automation to finish', async () => {
    let rpaResolved = false;
    let resolveRpa: (value: unknown) => void = () => {};
    mockRunAutomation.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRpa = (value: unknown) => {
            rpaResolved = true;
            resolve(value);
          };
        })
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });

    // The HTTP response must arrive while the RPA promise is still pending
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.jobId).toMatch(/^job_/);
    expect(body.applicationId).toBe('app-1');
    expect(rpaResolved).toBe(false);

    resolveRpa({ success: true, applicationNumber: 'M001234567' });
    await vi.waitFor(() => {
      const completed = mockPrisma.insuranceCarrierApplication.update.mock.calls.some(
        call => call[0]?.data?.automationStatus === 'COMPLETED'
      );
      expect(completed).toBe(true);
    });
  });

  it('persists the application with encrypted sensitive fields and no plaintext SSN', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/automation/american-amicable/run',
      headers: TENANT_HEADER,
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(mockPrisma.insuranceCarrierApplication.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.insuranceCarrierApplication.create.mock.calls[0][0];
    const data = createArg.data;

    expect(data.tenantId).toBe('tenant-a');
    expect(data.firstName).toBe('John');
    expect(data.state).toBe('Illinois');
    expect(data.ssnEncrypted).toMatch(/^enc:v1:/);
    expect(data.ssnLast4).toBe('6789');
    expect(data.routingNumberEncrypted).toMatch(/^enc:v1:/);
    expect(data.accountNumberEncrypted).toMatch(/^enc:v1:/);

    // No plaintext sensitive values anywhere in the created record
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('123456789');
    expect(serialized).not.toContain('071000013');
  });

  it('persists carrierApplicationNumber and COMPLETED on success', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });

    await vi.waitFor(() => {
      const completedCall = mockPrisma.insuranceCarrierApplication.update.mock.calls.find(
        call => call[0]?.data?.automationStatus === 'COMPLETED'
      );
      expect(completedCall).toBeDefined();
      expect(completedCall![0].where).toEqual({ id: 'app-1' });
      expect(completedCall![0].data.carrierApplicationNumber).toBe('M001234567');
    });
  });

  it('persists FAILED with a sanitized error when the automation fails', async () => {
    mockRunAutomation.mockResolvedValue({
      success: false,
      error: 'Could not type account 123456789012 into field',
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });
    expect(response.statusCode).toBe(200); // still returns immediately

    await vi.waitFor(() => {
      const failedCall = mockPrisma.insuranceCarrierApplication.update.mock.calls.find(
        call => call[0]?.data?.automationStatus === 'FAILED'
      );
      expect(failedCall).toBeDefined();
      const error = failedCall![0].data.automationError as string;
      expect(error).not.toContain('123456789012');
      expect(error).toContain('[REDACTED-DIGITS]');
    });
  });

  it('persists FAILED when the automation throws', async () => {
    mockRunAutomation.mockRejectedValue(new Error('Automation crashed hard'));

    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });

    await vi.waitFor(() => {
      const failedCall = mockPrisma.insuranceCarrierApplication.update.mock.calls.find(
        call => call[0]?.data?.automationStatus === 'FAILED'
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].data.automationError).toContain('Automation crashed hard');
    });
  });

  it('returns historical job steps from the result and SSE status endpoints', async () => {
    const app = await buildApp();
    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });
    const { jobId } = JSON.parse(runResponse.body);

    // Wait for the mocked automation chain to finish
    await vi.waitFor(async () => {
      const result = await app.inject({
        method: 'GET',
        url: `/api/automation/result/${jobId}`,
        headers: TENANT_HEADER,
      });
      expect(JSON.parse(result.body).status).toBe('completed');
    });

    const resultResponse = await app.inject({
      method: 'GET',
      url: `/api/automation/result/${jobId}`,
      headers: TENANT_HEADER,
    });
    const result = JSON.parse(resultResponse.body);
    expect(result.jobId).toBe(jobId);
    expect(result.applicationNumber).toBe('M001234567');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0].message).toBe('Job queued in background');

    // SSE endpoint streams the historical steps then closes (job is terminal)
    const sseResponse = await app.inject({
      method: 'GET',
      url: `/api/automation/status/${jobId}`,
      headers: TENANT_HEADER,
    });
    expect(sseResponse.statusCode).toBe(200);
    expect(sseResponse.headers['content-type']).toContain('text/event-stream');
    expect(sseResponse.body).toContain('data:');
    expect(sseResponse.body).toContain('Job queued in background');
    expect(sseResponse.body).toContain('completed');

    // v1 alias returns the same job
    const v1Response = await app.inject({
      method: 'GET',
      url: `/api/v1/automation/jobs/${jobId}`,
      headers: TENANT_HEADER,
    });
    expect(JSON.parse(v1Response.body).applicationNumber).toBe('M001234567');
  });

  it('scopes jobs to the owning tenant', async () => {
    const app = await buildApp();
    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });
    const { jobId } = JSON.parse(runResponse.body);

    const otherTenant = await app.inject({
      method: 'GET',
      url: `/api/automation/result/${jobId}`,
      headers: { 'x-demo-tenant-id': 'tenant-b' },
    });
    expect(otherTenant.statusCode).toBe(404);
  });

  it('never echoes raw SSN/banking values in the run response or job payloads', async () => {
    const app = await buildApp();
    const runResponse = await app.inject({
      method: 'POST',
      url: '/api/automation/run-carrier-app',
      headers: TENANT_HEADER,
      payload: validPayload,
    });
    expect(runResponse.body).not.toContain('123456789');

    const { jobId } = JSON.parse(runResponse.body);
    await vi.waitFor(async () => {
      const result = await app.inject({
        method: 'GET',
        url: `/api/automation/result/${jobId}`,
        headers: TENANT_HEADER,
      });
      expect(JSON.parse(result.body).status).toBe('completed');
    });

    const resultResponse = await app.inject({
      method: 'GET',
      url: `/api/automation/result/${jobId}`,
      headers: TENANT_HEADER,
    });
    expect(resultResponse.body).not.toContain('123456789');
    expect(resultResponse.body).not.toContain('071000013');
  });
});
