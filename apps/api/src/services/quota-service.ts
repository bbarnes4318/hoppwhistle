import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { auditLog } from './audit.js';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  remaining?: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
  percentage?: number;
}

/**
 * Quota Service
 * 
 * Enforces per-tenant quotas and budgets to prevent runaway spend.
 */
export class QuotaService {
  /**
   * Check if tenant can make a new call (concurrent calls quota)
   */
  async checkConcurrentCalls(
    tenantId: string,
    overrideToken?: string
  ): Promise<QuotaCheckResult> {
    const prisma = getPrismaClient();

    // Get tenant quota
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        quota: true,
        budget: true,
        quotaOverrides: {
          where: {
            quotaType: 'concurrent_calls',
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!tenant) {
      return { allowed: false, reason: 'Tenant not found' };
    }

    // Check override token if provided
    if (overrideToken && tenant.budget?.overrideToken === overrideToken) {
      if (tenant.budget.overrideTokenExpiresAt && tenant.budget.overrideTokenExpiresAt < new Date()) {
        return { allowed: false, reason: 'Override token expired' };
      }
      await auditLog({
        tenantId,
        action: 'quota.override.used',
        entityType: 'QuotaOverride',
        resource: 'concurrent_calls',
        ipAddress: 'system',
        success: true,
      });
      return { allowed: true, reason: 'Override token used' };
    }

    // Check if quotas are enabled
    if (!tenant.quota?.enabled) {
      return { allowed: true };
    }

    // Check override
    const override = tenant.quotaOverrides.find(o => o.quotaType === 'concurrent_calls');
    const maxConcurrent = override?.overrideValue ?? tenant.quota.maxConcurrentCalls;

    if (!maxConcurrent) {
      return { allowed: true }; // No limit set
    }

    // Count active calls
    const activeCalls = await prisma.call.count({
      where: {
        tenantId,
        status: {
          in: ['INITIATED', 'RINGING', 'ANSWERED'],
        },
      },
    });

    if (activeCalls >= maxConcurrent) {
      await auditLog({
        tenantId,
        action: 'quota.exceeded',
        entityType: 'Quota',
        resource: 'concurrent_calls',
        changes: {
          current: activeCalls,
          limit: maxConcurrent,
        },
        ipAddress: 'system',
        success: false,
      });

      return {
        allowed: false,
        reason: `Concurrent call limit exceeded: ${activeCalls}/${maxConcurrent}`,
        current: activeCalls,
        limit: maxConcurrent,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      current: activeCalls,
      limit: maxConcurrent,
      remaining: maxConcurrent - activeCalls,
    };
  }

  /**
   * Check if tenant has remaining minutes for today
   */
  async checkDailyMinutes(
    tenantId: string,
    estimatedMinutes: number = 1,
    overrideToken?: string
  ): Promise<QuotaCheckResult> {
    const prisma = getPrismaClient();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        quota: true,
        quotaOverrides: {
          where: {
            quotaType: 'minutes_per_day',
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!tenant) {
      return { allowed: false, reason: 'Tenant not found' };
    }

    // Check override token
    if (overrideToken && tenant.budget?.overrideToken === overrideToken) {
      if (tenant.budget.overrideTokenExpiresAt && tenant.budget.overrideTokenExpiresAt < new Date()) {
        return { allowed: false, reason: 'Override token expired' };
      }
      return { allowed: true, reason: 'Override token used' };
    }

    if (!tenant.quota?.enabled) {
      return { allowed: true };
    }

    const override = tenant.quotaOverrides.find(o => o.quotaType === 'minutes_per_day');
    const maxMinutes = override?.overrideValue ?? tenant.quota.maxMinutesPerDay;

    if (!maxMinutes) {
      return { allowed: true };
    }

    // Calculate today's minutes
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayCalls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
        duration: { not: null },
      },
      select: { duration: true },
    });

    const todayMinutes = todayCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / 60;

    if (todayMinutes + estimatedMinutes > maxMinutes) {
      await auditLog({
        tenantId,
        action: 'quota.exceeded',
        entityType: 'Quota',
        resource: 'minutes_per_day',
        changes: {
          current: todayMinutes,
          limit: maxMinutes,
          estimated: estimatedMinutes,
        },
        ipAddress: 'system',
        success: false,
      });

      return {
        allowed: false,
        reason: `Daily minute limit exceeded: ${todayMinutes.toFixed(2)}/${maxMinutes}`,
        current: Math.ceil(todayMinutes),
        limit: maxMinutes,
        remaining: Math.max(0, maxMinutes - Math.ceil(todayMinutes)),
      };
    }

    return {
      allowed: true,
      current: Math.ceil(todayMinutes),
      limit: maxMinutes,
      remaining: Math.max(0, maxMinutes - Math.ceil(todayMinutes)),
    };
  }

  /**
   * Check if tenant can purchase/assign a new phone number
   */
  async checkPhoneNumberQuota(
    tenantId: string,
    overrideToken?: string
  ): Promise<QuotaCheckResult> {
    const prisma = getPrismaClient();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        quota: true,
        quotaOverrides: {
          where: {
            quotaType: 'phone_numbers',
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!tenant) {
      return { allowed: false, reason: 'Tenant not found' };
    }

    if (overrideToken && tenant.budget?.overrideToken === overrideToken) {
      if (tenant.budget.overrideTokenExpiresAt && tenant.budget.overrideTokenExpiresAt < new Date()) {
        return { allowed: false, reason: 'Override token expired' };
      }
      return { allowed: true, reason: 'Override token used' };
    }

    if (!tenant.quota?.enabled) {
      return { allowed: true };
    }

    const override = tenant.quotaOverrides.find(o => o.quotaType === 'phone_numbers');
    const maxNumbers = override?.overrideValue ?? tenant.quota.maxPhoneNumbers;

    if (!maxNumbers) {
      return { allowed: true };
    }

    const currentNumbers = await prisma.phoneNumber.count({
      where: {
        tenantId,
        status: 'ACTIVE',
      },
    });

    if (currentNumbers >= maxNumbers) {
      await auditLog({
        tenantId,
        action: 'quota.exceeded',
        entityType: 'Quota',
        resource: 'phone_numbers',
        changes: {
          current: currentNumbers,
          limit: maxNumbers,
        },
        ipAddress: 'system',
        success: false,
      });

      return {
        allowed: false,
        reason: `Phone number limit exceeded: ${currentNumbers}/${maxNumbers}`,
        current: currentNumbers,
        limit: maxNumbers,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      current: currentNumbers,
      limit: maxNumbers,
      remaining: maxNumbers - currentNumbers,
    };
  }

  /**
   * Check budget limits
   */
  async checkBudget(
    tenantId: string,
    estimatedCost: number,
    overrideToken?: string
  ): Promise<BudgetCheckResult> {
    const prisma = getPrismaClient();

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { budget: true },
    });

    if (!tenant || !tenant.budget || !tenant.budget.enabled) {
      return { allowed: true };
    }

    const budget = tenant.budget;

    // Check override token
    if (overrideToken && budget.overrideToken === overrideToken) {
      if (budget.overrideTokenExpiresAt && budget.overrideTokenExpiresAt < new Date()) {
        return { allowed: false, reason: 'Override token expired' };
      }
      await auditLog({
        tenantId,
        action: 'budget.override.used',
        entityType: 'BudgetOverride',
        resource: 'budget',
        ipAddress: 'system',
        success: true,
      });
      return { allowed: true, reason: 'Override token used' };
    }

    // Check daily budget
    if (budget.dailyBudget) {
      const dailyTotal = Number(budget.currentDaySpend) + estimatedCost;
      if (dailyTotal > Number(budget.dailyBudget)) {
        if (budget.hardStopEnabled) {
          await auditLog({
            tenantId,
            action: 'budget.exceeded',
            entityType: 'Budget',
            resource: 'daily_budget',
            changes: {
              current: Number(budget.currentDaySpend),
              limit: Number(budget.dailyBudget),
              estimated: estimatedCost,
            },
            ipAddress: 'system',
            success: false,
          });

          return {
            allowed: false,
            reason: `Daily budget exceeded: $${Number(budget.currentDaySpend).toFixed(2)}/$${Number(budget.dailyBudget).toFixed(2)}`,
            current: Number(budget.currentDaySpend),
            limit: Number(budget.dailyBudget),
            percentage: (dailyTotal / Number(budget.dailyBudget)) * 100,
          };
        }
      }
    }

    // Check monthly budget
    if (budget.monthlyBudget) {
      const monthlyTotal = Number(budget.currentMonthSpend) + estimatedCost;
      if (monthlyTotal > Number(budget.monthlyBudget)) {
        if (budget.hardStopEnabled) {
          await auditLog({
            tenantId,
            action: 'budget.exceeded',
            entityType: 'Budget',
            resource: 'monthly_budget',
            changes: {
              current: Number(budget.currentMonthSpend),
              limit: Number(budget.monthlyBudget),
              estimated: estimatedCost,
            },
            ipAddress: 'system',
            success: false,
          });

          return {
            allowed: false,
            reason: `Monthly budget exceeded: $${Number(budget.currentMonthSpend).toFixed(2)}/$${Number(budget.monthlyBudget).toFixed(2)}`,
            current: Number(budget.currentMonthSpend),
            limit: Number(budget.monthlyBudget),
            percentage: (monthlyTotal / Number(budget.monthlyBudget)) * 100,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Record call cost and update budget
   */
  async recordCallCost(
    tenantId: string,
    cost: number,
    callId: string
  ): Promise<void> {
    const prisma = getPrismaClient();

    const budget = await prisma.tenantBudget.findUnique({
      where: { tenantId },
    });

    if (!budget || !budget.enabled) {
      return;
    }

    // Update daily and monthly spend
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Check if we need to reset daily spend (new day)
    const lastUpdate = budget.updatedAt;
    const lastUpdateStart = new Date(lastUpdate.getFullYear(), lastUpdate.getMonth(), lastUpdate.getDate());

    let dailySpend = Number(budget.currentDaySpend);
    if (todayStart > lastUpdateStart) {
      dailySpend = 0; // New day, reset
    }

    // Check if we need to reset monthly spend (new month)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(lastUpdate.getFullYear(), lastUpdate.getMonth(), 1);

    let monthlySpend = Number(budget.currentMonthSpend);
    if (monthStart > lastMonthStart) {
      monthlySpend = 0; // New month, reset
    }

    await prisma.tenantBudget.update({
      where: { tenantId },
      data: {
        currentDaySpend: dailySpend + cost,
        currentMonthSpend: monthlySpend + cost,
      },
    });

    // Check if we need to send alerts
    await this.checkAndSendAlerts(tenantId, budget.id);
  }

  /**
   * Check budget thresholds and send alerts if needed
   */
  private async checkAndSendAlerts(tenantId: string, budgetId: string): Promise<void> {
    const prisma = getPrismaClient();
    const { budgetAlertService } = await import('./budget-alert-service.js');

    const budget = await prisma.tenantBudget.findUnique({
      where: { id: budgetId },
    });

    if (!budget || !budget.enabled) {
      return;
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Check daily budget alerts
    if (budget.dailyBudget) {
      const dailyPercentage = (Number(budget.currentDaySpend) / Number(budget.dailyBudget)) * 100;
      const threshold = Number(budget.alertThreshold);

      if (dailyPercentage >= threshold && dailyPercentage < 100) {
        // Threshold alert
        if (!budget.lastAlertSentAt || budget.lastAlertSentAt < oneHourAgo || budget.lastAlertType !== 'DAILY_THRESHOLD') {
          await budgetAlertService.sendAlert(tenantId, budgetId, 'DAILY_THRESHOLD', {
            threshold,
            actual: dailyPercentage,
            current: Number(budget.currentDaySpend),
            limit: Number(budget.dailyBudget),
          });
        }
      } else if (dailyPercentage >= 100) {
        // Exceeded alert
        if (!budget.lastAlertSentAt || budget.lastAlertSentAt < oneHourAgo || budget.lastAlertType !== 'DAILY_EXCEEDED') {
          await budgetAlertService.sendAlert(tenantId, budgetId, 'DAILY_EXCEEDED', {
            threshold: 100,
            actual: dailyPercentage,
            current: Number(budget.currentDaySpend),
            limit: Number(budget.dailyBudget),
          });
        }
      }
    }

    // Check monthly budget alerts
    if (budget.monthlyBudget) {
      const monthlyPercentage = (Number(budget.currentMonthSpend) / Number(budget.monthlyBudget)) * 100;
      const threshold = Number(budget.alertThreshold);

      if (monthlyPercentage >= threshold && monthlyPercentage < 100) {
        if (!budget.lastAlertSentAt || budget.lastAlertSentAt < oneHourAgo || budget.lastAlertType !== 'MONTHLY_THRESHOLD') {
          await budgetAlertService.sendAlert(tenantId, budgetId, 'MONTHLY_THRESHOLD', {
            threshold,
            actual: monthlyPercentage,
            current: Number(budget.currentMonthSpend),
            limit: Number(budget.monthlyBudget),
          });
        }
      } else if (monthlyPercentage >= 100) {
        if (!budget.lastAlertSentAt || budget.lastAlertSentAt < oneHourAgo || budget.lastAlertType !== 'MONTHLY_EXCEEDED') {
          await budgetAlertService.sendAlert(tenantId, budgetId, 'MONTHLY_EXCEEDED', {
            threshold: 100,
            actual: monthlyPercentage,
            current: Number(budget.currentMonthSpend),
            limit: Number(budget.monthlyBudget),
          });
        }
      }
    }
  }
}

export const quotaService = new QuotaService();

