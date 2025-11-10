import { Decimal } from 'decimal.js';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

import { logger } from '../logger.js';

import { AccrualLedgerService } from './accrual-ledger.js';
import { RateCardInterpreter } from './rate-card-interpreter.js';

export interface CallCompletedEvent {
  event: 'call.completed';
  tenantId: string;
  data: {
    callId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    duration: number;
    answered: boolean;
    publisherId?: string;
    buyerId?: string;
    campaignId?: string;
    hasRecording?: boolean;
    recordingDuration?: number;
  };
}

export interface ConversionConfirmedEvent {
  event: 'conversion.confirmed';
  tenantId: string;
  data: {
    callId: string;
    publisherId?: string;
    buyerId?: string;
    campaignId?: string;
    amount?: number;
  };
}

export class BillingWorker {
  private redis: Redis | null = null;
  private pool: Pool;
  private rateInterpreter: RateCardInterpreter;
  private accrualLedger: AccrualLedgerService;
  private isRunning = false;
  private redisEnabled = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: () => null, // Don't retry on connection failure
        lazyConnect: true, // Don't connect immediately
      });
      
      // Handle Redis errors gracefully
      this.redis.on('error', (err) => {
        console.warn('[BillingWorker] Redis connection error (non-fatal):', err.message);
        this.redisEnabled = false;
      });
      
      this.redis.on('connect', () => {
        this.redisEnabled = true;
        console.log('[BillingWorker] Redis connected');
      });
      
      // Try to connect, but don't fail if it doesn't
      this.redis.connect().catch(() => {
        console.warn('[BillingWorker] Redis not available, worker will run without Redis');
        this.redisEnabled = false;
      });
    } else {
      console.warn('[BillingWorker] REDIS_URL not set, worker will run without Redis');
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });

    this.rateInterpreter = new RateCardInterpreter();
    this.accrualLedger = new AccrualLedgerService();
  }

  async start(): Promise<void> {
    if (!this.redis || !this.redisEnabled) {
      console.warn('[BillingWorker] Redis not available, billing worker will not start');
      return;
    }

    this.isRunning = true;

    // Initialize consumer group
    try {
      await this.redis.xgroup('CREATE', 'events:stream', 'billing-group', '0', 'MKSTREAM');
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) {
        console.warn('[BillingWorker] Failed to create consumer group:', err.message);
        this.redisEnabled = false;
        return;
      }
    }

    // Start consuming events
    this.consumeEvents();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (err) {
        // Ignore errors on quit
      }
    }
    await this.pool.end();
  }

  private async consumeEvents(): Promise<void> {
    while (this.isRunning && this.redis && this.redisEnabled) {
      try {
        // Read from stream
        const messages = await this.redis.xreadgroup(
          'GROUP',
          'billing-group',
          'billing-worker',
          'COUNT',
          '10',
          'BLOCK',
          '1000',
          'STREAMS',
          'events:stream',
          '>'
        );

        if (!messages || messages.length === 0) {
          continue;
        }

        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];

        for (const [messageId, fields] of streamMessages) {
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          const payload = JSON.parse(fieldMap.payload || '{}');

          // Process call.completed events
          if (payload.event === 'call.completed') {
            // Validate event structure
            const eventData = payload.data;
            if (eventData.callId && (eventData.duration !== undefined || eventData.callState)) {
              // Transform to billing event format if needed
              const billingEvent: CallCompletedEvent = {
                event: 'call.completed',
                tenantId: payload.tenantId,
                data: {
                  callId: eventData.callId,
                  direction: eventData.direction || 'OUTBOUND',
                  duration: eventData.duration || 0,
                  answered: eventData.answered !== undefined ? eventData.answered : (eventData.callState?.status === 'completed' || eventData.callState?.status === 'answered'),
                  publisherId: eventData.publisherId,
                  buyerId: eventData.buyerId,
                  campaignId: eventData.campaignId,
                  hasRecording: eventData.hasRecording,
                  recordingDuration: eventData.recordingDuration,
                },
              };
              await this.processCallCompleted(billingEvent, messageId);
            } else {
              // Invalid event, acknowledge and skip
              await this.redis.xack('events:stream', 'billing-group', messageId);
            }
          }
          // Process conversion.confirmed events
          else if (payload.event === 'conversion.confirmed') {
            await this.processConversionConfirmed(payload as ConversionConfirmedEvent, messageId);
          } else {
            // Not our event, acknowledge and skip
            await this.redis.xack('events:stream', 'billing-group', messageId);
          }
        }
      } catch (error: any) {
        logger.error('Error consuming events:', error);
        // If Redis connection is lost, disable Redis and exit loop
        if (error.message?.includes('ECONNREFUSED') || error.message?.includes('Connection is closed')) {
          console.warn('[BillingWorker] Redis connection lost, stopping consumer');
          this.redisEnabled = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async processCallCompleted(
    event: CallCompletedEvent,
    messageId: string
  ): Promise<void> {
    try {
      logger.info(`Processing billing for call ${event.data.callId}`);

      // Get billing account for tenant
      const accountResult = await this.pool.query(
        `SELECT id FROM billing_accounts WHERE tenant_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [event.tenantId]
      );

      if (accountResult.rows.length === 0) {
        logger.warn(`No billing account found for tenant ${event.tenantId}`);
        await this.redis.xack('events:stream', 'billing-group', messageId);
        return;
      }

      const billingAccountId = accountResult.rows[0].id;

      // Get active rate card
      const rateCardResult = await this.pool.query(
        `SELECT rates FROM rate_cards
         WHERE billing_account_id = $1
           AND status = 'ACTIVE'
           AND effective_from <= NOW()
           AND (effective_to IS NULL OR effective_to >= NOW())
         ORDER BY effective_from DESC
         LIMIT 1`,
        [billingAccountId]
      );

      if (rateCardResult.rows.length === 0) {
        logger.warn(`No active rate card found for billing account ${billingAccountId}`);
        await this.redis.xack('events:stream', 'billing-group', messageId);
        return;
      }

      const rateCard = rateCardResult.rows[0].rates;

      // Calculate charges
      const rating = this.rateInterpreter.calculateCallCharges(rateCard, {
        direction: event.data.direction,
        duration: event.data.duration,
        answered: event.data.answered,
        hasRecording: event.data.hasRecording || false,
        recordingDuration: event.data.recordingDuration,
        publisherId: event.data.publisherId,
        buyerId: event.data.buyerId,
        metadata: {
          callId: event.data.callId,
          campaignId: event.data.campaignId,
        },
      });

      // Create accrual entries
      const periodDate = new Date();
      periodDate.setHours(0, 0, 0, 0);

      // Connection fee
      if (rating.connectionFee.gt(0)) {
        await this.accrualLedger.createEntry({
          tenantId: event.tenantId,
          billingAccountId,
          publisherId: event.data.publisherId,
          buyerId: event.data.buyerId,
          callId: event.data.callId,
          type: 'CONNECTION_FEE',
          amount: this.rateInterpreter.roundAmount(rating.connectionFee),
          currency: 'USD',
          description: `${event.data.direction} connection fee`,
          periodDate,
          metadata: { callId: event.data.callId },
        });
      }

      // Call minutes
      if (rating.callAmount.gt(0)) {
        await this.accrualLedger.createEntry({
          tenantId: event.tenantId,
          billingAccountId,
          publisherId: event.data.publisherId,
          buyerId: event.data.buyerId,
          callId: event.data.callId,
          type: event.data.direction === 'INBOUND' ? 'CALL_MINUTE_INBOUND' : 'CALL_MINUTE_OUTBOUND',
          amount: this.rateInterpreter.roundAmount(rating.callAmount),
          currency: 'USD',
          description: `${event.data.direction} call (${rating.callMinutes.toFixed(2)} minutes)`,
          periodDate,
          metadata: {
            callId: event.data.callId,
            minutes: rating.callMinutes.toNumber(),
          },
        });
      }

      // Recording fee
      if (rating.recordingFee.gt(0)) {
        await this.accrualLedger.createEntry({
          tenantId: event.tenantId,
          billingAccountId,
          publisherId: event.data.publisherId,
          buyerId: event.data.buyerId,
          callId: event.data.callId,
          type: 'RECORDING_FEE',
          amount: this.rateInterpreter.roundAmount(rating.recordingFee),
          currency: 'USD',
          description: 'Recording fee',
          periodDate,
          metadata: { callId: event.data.callId },
        });
      }

      logger.info(`Created accruals for call ${event.data.callId}: $${rating.total.toFixed(4)}`);

      // Acknowledge message
      await this.redis.xack('events:stream', 'billing-group', messageId);
    } catch (error) {
      logger.error(`Error processing call completed for ${event.data.callId}:`, error);
      // Don't acknowledge on error - will retry
    }
  }

  private async processConversionConfirmed(
    event: ConversionConfirmedEvent,
    messageId: string
  ): Promise<void> {
    try {
      logger.info(`Processing CPA for call ${event.data.callId}`);

      // Get billing account
      const accountResult = await this.pool.query(
        `SELECT id FROM billing_accounts WHERE tenant_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [event.tenantId]
      );

      if (accountResult.rows.length === 0) {
        logger.warn(`No billing account found for tenant ${event.tenantId}`);
        await this.redis.xack('events:stream', 'billing-group', messageId);
        return;
      }

      const billingAccountId = accountResult.rows[0].id;

      // Get active rate card
      const rateCardResult = await this.pool.query(
        `SELECT rates FROM rate_cards
         WHERE billing_account_id = $1
           AND status = 'ACTIVE'
           AND effective_from <= NOW()
           AND (effective_to IS NULL OR effective_to >= NOW())
         ORDER BY effective_from DESC
         LIMIT 1`,
        [billingAccountId]
      );

      if (rateCardResult.rows.length === 0) {
        logger.warn(`No active rate card found`);
        await this.redis.xack('events:stream', 'billing-group', messageId);
        return;
      }

      const rateCard = rateCardResult.rows[0].rates;
      const cpaAmount = this.rateInterpreter.calculateCPACharge(rateCard);

      if (cpaAmount.gt(0)) {
        const periodDate = new Date();
        periodDate.setHours(0, 0, 0, 0);

        await this.accrualLedger.createEntry({
          tenantId: event.tenantId,
          billingAccountId,
          publisherId: event.data.publisherId,
          buyerId: event.data.buyerId,
          callId: event.data.callId,
          type: 'CPA_CONVERSION',
          amount: this.rateInterpreter.roundAmount(cpaAmount),
          currency: 'USD',
          description: 'CPA conversion fee',
          periodDate,
          metadata: {
            callId: event.data.callId,
            campaignId: event.data.campaignId,
            amount: event.data.amount,
          },
        });

        logger.info(`Created CPA accrual for call ${event.data.callId}: $${cpaAmount.toFixed(4)}`);
      }

      await this.redis.xack('events:stream', 'billing-group', messageId);
    } catch (error) {
      logger.error(`Error processing conversion confirmed for ${event.data.callId}:`, error);
    }
  }
}

