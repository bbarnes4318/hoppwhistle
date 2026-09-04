/**
 * The delivery report is registered under `/api/v1/insurance-leads/...`, which
 * already has a `/:id` route on it. If the router ever prefers the parametric
 * match, "delivery-report" is read as a lead id and the report silently becomes
 * a 404 — so the routing itself is asserted here, through a real Fastify
 * instance, alongside the CSV rendering the export depends on.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  insuranceLead: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  insuranceLeadSubmission: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { registerInsuranceLeadRoutes } from '../insurance-leads.js';

const TENANT = 'tenant-1';

interface ReportBody {
  summary: { accepted: number; notAccepted: number; notSent: number };
  rows: Array<{ outcomeLabel: string; reason: string }>;
}

interface ErrorBody {
  error: { code: string; message: string };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  // Reproduction of the demo-tenant hook the production server installs.
  app.addHook('onRequest', (request, _reply, done) => {
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    if (demoTenantId) (request as { user?: unknown }).user = { tenantId: demoTenantId };
    done();
  });
  await registerInsuranceLeadRoutes(app);
  await app.ready();
  return app;
}

function submissionRow() {
  return {
    id: 'sub-1',
    insuranceLeadId: 'lead-1',
    vertical: 'ACA',
    source: 'csv-import',
    receivedAt: new Date('2026-09-01T12:00:00.000Z'),
    postedAt: new Date('2026-09-01T12:00:05.000Z'),
    lastAttemptAt: new Date('2026-09-01T12:00:05.000Z'),
    attemptCount: 1,
    postMode: 'LIVE',
    postStatus: 'ERROR',
    validationStatus: 'VALID',
    validationErrors: null,
    ameriquoteResponseStatus: 'Error',
    ameriquoteLeadId: null,
    ameriquotePrice: null,
    ameriquoteErrorMessage: 'Filter failure: Primary_Phone is on the DNC list',
    insuranceLead: {
      firstName: 'Dana',
      lastName: 'Reyes',
      fullName: null,
      phone: '5551234567',
      email: 'dana@example.com',
      state: 'FL',
      zipCode: '33101',
      list: { name: 'September ACA' },
    },
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.insuranceLeadSubmission.findMany.mockResolvedValue([submissionRow()]);
  mockPrisma.insuranceLeadSubmission.count.mockResolvedValue(1);
  mockPrisma.insuranceLeadSubmission.groupBy.mockResolvedValue([
    { postStatus: 'ERROR', _count: { _all: 1 } },
  ]);
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/insurance-leads/delivery-report', () => {
  it('is not swallowed by the /:id route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    expect(response.statusCode).toBe(200);
    // The /:id handler reads a single lead; this one reads submissions.
    expect(mockPrisma.insuranceLead.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.insuranceLeadSubmission.findMany).toHaveBeenCalled();
  });

  it('reports the outcome and the buyer’s reason for each lead', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    const body = response.json<ReportBody>();
    expect(body.summary.notAccepted).toBe(1);
    expect(body.rows[0].outcomeLabel).toBe('Not accepted');
    expect(body.rows[0].reason).toContain('DNC list');
  });

  it('sends a downloadable CSV when asked for one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report?format=csv&startDate=2026-09-01&endDate=2026-09-04',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="ameriquote_delivery_report_2026-09-01_to_2026-09-04.csv"'
    );
    expect(response.body.split('\r\n')[0]).toContain('Outcome,Reason,');
    expect(response.body).toContain('Not accepted');
    expect(response.body).toContain('DNC list');
  });

  it('exports the whole filtered range rather than one page', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report?format=csv&page=3&limit=10',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    const call = mockPrisma.insuranceLeadSubmission.findMany.mock.calls[0] as unknown as [
      { take: number; skip: number },
    ];
    const args = call[0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50000);
  });

  it('refuses an outcome it does not understand instead of ignoring the filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report?outcome=maybe',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    // Silently widening "not accepted" to "everything" is how a clean report
    // gets mistaken for a clean run.
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('INVALID_OUTCOME');
  });

  it('requires a tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads/delivery-report',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/insurance-leads?format=csv', () => {
  it('exports the CRM grid as a CSV carrying the last delivery outcome', async () => {
    mockPrisma.insuranceLead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        vertical: 'ACA',
        firstName: 'Dana',
        lastName: 'Reyes',
        fullName: null,
        phone: '5551234567',
        email: 'dana@example.com',
        state: 'FL',
        zipCode: '33101',
        source: 'csv-import',
        status: 'NEW',
        leadStage: null,
        nextFollowUpAt: null,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
        submissions: [
          {
            id: 'sub-1',
            receivedAt: new Date('2026-09-01T12:00:00.000Z'),
            validationStatus: 'VALID',
            postStatus: 'MATCHED',
            postMode: 'LIVE',
            ameriquoteResponseStatus: 'Matched',
            source: 'csv-import',
          },
        ],
      },
    ]);
    mockPrisma.insuranceLead.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/insurance-leads?format=csv&vertical=aca',
      headers: { 'x-demo-tenant-id': TENANT },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('crm_leads_');
    const [header, row] = response.body.split('\r\n');
    expect(header).toContain('Last Delivery Outcome');
    expect(row).toContain('Dana');
    expect(row).toContain('Accepted');
  });
});
