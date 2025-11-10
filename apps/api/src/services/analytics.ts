import { PrismaClient } from '@prisma/client';
import { clickhouseService } from './clickhouse.js';
import { logger } from '../lib/logger.js';

export interface AnalyticsFilters {
  tenantId: string;
  demoTenantId?: string;
  startDate: Date;
  endDate: Date;
  campaignId?: string;
  publisherId?: string;
  buyerId?: string;
  granularity?: 'hour' | 'day';
}

export interface MetricsResult {
  period: {
    start: string;
    end: string;
  };
  metrics: {
    totalCalls: number;
    answeredCalls: number;
    completedCalls: number;
    failedCalls: number;
    totalDuration: number;
    totalBillableMinutes: number;
    totalCost: number;
    averageDuration: number;
    asr: number; // Answer Seizure Ratio
    aht: number; // Average Handle Time
    conversionRate?: number;
  };
  breakdown: Array<{
    timestamp: string;
    totalCalls: number;
    answeredCalls: number;
    asr: number;
    aht: number;
    billableMinutes: number;
    cost: number;
  }>;
}

export class AnalyticsService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getMetrics(filters: AnalyticsFilters): Promise<MetricsResult> {
    // Use demo tenant if provided
    const tenantId = filters.demoTenantId || filters.tenantId;
    const effectiveFilters = { ...filters, tenantId };

    if (clickhouseService.isEnabled()) {
      try {
        return await this.getMetricsFromClickHouse(effectiveFilters);
      } catch (error) {
        logger.warn('ClickHouse query failed, falling back to Postgres:', error);
        return await this.getMetricsFromPostgres(effectiveFilters);
      }
    } else {
      return await this.getMetricsFromPostgres(effectiveFilters);
    }
  }

  private async getMetricsFromClickHouse(filters: AnalyticsFilters): Promise<MetricsResult> {
    const granularity = filters.granularity || 'hour';
    const viewName = granularity === 'hour' ? 'metrics_hourly' : 'metrics_daily';
    const timeColumn = granularity === 'hour' ? 'hour' : 'day';

    let whereConditions = [`tenant_id = {tenantId:String}`, `${timeColumn} >= {startDate:DateTime}`, `${timeColumn} <= {endDate:DateTime}`];
    const params: Record<string, unknown> = {
      tenantId: filters.tenantId,
      startDate: filters.startDate.toISOString().slice(0, 19).replace('T', ' '),
      endDate: filters.endDate.toISOString().slice(0, 19).replace('T', ' '),
    };

    if (filters.campaignId) {
      whereConditions.push(`campaign_id = {campaignId:String}`);
      params.campaignId = filters.campaignId;
    }
    if (filters.publisherId) {
      whereConditions.push(`publisher_id = {publisherId:String}`);
      params.publisherId = filters.publisherId;
    }
    if (filters.buyerId) {
      whereConditions.push(`buyer_id = {buyerId:String}`);
      params.buyerId = filters.buyerId;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get aggregated metrics
    const metricsQuery = `
      SELECT
        sum(total_calls) AS total_calls,
        sum(answered_calls) AS answered_calls,
        sum(completed_calls) AS completed_calls,
        sum(failed_calls) AS failed_calls,
        sum(total_duration) AS total_duration,
        sum(total_billable_duration) AS total_billable_duration,
        sum(total_cost) AS total_cost,
        avg(avg_duration) AS avg_duration,
        avg(asr) AS asr,
        avg(aht) AS aht
      FROM ${viewName}
      WHERE ${whereClause}
    `;

    // Get breakdown by time
    const breakdownQuery = `
      SELECT
        ${timeColumn} AS timestamp,
        sum(total_calls) AS total_calls,
        sum(answered_calls) AS answered_calls,
        avg(asr) AS asr,
        avg(aht) AS aht,
        sum(total_billable_duration) / 60 AS billable_minutes,
        sum(total_cost) AS cost
      FROM ${viewName}
      WHERE ${whereClause}
      GROUP BY ${timeColumn}
      ORDER BY ${timeColumn}
    `;

    const [metricsResult, breakdownResult] = await Promise.all([
      clickhouseService.query<{
        total_calls: number;
        answered_calls: number;
        completed_calls: number;
        failed_calls: number;
        total_duration: number;
        total_billable_duration: number;
        total_cost: number;
        avg_duration: number;
        asr: number;
        aht: number;
      }>(metricsQuery, params),
      clickhouseService.query<{
        timestamp: string;
        total_calls: number;
        answered_calls: number;
        asr: number;
        aht: number;
        billable_minutes: number;
        cost: number;
      }>(breakdownQuery, params),
    ]);

    const metrics = metricsResult[0] || {
      total_calls: 0,
      answered_calls: 0,
      completed_calls: 0,
      failed_calls: 0,
      total_duration: 0,
      total_billable_duration: 0,
      total_cost: 0,
      avg_duration: 0,
      asr: 0,
      aht: 0,
    };

    return {
      period: {
        start: filters.startDate.toISOString(),
        end: filters.endDate.toISOString(),
      },
      metrics: {
        totalCalls: metrics.total_calls || 0,
        answeredCalls: metrics.answered_calls || 0,
        completedCalls: metrics.completed_calls || 0,
        failedCalls: metrics.failed_calls || 0,
        totalDuration: metrics.total_duration || 0,
        totalBillableMinutes: Math.floor((metrics.total_billable_duration || 0) / 60),
        totalCost: Number(metrics.total_cost || 0),
        averageDuration: Math.floor(metrics.avg_duration || 0),
        asr: metrics.asr || 0,
        aht: Math.floor(metrics.aht || 0),
      },
      breakdown: breakdownResult.map((row) => ({
        timestamp: row.timestamp,
        totalCalls: row.total_calls || 0,
        answeredCalls: row.answered_calls || 0,
        asr: row.asr || 0,
        aht: Math.floor(row.aht || 0),
        billableMinutes: Math.floor(row.billable_minutes || 0),
        cost: Number(row.cost || 0),
      })),
    };
  }

  private async getMetricsFromPostgres(filters: AnalyticsFilters): Promise<MetricsResult> {
    const where: any = {
      tenantId: filters.tenantId,
      createdAt: {
        gte: filters.startDate,
        lte: filters.endDate,
      },
    };

    if (filters.campaignId) {
      where.call = {
        campaignId: filters.campaignId,
      };
    }

    const cdrs = await this.prisma.cdr.findMany({
      where,
      include: {
        call: {
          include: {
            campaign: true,
          },
        },
      },
    });

    const totalCalls = cdrs.length;
    const answeredCalls = cdrs.filter((c) => c.status === 'ANSWERED' || c.status === 'COMPLETED').length;
    const completedCalls = cdrs.filter((c) => c.status === 'COMPLETED').length;
    const failedCalls = cdrs.filter((c) => ['FAILED', 'BUSY', 'NO_ANSWER'].includes(c.status)).length;
    const totalDuration = cdrs.reduce((sum, c) => sum + c.duration, 0);
    const totalBillableDuration = cdrs.reduce((sum, c) => sum + c.billableDuration, 0);
    const totalCost = cdrs.reduce((sum, c) => sum + Number(c.cost), 0);
    const averageDuration = totalCalls > 0 ? Math.floor(totalDuration / totalCalls) : 0;
    const asr = totalCalls > 0 ? answeredCalls / totalCalls : 0;

    // Calculate AHT from answered calls
    const answeredCdrs = cdrs.filter((c) => c.call.answeredAt && c.call.endedAt);
    const aht =
      answeredCdrs.length > 0
        ? Math.floor(
            answeredCdrs.reduce(
              (sum, c) => sum + (c.call.endedAt!.getTime() - c.call.answeredAt!.getTime()) / 1000,
              0
            ) / answeredCdrs.length
          )
        : 0;

    // Group by hour/day for breakdown
    const granularity = filters.granularity || 'hour';
    const breakdownMap = new Map<string, typeof cdrs>();

    cdrs.forEach((cdr) => {
      const date = new Date(cdr.createdAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      const key =
        granularity === 'hour'
          ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00:00`
          : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 00:00:00`;

      if (!breakdownMap.has(key)) {
        breakdownMap.set(key, []);
      }
      breakdownMap.get(key)!.push(cdr);
    });

    const breakdown = Array.from(breakdownMap.entries())
      .map(([timestamp, groupCdrs]) => {
        const groupAnswered = groupCdrs.filter((c) => c.status === 'ANSWERED' || c.status === 'COMPLETED').length;
        const groupAnsweredCdrs = groupCdrs.filter((c) => c.call.answeredAt && c.call.endedAt);
        const groupAht =
          groupAnsweredCdrs.length > 0
            ? Math.floor(
                groupAnsweredCdrs.reduce(
                  (sum, c) => sum + (c.call.endedAt!.getTime() - c.call.answeredAt!.getTime()) / 1000,
                  0
                ) / groupAnsweredCdrs.length
              )
            : 0;

        return {
          timestamp,
          totalCalls: groupCdrs.length,
          answeredCalls: groupAnswered,
          asr: groupCdrs.length > 0 ? groupAnswered / groupCdrs.length : 0,
          aht: groupAht,
          billableMinutes: Math.floor(groupCdrs.reduce((sum, c) => sum + c.billableDuration, 0) / 60),
          cost: groupCdrs.reduce((sum, c) => sum + Number(c.cost), 0),
        };
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      period: {
        start: filters.startDate.toISOString(),
        end: filters.endDate.toISOString(),
      },
      metrics: {
        totalCalls,
        answeredCalls,
        completedCalls,
        failedCalls,
        totalDuration,
        totalBillableMinutes: Math.floor(totalBillableDuration / 60),
        totalCost,
        averageDuration,
        asr,
        aht,
      },
      breakdown,
    };
  }
}

export const analyticsService = new AnalyticsService();

