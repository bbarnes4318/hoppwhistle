/* eslint-disable @typescript-eslint/no-explicit-any -- a fake Prisma client, answering exactly the queries the report makes */
import { Prisma } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The call-money arithmetic, pinned.
 *
 * `/api/v1/reports/campaign-profitability` and `/api/v1/call-sales/summary`
 * both read revenue, publisher payout, call cost and the accrual-ledger fees
 * off the same calls. They share one implementation
 * (`services/reporting/call-money.ts`) so the two screens cannot disagree, and
 * moving the report onto it must not move a single figure the report already
 * answered.
 *
 * The expected bodies below were captured from the report as it was BEFORE the
 * arithmetic moved, on this exact fixture, and are compared byte for byte.
 */

const TENANT = 'tenant-money';

const d = (value: string | number) => new Prisma.Decimal(value);

/** Three campaigns, one with no campaign at all, disputes, fees and a zero-revenue call. */
const CALLS = [
  {
    id: 'c1',
    campaignId: 'camp-a',
    campaignName: 'Final Expense',
    billable: true,
    buyerBillableAmount: d('45.0000'),
    publisherPayoutAmount: d('20.0000'),
    cost: d('0.3100'),
    connectedDuration: 184,
    disputeStatus: null,
  },
  {
    id: 'c2',
    campaignId: 'camp-a',
    campaignName: 'Final Expense (renamed)',
    billable: false,
    buyerBillableAmount: d('0'),
    publisherPayoutAmount: d('0'),
    cost: d('0.0400'),
    connectedDuration: 12,
    disputeStatus: null,
  },
  {
    id: 'c3',
    campaignId: 'camp-b',
    campaignName: 'Medicare',
    billable: true,
    buyerBillableAmount: d('60.5000'),
    publisherPayoutAmount: d('30.2500'),
    cost: d('0.4425'),
    connectedDuration: 420,
    disputeStatus: 'OPEN',
  },
  {
    id: 'c4',
    campaignId: 'camp-b',
    campaignName: 'Medicare',
    billable: true,
    buyerBillableAmount: d('60.5000'),
    publisherPayoutAmount: d('30.2500'),
    cost: null,
    connectedDuration: 0,
    disputeStatus: null,
  },
  {
    id: 'c5',
    campaignId: null,
    campaignName: null,
    billable: false,
    buyerBillableAmount: null,
    publisherPayoutAmount: null,
    cost: d('0.0100'),
    connectedDuration: null,
    disputeStatus: null,
  },
];

const LEDGER = [
  { callId: 'c1', type: 'RECORDING_FEE', amount: d('0.0500') },
  { callId: 'c1', type: 'CONNECTION_FEE', amount: d('0.1000') },
  { callId: 'c3', type: 'DISPUTE_HOLD', amount: d('-60.5000') },
  { callId: 'c3', type: 'ADJUSTMENT', amount: d('-5.0000') },
  { callId: 'c4', type: 'ADJUSTMENT', amount: d('2.2500') },
  { callId: 'c5', type: 'CONNECTION_FEE', amount: d('0.0200') },
  // A ledger row with no call is ignored.
  { callId: null, type: 'ADJUSTMENT', amount: d('99') },
];

const fakePrisma = {
  user: { findUnique: vi.fn(async () => null) },
  call: { findMany: vi.fn(async () => CALLS) },
  accrualLedger: { findMany: vi.fn(async () => LEDGER) },
};

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => fakePrisma }));

/** The report's JSON body before the refactor, captured on the fixture above. */
const EXPECTED_JSON =
  '{"totals":{"totalCalls":5,"connectedCalls":3,"billableCalls":3,"buyerRevenue":"166.0000","publisherPayout":"80.5000","callCost":"0.8025","otherCosts":"0.1700","profit":"84.5275","margin":0.5092018072289156,"disputes":"60.5000","disputesCount":1,"adjustments":"-2.7500","netPayableReceivable":"81.7775"},"rows":[{"campaignId":"camp-a","campaignName":"Final Expense","totalCalls":2,"connectedCalls":2,"billableCalls":1,"buyerRevenue":"45.0000","publisherPayout":"20.0000","callCost":"0.3500","otherCosts":"0.1500","profit":"24.5000","margin":0.5444444444444444,"disputes":"0.0000","disputesCount":0,"adjustments":"0.0000","netPayableReceivable":"24.5000"},{"campaignId":"camp-b","campaignName":"Medicare","totalCalls":2,"connectedCalls":1,"billableCalls":2,"buyerRevenue":"121.0000","publisherPayout":"60.5000","callCost":"0.4425","otherCosts":"0.0000","profit":"60.0575","margin":0.4963429752066116,"disputes":"60.5000","disputesCount":1,"adjustments":"-2.7500","netPayableReceivable":"57.3075"},{"campaignId":"unknown","campaignName":"Unknown Campaign","totalCalls":1,"connectedCalls":0,"billableCalls":0,"buyerRevenue":"0.0000","publisherPayout":"0.0000","callCost":"0.0100","otherCosts":"0.0200","profit":"-0.0300","margin":0,"disputes":"0.0000","disputesCount":0,"adjustments":"0.0000","netPayableReceivable":"-0.0300"}]}';

/** The CSV export before the refactor, captured on the fixture above. */
const EXPECTED_CSV = [
  'Campaign,Total Calls,Connected Calls,Billable Calls,Buyer Revenue ($),Publisher Payout ($),Carrier Cost ($),Other Costs ($),Gross Profit ($),Margin (%),Disputes ($),Adjustments ($),Net Payable/Receivable ($)',
  'Final Expense,2,2,1,45.0000,20.0000,0.3500,0.1500,24.5000,54.44%,0.0000,0.0000,24.5000',
  'Medicare,2,1,2,121.0000,60.5000,0.4425,0.0000,60.0575,49.63%,60.5000,-2.7500,57.3075',
  'Unknown Campaign,1,0,0,0.0000,0.0000,0.0100,0.0200,-0.0300,0.00%,0.0000,0.0000,-0.0300',
  'Report Totals,5,3,3,166.0000,80.5000,0.8025,0.1700,84.5275,50.92%,60.5000,-2.7500,81.7775',
].join('\n');

describe('campaign profitability, on the shared call-money arithmetic', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRequest', async request => {
      (request as { user?: unknown }).user = { tenantId: TENANT, roles: ['OWNER'] };
    });
    const { registerReportingRoutes } = await import('../routes/index.js');
    await app.register(registerReportingRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the report byte for byte as it did before the refactor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/campaign-profitability?startDate=2026-09-01&endDate=2026-09-30',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(EXPECTED_JSON);
  });

  it('exports the CSV byte for byte as it did before the refactor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/campaign-profitability/export.csv?startDate=2026-09-01&endDate=2026-09-30',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(EXPECTED_CSV);
  });

  it('scopes both queries to the acting tenant', () => {
    for (const call of fakePrisma.call.findMany.mock.calls as any[]) {
      expect(call[0].where.tenantId).toBe(TENANT);
    }
    for (const call of fakePrisma.accrualLedger.findMany.mock.calls as any[]) {
      expect(call[0].where.tenantId).toBe(TENANT);
    }
  });
});
