import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { quotaService } from '../services/quota-service.js';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: vi.fn(),
}));

// Mock audit service
vi.mock('../services/audit.js', () => ({
  auditLog: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
}));

describe('Quota Service', () => {
  const mockPrisma = {
    tenant: {
      findUnique: vi.fn(),
    },
    call: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    phoneNumber: {
      count: vi.fn(),
    },
    tenantBudget: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    budgetAlert: {
      create: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getPrismaClient as any).mockReturnValue(mockPrisma);
  });

  describe('checkConcurrentCalls', () => {
    it('should allow calls when quota is disabled', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: false },
        budget: null,
        quotaOverrides: [],
      });

      const result = await quotaService.checkConcurrentCalls('tenant-1');
      expect(result.allowed).toBe(true);
    });

    it('should allow calls when under limit', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxConcurrentCalls: 10 },
        budget: null,
        quotaOverrides: [],
      });
      mockPrisma.call.count.mockResolvedValue(5);

      const result = await quotaService.checkConcurrentCalls('tenant-1');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(5);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(5);
    });

    it('should block calls when limit exceeded', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxConcurrentCalls: 10 },
        budget: null,
        quotaOverrides: [],
      });
      mockPrisma.call.count.mockResolvedValue(10);

      const result = await quotaService.checkConcurrentCalls('tenant-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Concurrent call limit exceeded');
      expect(result.current).toBe(10);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it('should allow calls with valid override token', async () => {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxConcurrentCalls: 10 },
        budget: {
          overrideToken: 'valid-token',
          overrideTokenExpiresAt: expiresAt,
        },
        quotaOverrides: [],
      });

      const result = await quotaService.checkConcurrentCalls('tenant-1', 'valid-token');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Override token used');
    });

    it('should block calls with expired override token', async () => {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() - 1); // Expired

      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxConcurrentCalls: 10 },
        budget: {
          overrideToken: 'expired-token',
          overrideTokenExpiresAt: expiresAt,
        },
        quotaOverrides: [],
      });
      mockPrisma.call.count.mockResolvedValue(10);

      const result = await quotaService.checkConcurrentCalls('tenant-1', 'expired-token');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Override token expired');
    });
  });

  describe('checkDailyMinutes', () => {
    it('should allow calls when under daily minute limit', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxMinutesPerDay: 1000 },
        quotaOverrides: [],
      });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      mockPrisma.call.findMany.mockResolvedValue([
        { duration: 300 }, // 5 minutes
        { duration: 600 }, // 10 minutes
      ]);

      const result = await quotaService.checkDailyMinutes('tenant-1', 5);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(15); // 15 minutes used
      expect(result.remaining).toBe(985);
    });

    it('should block calls when daily minute limit exceeded', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        quota: { enabled: true, maxMinutesPerDay: 100 },
        quotaOverrides: [],
      });

      mockPrisma.call.findMany.mockResolvedValue([
        { duration: 5400 }, // 90 minutes
      ]);

      const result = await quotaService.checkDailyMinutes('tenant-1', 15);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily minute limit exceeded');
    });
  });

  describe('checkBudget', () => {
    it('should allow calls when under daily budget', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        budget: {
          enabled: true,
          dailyBudget: 100,
          monthlyBudget: 1000,
          currentDaySpend: 50,
          currentMonthSpend: 500,
          hardStopEnabled: true,
          overrideToken: null,
          overrideTokenExpiresAt: null,
        },
      });

      const result = await quotaService.checkBudget('tenant-1', 10);
      expect(result.allowed).toBe(true);
    });

    it('should block calls when daily budget exceeded with hard stop', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        budget: {
          enabled: true,
          dailyBudget: 100,
          monthlyBudget: 1000,
          currentDaySpend: 95,
          currentMonthSpend: 500,
          hardStopEnabled: true,
          overrideToken: null,
          overrideTokenExpiresAt: null,
        },
      });

      const result = await quotaService.checkBudget('tenant-1', 10);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily budget exceeded');
    });

    it('should allow calls when monthly budget exceeded but hard stop disabled', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        budget: {
          enabled: true,
          dailyBudget: null,
          monthlyBudget: 1000,
          currentDaySpend: 0,
          currentMonthSpend: 1100,
          hardStopEnabled: false,
          overrideToken: null,
          overrideTokenExpiresAt: null,
        },
      });

      const result = await quotaService.checkBudget('tenant-1', 10);
      expect(result.allowed).toBe(true);
    });
  });
});

