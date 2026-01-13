/**
 * DialerWorker - "The Hopper"
 *
 * Polls the database for NEW/RECYCLED leads from active campaigns and originates
 * calls via FreeSWITCH ESL. Uses &socket() to hand off control to the FlowEngine
 * upon answer.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import modesl, { ApiResponse } from 'modesl';

// Workaround for CJS import in ESM
const { Connection: ESLConnection } = modesl;

import { logger } from '../lib/logger.js';

/** Configuration from environment */
const FREESWITCH_HOST = process.env.FREESWITCH_HOST || 'localhost';
const FREESWITCH_ESL_PORT = parseInt(process.env.FREESWITCH_ESL_PORT || '8021', 10);
const FREESWITCH_ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '10', 10);
const DIALER_POLL_INTERVAL_MS = parseInt(process.env.DIALER_POLL_INTERVAL_MS || '1000', 10);
const DIALER_BATCH_SIZE = parseInt(process.env.DIALER_BATCH_SIZE || '50', 10);
const OUTBOUND_CALLER_ID = process.env.OUTBOUND_CALLER_ID || '+15551234567';
const SOCKET_LISTENER_HOST = process.env.SOCKET_LISTENER_HOST || '127.0.0.1';
const SOCKET_LISTENER_PORT = process.env.SOCKET_LISTENER_PORT || '8021';

interface LeadToDial {
  id: string;
  phoneNumber: string;
  campaignId: string;
  tenantId: string;
  campaignName: string;
}

interface LeadRow {
  id: string;
  phoneNumber: string;
  campaignId: string;
  tenantId: string;
  campaign_name: string;
}

export class DialerWorker {
  private prisma: PrismaClient;
  private redis: Redis | null = null;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private eslConnection: any | null = null; // using any for ESLConnection instance to avoid type conflicts
  private currentActiveCalls = 0;
  private redisEnabled = false;

  constructor() {
    this.prisma = new PrismaClient();

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: () => null,
        lazyConnect: true,
      });

      this.redis.on('error', (err: Error) => {
        logger.warn({ msg: 'DialerWorker Redis connection error', error: err.message });
        this.redisEnabled = false;
      });

      this.redis.on('connect', () => {
        this.redisEnabled = true;
        logger.info({ msg: 'DialerWorker Redis connected' });
      });

      this.redis.connect().catch(() => {
        logger.warn({ msg: 'DialerWorker Redis not available' });
        this.redisEnabled = false;
      });
    }
  }

  /**
   * Start the dialer worker loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({ msg: 'DialerWorker already running' });
      return;
    }

    logger.info({
      msg: 'Starting DialerWorker...',
      config: {
        host: FREESWITCH_HOST,
        port: FREESWITCH_ESL_PORT,
        maxConcurrent: MAX_CONCURRENT_CALLS,
        pollInterval: DIALER_POLL_INTERVAL_MS,
      },
    });

    this.isRunning = true;

    // Try to connect to FreeSWITCH ESL
    await this.connectESL();

    // Start polling loop
    this.intervalId = setInterval(() => {
      this.runDialerLoop().catch((err: unknown) => {
        logger.error({ msg: 'DialerWorker loop error', error: err });
      });
    }, DIALER_POLL_INTERVAL_MS);

    logger.info({ msg: 'DialerWorker started' });
  }

  /**
   * Stop the dialer worker gracefully.
   */
  async stop(): Promise<void> {
    logger.info({ msg: 'Stopping DialerWorker...' });
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.eslConnection) {
      this.eslConnection.disconnect();
      this.eslConnection = null;
    }

    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Ignore
      }
    }

    await this.prisma.$disconnect();
    logger.info({ msg: 'DialerWorker stopped' });
  }

  /**
   * Connect to FreeSWITCH via ESL.
   */
  private async connectESL(): Promise<void> {
    return new Promise(resolve => {
      try {
        this.eslConnection = new ESLConnection(
          FREESWITCH_HOST,
          FREESWITCH_ESL_PORT,
          FREESWITCH_ESL_PASSWORD
        );

        this.eslConnection.on('error', (err: Error) => {
          logger.error({ msg: 'ESL connection error', error: err.message });
          this.eslConnection = null;
        });

        this.eslConnection.on('esl::ready', () => {
          logger.info({ msg: 'ESL connection ready' });
          resolve();
        });

        this.eslConnection.on('esl::end', () => {
          logger.warn({ msg: 'ESL connection ended' });
          this.eslConnection = null;
        });

        // Set a timeout in case connection never completes
        setTimeout(() => {
          if (!this.eslConnection) {
            logger.warn({ msg: 'ESL connection timeout, will retry on next loop' });
          }
          resolve();
        }, 5000);
      } catch (err: unknown) {
        logger.error({ msg: 'Failed to create ESL connection', error: err });
        this.eslConnection = null;
        resolve();
      }
    });
  }

  /**
   * Main dialer loop - check capacity, fetch leads, originate calls.
   */
  private async runDialerLoop(): Promise<void> {
    if (!this.isRunning) return;

    // Reconnect ESL if disconnected
    if (!this.eslConnection) {
      logger.info({ msg: 'Reconnecting to ESL...' });
      await this.connectESL();
      if (!this.eslConnection) {
        logger.warn({ msg: 'ESL not available, skipping loop iteration' });
        return;
      }
    }

    // Check capacity
    const activeCallCount = await this.getActiveCallCount();
    const availableSlots = MAX_CONCURRENT_CALLS - activeCallCount;

    if (availableSlots <= 0) {
      return;
    }

    // Fetch leads to dial
    const leads = await this.fetchLeadsToDial(Math.min(availableSlots, DIALER_BATCH_SIZE));
    if (leads.length === 0) {
      return;
    }

    logger.info({ msg: 'Fetched leads to dial', count: leads.length });

    // Originate calls (fire and forget - do not await call completion)
    for (const lead of leads) {
      // Immediately mark as DIALING to prevent re-fetch
      await this.updateLeadStatus(lead.id, 'DIALING');

      // Fire originate command (non-blocking)
      this.originateCall(lead).catch((err: unknown) => {
        logger.error({ msg: 'Failed to originate call', leadId: lead.id, error: err });
        // Revert status on failure
        this.updateLeadStatus(lead.id, 'NEW').catch(() => {});
      });
    }
  }

  /**
   * Get current count of active calls.
   */
  private async getActiveCallCount(): Promise<number> {
    // Try Redis first if available
    if (this.redis && this.redisEnabled) {
      try {
        const count = await this.redis.get('dialer:active_calls');
        if (count !== null) {
          return parseInt(count, 10);
        }
      } catch {
        // Fall through to ESL method
      }
    }

    // Query FreeSWITCH for active calls (if ESL is available)
    if (this.eslConnection) {
      return new Promise(resolve => {
        this.eslConnection!.api('show', 'calls count', (res: ApiResponse) => {
          // Response format: "X total." - extract number
          const body = res.body ?? '';
          const match = body.match(/(\d+)\s+total/);
          if (match) {
            resolve(parseInt(match[1], 10));
          } else {
            resolve(this.currentActiveCalls);
          }
        });
      });
    }

    return this.currentActiveCalls;
  }

  /**
   * Fetch leads ready for dialing using raw SQL to avoid Prisma model issues.
   */
  private async fetchLeadsToDial(limit: number): Promise<LeadToDial[]> {
    // Use raw SQL query to fetch leads with campaign info
    // Note: We use quoted camelCase identifiers to match Prisma default mapping
    const leads = await this.prisma.$queryRaw<LeadRow[]>`
      SELECT
        l.id,
        l."phoneNumber",
        l."campaignId",
        c."tenantId",
        c.name as campaign_name
      FROM "leads" l
      INNER JOIN "campaigns" c ON l."campaignId" = c.id
      WHERE l.status IN ('NEW', 'RECYCLED')
        AND c.status = 'ACTIVE'
      ORDER BY l."createdAt" ASC
      LIMIT ${limit}
    `;

    return leads.map((lead: LeadRow) => ({
      id: lead.id,
      phoneNumber: lead.phoneNumber,
      campaignId: lead.campaignId,
      tenantId: lead.tenantId,
      campaignName: lead.campaign_name,
    }));
  }

  /**
   * Originate a call to a lead via FreeSWITCH.
   */
  private async originateCall(lead: LeadToDial): Promise<void> {
    if (!this.eslConnection) {
      throw new Error('ESL not connected');
    }

    const phoneNumber = this.normalizePhoneNumber(lead.phoneNumber);

    // Build originate command with &socket() to hand off to FlowEngine
    // Format: originate {vars}sofia/gateway/external/+1XXXXXXXXXX &socket(host:port async full)
    const originateVars = [
      `ignore_early_media=true`,
      `origination_caller_id_number=${OUTBOUND_CALLER_ID}`,
      `origination_caller_id_name=Hopwhistle`,
      `hopwhistle_lead_id=${lead.id}`,
      `hopwhistle_campaign_id=${lead.campaignId}`,
      `hopwhistle_tenant_id=${lead.tenantId}`,
    ].join(',');

    const dialString = `sofia/gateway/telnyx/${phoneNumber}`;
    const application = `&socket(${SOCKET_LISTENER_HOST}:${SOCKET_LISTENER_PORT} async full)`;

    const originateCmd = `originate {${originateVars}}${dialString} ${application}`;

    logger.info({ msg: 'Originating call', leadId: lead.id, phone: phoneNumber });

    return new Promise((resolve, reject) => {
      this.eslConnection!.bgapi(originateCmd, (res: ApiResponse) => {
        const body = res.body ?? '';
        if (body.includes('-ERR')) {
          logger.error({ msg: 'Originate failed', leadId: lead.id, response: body });
          reject(new Error(body));
        } else {
          this.currentActiveCalls++;
          logger.info({ msg: 'Originate success', leadId: lead.id, response: body.trim() });
          resolve();
        }
      });
    });
  }

  /**
   * Update lead status in the database using raw SQL.
   */
  private async updateLeadStatus(leadId: string, status: string): Promise<void> {
    // Cast status to any to match query parameter expectations if needed, though strictly string should work
    await this.prisma.$executeRaw`
      UPDATE "leads" SET status = ${status}::"LeadStatus", "updatedAt" = NOW() WHERE id = ${leadId}
    `;
  }

  /**
   * Normalize phone number to E.164 format.
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove non-digits
    const digits = phone.replace(/\D/g, '');

    // If 10 digits, assume US and add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }

    // If 11 digits starting with 1, add +
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }

    // If already has + prefix, return as-is
    if (phone.startsWith('+')) {
      return phone;
    }

    // Default: add + prefix
    return `+${digits}`;
  }
}
