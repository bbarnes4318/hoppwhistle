import { Prisma } from '@prisma/client';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Define the mock client
const mockPrisma = {
  $transaction: vi.fn((cb) => cb(mockPrisma)),
  call: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  buyerEndpoint: {
    findMany: vi.fn(),
  },
  pingRequest: {
    findMany: vi.fn(),
  },
  campaignPublisher: {
    findUnique: vi.fn(),
  },
  campaignBuyer: {
    findMany: vi.fn(),
  },
  didRoute: {
    findFirst: vi.fn(),
  },
  phoneNumber: {
    findFirst: vi.fn(),
  },
  accrualLedger: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  buyer: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  buyerTransaction: {
    create: vi.fn(),
  },
};

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue({ success: true }),
}));

// Import services after mocking prisma
import { BillingService } from '../billing-service.js';
import { BuyerBillingService } from '../buyer-billing-service.js';

describe('BillingService Unit Tests', () => {
  let billingService: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    billingService = new BillingService();
  });

  describe('getBillableDuration', () => {
    it('should prefer connectedDuration if present', () => {
      const dur = billingService.getBillableDuration({
        connectedDuration: 45,
        duration: 120,
      });
      expect(dur).toBe(45);
    });

    it('should fall back to duration if connectedDuration is null or undefined', () => {
      const dur1 = billingService.getBillableDuration({
        connectedDuration: null,
        duration: 90,
      });
      expect(dur1).toBe(90);

      const dur2 = billingService.getBillableDuration({
        connectedDuration: undefined,
        duration: 75,
      });
      expect(dur2).toBe(75);
    });

    it('should return 0 if both connectedDuration and duration are missing', () => {
      const dur = billingService.getBillableDuration({
        connectedDuration: null,
        duration: null,
      });
      expect(dur).toBe(0);
    });
  });

  describe('isBillableCall', () => {
    it('should return true if durationUsed is strictly greater than threshold', () => {
      expect(billingService.isBillableCall(61, 60)).toBe(true);
      expect(billingService.isBillableCall(60, 60)).toBe(false);
      expect(billingService.isBillableCall(59, 60)).toBe(false);
    });
  });

  describe('calculateCallBilling', () => {
    const defaultCall = {
      id: 'call-1',
      tenantId: 'tenant-1',
      callSid: 'sid-1',
      callerId: '+18005550199',
      toNumber: '+18005550100',
      did: '+18005550100',
      status: 'COMPLETED',
      connectedDuration: 75,
      duration: 100,
      targetNumber: '+18005550150',
      buyerId: 'buyer-1',
      publisherId: 'pub-1',
      campaignId: 'camp-1',
      cost: null,
      campaign: {
        id: 'camp-1',
        billableDurationSeconds: 60,
        buyerPricePerBillableCall: new Prisma.Decimal('15.00'),
        publisherPayoutPerBillableCall: new Prisma.Decimal('8.00'),
      },
      buyer: {
        id: 'buyer-1',
        billableDuration: 45,
      },
      publisher: {
        id: 'pub-1',
      },
    };

    beforeEach(() => {
      // Setup default mock values
      mockPrisma.call.findUnique.mockResolvedValue(defaultCall);
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([]);
      mockPrisma.pingRequest.findMany.mockResolvedValue([]);
      mockPrisma.campaignPublisher.findUnique.mockResolvedValue(null);
      mockPrisma.campaignBuyer.findMany.mockResolvedValue([]);
      mockPrisma.didRoute.findFirst.mockResolvedValue(null);
      mockPrisma.phoneNumber.findFirst.mockResolvedValue(null);
      mockPrisma.accrualLedger.findFirst.mockResolvedValue(null);
      mockPrisma.accrualLedger.create.mockImplementation((args) => Promise.resolve(args.data));
      mockPrisma.accrualLedger.update.mockImplementation((args) => Promise.resolve(args.data));
      mockPrisma.call.update.mockResolvedValue({});
    });

    it('should return error if call status is INITIATED or RINGING', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        status: 'RINGING',
      });

      const res = await billingService.calculateCallBilling('call-1');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Call is not finalized yet');
    });

    it('should resolve threshold by hierarchy: Campaign -> Buyer -> 60s', async () => {
      // 1. Campaign threshold used (60s)
      let res = await billingService.calculateCallBilling('call-1');
      expect(res.thresholdUsed).toBe(60);

      // 2. Fall back to Buyer threshold (45s)
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        campaign: {
          ...defaultCall.campaign,
          billableDurationSeconds: null,
        },
      });
      res = await billingService.calculateCallBilling('call-1');
      expect(res.thresholdUsed).toBe(45);

      // 3. Fall back to default (60s)
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        campaign: {
          ...defaultCall.campaign,
          billableDurationSeconds: null,
        },
        buyer: {
          ...defaultCall.buyer,
          billableDuration: null,
        },
      });
      res = await billingService.calculateCallBilling('call-1');
      expect(res.thresholdUsed).toBe(60);
    });

    it('should determine call as not billable if connectedDuration <= threshold', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        connectedDuration: 60, // Equal to threshold (60) -> not billable
      });

      const res = await billingService.calculateCallBilling('call-1');
      expect(res.billable).toBe(false);
      expect(res.revenue).toBe('0.0000');
      expect(res.payout).toBe('0.0000');

      expect(mockPrisma.call.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billable: false,
            noPayoutReason: 'BELOW_DURATION_THRESHOLD',
            noConversionReason: 'BELOW_DURATION_THRESHOLD',
          }),
        })
      );
    });

    it('should resolve buyer revenue rate by hierarchy: Winning Bid -> CampaignBuyer override -> Campaign default -> Endpoint fallback', async () => {
      // Setup Buyer Endpoint
      const mockEndpoint = {
        id: 'ep-1',
        destination: '+18005550150',
        basePrice: new Prisma.Decimal('10.00'),
      };
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([mockEndpoint]);

      // 1. Endpoint fallback (no Campaign defaults/overrides/bids)
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        campaign: {
          ...defaultCall.campaign,
          buyerPricePerBillableCall: null,
        },
      });
      let res = await billingService.calculateCallBilling('call-1');
      expect(res.buyerPriceRate).toBe('10.0000');

      // 2. Campaign default
      mockPrisma.call.findUnique.mockResolvedValue(defaultCall);
      res = await billingService.calculateCallBilling('call-1');
      expect(res.buyerPriceRate).toBe('15.0000');

      // 3. CampaignBuyer override
      mockPrisma.campaignBuyer.findMany.mockResolvedValue([
        {
          pricePerBillableCall: new Prisma.Decimal('18.00'),
        },
      ]);
      res = await billingService.calculateCallBilling('call-1');
      expect(res.buyerPriceRate).toBe('18.0000');

      // 4. Winning RTB bid
      mockPrisma.pingRequest.findMany.mockResolvedValue([
        {
          id: 'ping-1',
          callerNumber: '+18005550199',
          status: 'SOLD',
          assignedPhoneNumber: { number: '+18005550100' },
          bids: [
            {
              buyerId: 'buyer-1',
              buyerEndpointId: 'ep-1',
              amount: new Prisma.Decimal('22.50'),
            },
          ],
        },
      ]);
      res = await billingService.calculateCallBilling('call-1');
      expect(res.buyerPriceRate).toBe('22.5000');
    });

    it('should resolve publisher payout by hierarchy: CampaignPublisher override -> Campaign default -> Publisher rule', async () => {
      // 1. Campaign default
      let res = await billingService.calculateCallBilling('call-1');
      expect(res.publisherPayoutRate).toBe('8.0000');

      // 2. CampaignPublisher override
      mockPrisma.campaignPublisher.findUnique.mockResolvedValue({
        payoutPerBillableCall: new Prisma.Decimal('9.50'),
      });
      res = await billingService.calculateCallBilling('call-1');
      expect(res.publisherPayoutRate).toBe('9.5000');
    });

    it('should estimate carrier cost if null and save cost source', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        cost: null, // trigger estimation
      });
      
      // Default rate $0.015/min * 100 seconds (duration fallback) = 0.025
      const res = await billingService.calculateCallBilling('call-1');
      expect(res.profit).toBeDefined();

      expect(mockPrisma.call.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cost: expect.any(Object), // Decimal
          }),
        })
      );
    });

    it('should insert accrual ledger entries idempotently', async () => {
      let createdTypes: string[] = [];
      mockPrisma.accrualLedger.create.mockImplementation((args) => {
        createdTypes.push(args.data.type);
        return Promise.resolve(args.data);
      });

      await billingService.calculateCallBilling('call-1');
      
      expect(createdTypes).toContain('BUYER_REVENUE');
      expect(createdTypes).toContain('PUBLISHER_PAYOUT');
      expect(createdTypes).toContain('CARRIER_COST');
      expect(createdTypes).toContain('PLATFORM_PROFIT');

      // Test idempotency: if ledger entries already exist, it should update them
      mockPrisma.accrualLedger.findFirst.mockResolvedValue({
        id: 'ledger-entry-1',
        amount: new Prisma.Decimal('10.00'),
      });

      await billingService.calculateCallBilling('call-1');
      expect(mockPrisma.accrualLedger.update).toHaveBeenCalled();
    });
  });
});

describe('BuyerBillingService Unit Tests', () => {
  let buyerBillingService: BuyerBillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    buyerBillingService = new BuyerBillingService();
  });

  describe('processCallBilling', () => {
    const defaultBuyer = {
      id: 'buyer-1',
      name: 'Test Upfront Buyer',
      billingType: 'UPFRONT',
      walletBalance: new Prisma.Decimal('100.00'),
      leadsRemaining: 100,
      status: 'ACTIVE',
    };

    const defaultCall = {
      id: 'call-1',
      tenantId: 'tenant-1',
      buyerId: 'buyer-1',
      billable: true,
      buyerChargeStatus: 'PENDING',
      buyerBillableAmount: new Prisma.Decimal('15.50'),
      buyer: defaultBuyer,
    };

    beforeEach(() => {
      mockPrisma.call.findUnique.mockResolvedValue(defaultCall);
      mockPrisma.buyer.update.mockResolvedValue({});
      mockPrisma.buyerTransaction.create.mockResolvedValue({});
      mockPrisma.call.update.mockResolvedValue({});
    });

    it('should deduct dollar wallet balance, record transaction, and sync leadsRemaining', async () => {
      const res = await buyerBillingService.processCallBilling('call-1');

      expect(res.success).toBe(true);
      expect(res.deducted).toBe(true);
      expect(res.walletBalance).toBe(84.50); // 100.00 - 15.50
      expect(res.leadsRemaining).toBe(84); // Math.floor(84.50)

      expect(mockPrisma.buyer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'buyer-1' },
          data: expect.objectContaining({
            walletBalance: expect.any(Object), // Decimal
            leadsRemaining: 84,
          }),
        })
      );

      expect(mockPrisma.buyerTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buyerId: 'buyer-1',
            type: 'DEBIT',
            amount: expect.any(Object), // Decimal
          }),
        })
      );
    });

    it('should auto-pause buyer if wallet balance falls <= 0', async () => {
      mockPrisma.call.findUnique.mockResolvedValue({
        ...defaultCall,
        buyerBillableAmount: new Prisma.Decimal('120.00'), // charges more than wallet balance
      });

      const res = await buyerBillingService.processCallBilling('call-1');

      expect(res.deducted).toBe(false);
      expect(res.reason).toBe('Insufficient wallet balance');

      expect(mockPrisma.buyer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'buyer-1' },
          data: { status: 'PAUSED' },
        })
      );
    });
  });

  describe('addCredits', () => {
    const defaultBuyer = {
      id: 'buyer-1',
      name: 'Test Buyer',
      walletBalance: new Prisma.Decimal('10.00'),
      leadsRemaining: 10,
      status: 'PAUSED',
    };

    beforeEach(() => {
      mockPrisma.buyer.findUnique.mockResolvedValue(defaultBuyer);
      mockPrisma.buyer.update.mockResolvedValue({});
      mockPrisma.buyerTransaction.create.mockResolvedValue({});
    });

    it('should add amount to walletBalance, sync leadsRemaining, and reactivate if PAUSED', async () => {
      const res = await buyerBillingService.addCredits('buyer-1', 50.50, 'admin-1', 'Deposit');

      expect(res.success).toBe(true);
      expect(res.newBalance).toBe(60.50); // 10.00 + 50.50

      expect(mockPrisma.buyer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'buyer-1' },
          data: expect.objectContaining({
            walletBalance: expect.any(Object), // Decimal
            leadsRemaining: 60, // Math.floor(60.50)
            status: 'ACTIVE', // Reactivated
          }),
        })
      );

      expect(mockPrisma.buyerTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buyerId: 'buyer-1',
            type: 'CREDIT',
            amount: expect.any(Object),
          }),
        })
      );
    });
  });
});
