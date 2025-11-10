import { createClient, ClickHouseClient } from '@clickhouse/client';
import { PrismaClient } from '@prisma/client';

import { logger } from '../lib/logger.js';
import { etlRecordsProcessed, etlProcessingDuration } from '../lib/metrics.js';

interface CDRRow {
  id: string;
  call_id: string;
  tenant_id: string;
  campaign_id: string | null;
  publisher_id: string | null;
  buyer_id: string | null;
  from_number: string;
  to_number: string;
  duration: number;
  billable_duration: number;
  cost: string;
  rate: string | null;
  direction: string;
  status: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface EventRow {
  id: string;
  tenant_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  campaign_id: string | null;
  publisher_id: string | null;
  buyer_id: string | null;
  payload: string;
  created_at: string;
}

class ClickHouseService {
  private client: ClickHouseClient | null = null;
  private enabled: boolean;

  constructor() {
    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';
    const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE || 'default';

    this.enabled = !!clickhouseUrl;

    if (this.enabled) {
      try {
        this.client = createClient({
          url: clickhouseUrl!,
          username: clickhouseUser,
          password: clickhousePassword,
          database: clickhouseDatabase,
        });
        logger.info('ClickHouse client initialized');
      } catch (error) {
        logger.error('Failed to initialize ClickHouse client:', error);
        this.enabled = false;
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  async insert(table: string, data: unknown[]): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      throw new Error('ClickHouse is not enabled');
    }

    try {
      await this.client.insert({
        table,
        values: data,
        format: 'JSONEachRow',
      });
    } catch (error) {
      logger.error('ClickHouse insert error:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}

const clickhouseService = new ClickHouseService();

export class ClickHouseETL {
  private prisma: PrismaClient;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private lastCdrProcessedAt: Date | null = null;
  private lastEventProcessedAt: Date | null = null;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async start(): Promise<void> {
    if (!clickhouseService.isEnabled()) {
      logger.warn('ClickHouse not enabled, ETL worker will not start');
      return;
    }

    if (this.running) {
      logger.warn('ETL worker already running');
      return;
    }

    this.running = true;
    logger.info('Starting ClickHouse ETL worker...');

    // Process immediately on start
    await this.processBatch();

    // Then process every 30 seconds
    this.intervalId = setInterval(() => {
      this.processBatch().catch((error) => {
        logger.error('Error in ETL batch processing:', error);
      });
    }, 30000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    await this.prisma.$disconnect();
    logger.info('ClickHouse ETL worker stopped');
  }

  private async processBatch(): Promise<void> {
    try {
      await Promise.all([this.processCDRs(), this.processEvents()]);
    } catch (error) {
      logger.error('Error processing ETL batch:', error);
    }
  }

  private async processCDRs(): Promise<void> {
    if (!clickhouseService.isEnabled()) {
      return;
    }

    try {
      // Get CDRs created since last processing (or last hour if first run)
      const since = this.lastCdrProcessedAt || new Date(Date.now() - 3600000);
      
      const cdrs = await this.prisma.cdr.findMany({
        where: {
          createdAt: {
            gte: since,
          },
        },
        include: {
          call: {
            include: {
              campaign: {
                include: {
                  publisher: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 1000, // Process in batches
      });

      if (cdrs.length === 0) {
        return;
      }

      const rows: CDRRow[] = cdrs.map((cdr) => {
        const call = cdr.call;
        const campaign = call.campaign;
        const publisher = campaign?.publisher;

        return {
          id: cdr.id,
          call_id: cdr.callId,
          tenant_id: cdr.tenantId,
          campaign_id: campaign?.id || null,
          publisher_id: publisher?.id || null,
          buyer_id: null, // TODO: Extract from call metadata if available
          from_number: cdr.fromNumber,
          to_number: cdr.toNumber,
          duration: cdr.duration,
          billable_duration: cdr.billableDuration,
          cost: cdr.cost.toString(),
          rate: cdr.rate?.toString() || null,
          direction: cdr.direction,
          status: cdr.status,
          started_at: call.startedAt?.toISOString() || call.createdAt.toISOString(),
          answered_at: call.answeredAt?.toISOString() || null,
          ended_at: call.endedAt?.toISOString() || null,
          created_at: cdr.createdAt.toISOString(),
        };
      });

      const startTime = Date.now();
      await clickhouseService.insert('cdrs', rows);
      const duration = (Date.now() - startTime) / 1000;
      
      this.lastCdrProcessedAt = cdrs[cdrs.length - 1].createdAt;
      
      etlRecordsProcessed.inc({ table: 'cdrs', status: 'success' }, cdrs.length);
      etlProcessingDuration.observe({ table: 'cdrs' }, duration);
      
      logger.info({ 
        msg: 'Processed CDRs to ClickHouse', 
        count: cdrs.length, 
        duration 
      });
    } catch (error) {
      logger.error({ msg: 'Error processing CDRs', err: error });
      throw error;
    }
  }

  private async processEvents(): Promise<void> {
    if (!clickhouseService.isEnabled()) {
      return;
    }

    try {
      const since = this.lastEventProcessedAt || new Date(Date.now() - 3600000);

      const events = await this.prisma.event.findMany({
        where: {
          createdAt: {
            gte: since,
          },
          processed: false, // Only process unprocessed events
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 1000,
      });

      if (events.length === 0) {
        return;
      }

      const rows: EventRow[] = events.map((event) => {
        const payload = event.payload as Record<string, unknown>;
        const campaignId = payload.campaignId as string | undefined;
        const publisherId = payload.publisherId as string | undefined;
        const buyerId = payload.buyerId as string | undefined;

        return {
          id: event.id,
          tenant_id: event.tenantId,
          type: event.type,
          entity_type: event.entityType || null,
          entity_id: event.entityId || null,
          campaign_id: campaignId || null,
          publisher_id: publisherId || null,
          buyer_id: buyerId || null,
          payload: JSON.stringify(event.payload),
          created_at: event.createdAt.toISOString(),
        };
      });

      const startTime = Date.now();
      await clickhouseService.insert('events', rows);
      const duration = (Date.now() - startTime) / 1000;

      // Mark events as processed
      await this.prisma.event.updateMany({
        where: {
          id: {
            in: events.map((e) => e.id),
          },
        },
        data: {
          processed: true,
          processedAt: new Date(),
        },
      });

      this.lastEventProcessedAt = events[events.length - 1].createdAt;
      
      etlRecordsProcessed.inc({ table: 'events', status: 'success' }, events.length);
      etlProcessingDuration.observe({ table: 'events' }, duration);
      
      logger.info({ 
        msg: 'Processed events to ClickHouse', 
        count: events.length, 
        duration 
      });
    } catch (error) {
      logger.error({ msg: 'Error processing events', err: error });
      throw error;
    }
  }
}

