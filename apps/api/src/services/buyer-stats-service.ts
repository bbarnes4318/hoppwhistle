/**
 * Buyer Stats Service
 *
 * Handles pre-aggregated buyer analytics (revenue, call counts).
 * This service reads from the BuyerStats table which is updated
 * by background jobs - NOT by runtime SUM() queries.
 */

import { getPrismaClient } from '../lib/prisma.js';

export interface BuyerStatsData {
  buyerId: string;
  revenueHour: number;
  revenueDay: number;
  revenueMonth: number;
  revenueTotal: number;
  callsHour: number;
  callsDay: number;
  callsMonth: number;
  callsTotal: number;
  capConsumedToday: number;
  lastUpdatedAt: Date;
}

/**
 * Get stats for all buyers in a tenant
 */
export async function getBuyerStatsBulk(tenantId: string): Promise<BuyerStatsData[]> {
  const prisma = getPrismaClient();

  const stats = await prisma.buyerStats.findMany({
    where: {
      buyer: { tenantId },
    },
    include: {
      buyer: { select: { id: true } },
    },
  });

  return stats.map(s => ({
    buyerId: s.buyerId,
    revenueHour: Number(s.revenueHour),
    revenueDay: Number(s.revenueDay),
    revenueMonth: Number(s.revenueMonth),
    revenueTotal: Number(s.revenueTotal),
    callsHour: s.callsHour,
    callsDay: s.callsDay,
    callsMonth: s.callsMonth,
    callsTotal: s.callsTotal,
    capConsumedToday: s.capConsumedToday,
    lastUpdatedAt: s.lastUpdatedAt,
  }));
}

/**
 * Get stats for a single buyer
 */
export async function getBuyerStats(buyerId: string): Promise<BuyerStatsData | null> {
  const prisma = getPrismaClient();

  const stats = await prisma.buyerStats.findUnique({
    where: { buyerId },
  });

  if (!stats) return null;

  return {
    buyerId: stats.buyerId,
    revenueHour: Number(stats.revenueHour),
    revenueDay: Number(stats.revenueDay),
    revenueMonth: Number(stats.revenueMonth),
    revenueTotal: Number(stats.revenueTotal),
    callsHour: stats.callsHour,
    callsDay: stats.callsDay,
    callsMonth: stats.callsMonth,
    callsTotal: stats.callsTotal,
    capConsumedToday: stats.capConsumedToday,
    lastUpdatedAt: stats.lastUpdatedAt,
  };
}

/**
 * Increment stats on call completion (called by event handler)
 */
export async function incrementBuyerStats(buyerId: string, revenue: number): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.buyerStats.upsert({
    where: { buyerId },
    create: {
      buyerId,
      revenueHour: revenue,
      revenueDay: revenue,
      revenueMonth: revenue,
      revenueTotal: revenue,
      callsHour: 1,
      callsDay: 1,
      callsMonth: 1,
      callsTotal: 1,
      capConsumedToday: 1,
      lastUpdatedAt: new Date(),
    },
    update: {
      revenueHour: { increment: revenue },
      revenueDay: { increment: revenue },
      revenueMonth: { increment: revenue },
      revenueTotal: { increment: revenue },
      callsHour: { increment: 1 },
      callsDay: { increment: 1 },
      callsMonth: { increment: 1 },
      callsTotal: { increment: 1 },
      capConsumedToday: { increment: 1 },
      lastUpdatedAt: new Date(),
    },
  });
}

/**
 * Reset hourly counters (called by scheduled job)
 */
export async function resetHourlyStats(): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.buyerStats.updateMany({
    data: {
      revenueHour: 0,
      callsHour: 0,
    },
  });
}

/**
 * Reset daily counters (called by scheduled job at midnight)
 */
export async function resetDailyStats(): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.buyerStats.updateMany({
    data: {
      revenueDay: 0,
      callsDay: 0,
      capConsumedToday: 0,
    },
  });
}

/**
 * Reset monthly counters (called by scheduled job on first of month)
 */
export async function resetMonthlyStats(): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.buyerStats.updateMany({
    data: {
      revenueMonth: 0,
      callsMonth: 0,
    },
  });
}

export const buyerStatsService = {
  getBuyerStatsBulk,
  getBuyerStats,
  incrementBuyerStats,
  resetHourlyStats,
  resetDailyStats,
  resetMonthlyStats,
};
