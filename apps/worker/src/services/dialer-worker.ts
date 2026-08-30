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

import type { HopperScope } from '../config/hopper-gate.js';
import { logger } from '../lib/logger.js';

import { getOutboundDialString } from './carrier-routing.js';
import { LeadReservationStore } from './lead-reservation-store.js';
import {
  AttemptOutcome,
  provesHumanContact,
  ReservationState,
  ReserveRejection,
} from './lead-reservation.js';

/**
 * How long a reservation is held before a reaper may recover it.
 *
 * Generously longer than a poll interval and than any plausible originate
 * round-trip. Too short and a healthy worker's own reservations get recovered
 * underneath it; too long and a crashed worker's leads sit idle. Thirty seconds
 * is roughly thirty poll cycles.
 */
const RESERVATION_LEASE_MS = 30_000;

/** Required at startup. There is no "unscoped" mode — see `start()`. */
export interface HopperStartOptions {
  scope: HopperScope;
  /** Identifies this replica in reservations. Defaults to the process id. */
  ownerId?: string;
  /**
   * The second, independent interlock. Enabling the Hopper does not enable
   * calls: with this false the loop selects and reserves but never submits an
   * origination command, so the lifecycle can be exercised without a gateway.
   */
  originationEnabled: boolean;
}

const NO_SCOPE: HopperScope = { tenantIds: [], campaignIds: [] };

/**
 * Thrown when the loop reaches origination with the interlock off.
 *
 * A distinct type rather than a generic Error so the caller can tell "we chose
 * not to dial" apart from "dialling failed", and release the reservation
 * accordingly. Collapsing them would make a deliberately disabled worker look
 * like a broken one in every metric.
 */
export class OriginationDisabledError extends Error {
  readonly code = 'LEGACY_HOPPER_ORIGINATION_DISABLED';
  constructor() {
    super('origination is disabled by LEGACY_HOPPER_ORIGINATION_ENABLED');
    this.name = 'OriginationDisabledError';
  }
}

/** Configuration from environment */
const FREESWITCH_HOST =
  process.env.FREESWITCH_ESL_HOST || process.env.FREESWITCH_HOST || 'freeswitch';
const FREESWITCH_ESL_PORT = parseInt(process.env.FREESWITCH_ESL_PORT || '8021', 10);
const FREESWITCH_ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '10', 10);
const DIALER_POLL_INTERVAL_MS = parseInt(process.env.DIALER_POLL_INTERVAL_MS || '1000', 10);
const DIALER_BATCH_SIZE = parseInt(process.env.DIALER_BATCH_SIZE || '50', 10);
// const OUTBOUND_CALLER_ID = process.env.OUTBOUND_CALLER_ID || '+18652809894';
const SOCKET_LISTENER_HOST = process.env.SOCKET_LISTENER_HOST || '127.0.0.1';
const SOCKET_LISTENER_PORT = process.env.SOCKET_LISTENER_PORT || '8021';

// The hardcoded FRACTEL_GATEWAYS round-robin that used to live here has been
// replaced by the configurable PREDICTIVE_DIALER waterfall — see
// services/carrier-routing.ts.
//
// It picked exactly ONE gateway per call. That spread load across FracTEL's six
// IPs but gave each individual call no failover at all: a call handed to a
// gateway that was refusing INVITEs simply failed, and nothing tried anywhere
// else. The replacement dials the whole chain in order and rotates only the
// starting point within the primary carrier, so load still spreads and a bad
// leg now falls through to the next one.

/** Fallback caller ID if the tenant's rotation pool is empty. */
const FALLBACK_CALLER_ID = process.env.OUTBOUND_CALLER_ID || '+18656000124';

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

interface FreeSwitchESLConnection {
  disconnect(): void;
  on(event: string, callback: (...args: unknown[]) => void): this;
  api(command: string, args: string, callback: (res: ApiResponse) => void): void;
  bgapi(command: string, callback: (res: ApiResponse) => void): void;
}

export class DialerWorker {
  private prisma: PrismaClient;
  private redis: Redis | null = null;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private eslConnection: FreeSwitchESLConnection | null = null;
  private currentActiveCalls = 0;
  private redisEnabled = false;

  /** Set by `start()`. Empty until then, so nothing can be selected. */
  private scope: HopperScope = NO_SCOPE;
  /** Set by `start()`. False until then, so nothing can be originated. */
  private originationEnabled = false;
  /** Created at `start()`. The Hopper refuses to dial without one. */
  private reservations: LeadReservationStore | null = null;

  // Per-tenant FracTEL DID rotation pool, cached from the DB with a short TTL so
  // caller-ID rotation always reflects the current active pool numbers.
  private didPoolCache = new Map<string, { numbers: string[]; fetchedAt: number }>();
  private didRotationIndex = new Map<string, number>();
  private static readonly DID_POOL_TTL_MS = 60_000;

  /**
   * Return the next rotation caller ID for a tenant, sourced from the active
   * FracTEL POOL numbers in the DB (refreshed every DID_POOL_TTL_MS).
   */
  private async getNextCallerId(tenantId: string): Promise<string> {
    const now = Date.now();
    let entry = this.didPoolCache.get(tenantId);
    if (!entry || now - entry.fetchedAt > DialerWorker.DID_POOL_TTL_MS) {
      const rows = await this.prisma.phoneNumber.findMany({
        where: { tenantId, provider: 'fractel', status: 'ACTIVE', poolType: 'POOL' },
        select: { number: true },
        orderBy: { number: 'asc' },
      });
      entry = { numbers: rows.map(r => r.number).filter(Boolean), fetchedAt: now };
      this.didPoolCache.set(tenantId, entry);
    }
    if (entry.numbers.length === 0) {
      return FALLBACK_CALLER_ID;
    }
    const idx = (this.didRotationIndex.get(tenantId) ?? 0) % entry.numbers.length;
    this.didRotationIndex.set(tenantId, idx + 1);
    return entry.numbers[idx];
  }

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
   *
   * The scope is REQUIRED and comes from `config/hopper-gate.ts`. It is not
   * optional and has no default, deliberately: an omitted scope was exactly the
   * previous behaviour — every tenant, every campaign — and making it a
   * parameter with no default means that behaviour cannot be reached by
   * forgetting something.
   */
  async start(options: HopperStartOptions): Promise<void> {
    if (this.isRunning) {
      logger.warn({ msg: 'DialerWorker already running' });
      return;
    }

    if (options.scope.tenantIds.length === 0 && options.scope.campaignIds.length === 0) {
      // Defence in depth. The gate already refuses this; so does the loop, so
      // that a future caller bypassing the gate still cannot dial everything.
      throw new Error('DialerWorker refused to start: the scope names no tenant and no campaign');
    }

    this.scope = options.scope;
    this.originationEnabled = options.originationEnabled;
    this.reservations = new LeadReservationStore({
      db: this.prisma,
      ownerId: options.ownerId ?? `hopper-${process.pid}`,
      leaseMs: RESERVATION_LEASE_MS,
    });

    logger.info({
      msg: 'Starting DialerWorker...',
      config: {
        host: FREESWITCH_HOST,
        port: FREESWITCH_ESL_PORT,
        maxConcurrent: MAX_CONCURRENT_CALLS,
        pollInterval: DIALER_POLL_INTERVAL_MS,
        scopedTenants: this.scope.tenantIds.length,
        scopedCampaigns: this.scope.campaignIds.length,
        originationEnabled: this.originationEnabled,
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
        ) as unknown as FreeSwitchESLConnection;

        this.eslConnection.on('error', (...args: unknown[]) => {
          const err = args[0] as Error;
          logger.error({ msg: 'ESL connection error', error: err?.message || 'Unknown ESL error' });
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

    for (const lead of leads) {
      await this.attemptLead(lead);
    }
  }

  /**
   * Reserve a lead, then attempt it.
   *
   * ── What this replaces ───────────────────────────────────────────────────
   *
   * The previous body was two lines:
   *
   *     await this.updateLeadStatus(lead.id, 'DIALING');   // F-1: threw, always
   *     this.originateCall(lead).catch(() => revert to 'NEW');
   *
   * Three things were wrong with it beyond the invalid enum value. The write was
   * not atomic, so two workers polling the same second both "claimed" the same
   * lead. There was no lease, so a crash between the mark and the originate
   * stranded the lead forever — selection is `status = 'NEW'`, so a lead left in
   * any other state is never seen again. And the revert path could not tell
   * "we never sent a command" from "FreeSWITCH already has one", so recovering
   * would eventually mean redialing somebody whose phone was ringing.
   */
  private async attemptLead(lead: LeadToDial): Promise<void> {
    const store = this.reservations;
    if (!store) {
      logger.error({ msg: 'No reservation store; refusing to dial', leadId: lead.id });
      return;
    }

    const reserved = await store.reserve({
      leadId: lead.id,
      tenantIds: this.scope.tenantIds,
      campaignIds: this.scope.campaignIds,
    });

    if (!reserved.ok) {
      // ALREADY_RESERVED is the normal outcome of two workers racing, and is not
      // an error. The others say the lead should not have been selected.
      if (reserved.rejection !== ReserveRejection.ALREADY_RESERVED) {
        logger.warn({ msg: 'Lead not reserved', leadId: lead.id, rejection: reserved.rejection });
      }
      return;
    }

    const { id: reservationId, token, attemptId } = reserved.reservation;

    // Recorded BEFORE the command is built. If this process dies in the next
    // few milliseconds, recovery finds ORIGINATION_SUBMITTED and holds the lead
    // for reconciliation instead of handing it to another worker. Recording
    // afterwards would leave a window in which a call exists and nothing knows.
    const submitted = await store.transition({
      reservationId,
      token,
      to: ReservationState.ORIGINATION_SUBMITTED,
    });
    if (!submitted.ok) {
      logger.warn({
        msg: 'Could not mark submitted',
        leadId: lead.id,
        rejection: submitted.rejection,
      });
      return;
    }

    try {
      await this.originateCall(lead, attemptId);
      await store.transition({
        reservationId,
        token,
        to: ReservationState.ORIGINATION_ACCEPTED,
      });
    } catch (error) {
      // The interlock being off is a decision, not a failure. The command was
      // never constructed, so nothing rang and the lead is safe to free at once.
      const disabled = error instanceof OriginationDisabledError;
      if (!disabled) {
        logger.error({ msg: 'Failed to originate call', leadId: lead.id, error });
      }

      await store.transition({
        reservationId,
        token,
        to: ReservationState.RELEASED,
        outcome: AttemptOutcome.NOT_ATTEMPTED,
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
    // The allowlist is part of the PREDICATE, not a filter applied afterwards.
    // A post-filter would still have fetched — and, before the reservation
    // lifecycle existed, still have marked — leads outside the authorised
    // scope. Empty arrays are passed explicitly so the `cardinality` guards
    // below express "this dimension is unrestricted" rather than "match none",
    // and the gate guarantees at least one of the two is non-empty.
    const tenantIds = [...this.scope.tenantIds];
    const campaignIds = [...this.scope.campaignIds];

    const leads = await this.prisma.$queryRaw<LeadRow[]>`
      SELECT
        l.id,
        l."phoneNumber",
        l."campaignId",
        c."tenantId",
        c.name as campaign_name
      FROM "leads" l
      INNER JOIN "campaigns" c ON l."campaignId" = c.id
      WHERE l.status = 'NEW'
        AND c.status = 'ACTIVE'
        AND (cardinality(${tenantIds}::text[]) = 0 OR c."tenantId" = ANY(${tenantIds}::text[]))
        AND (cardinality(${campaignIds}::text[]) = 0 OR l."campaignId" = ANY(${campaignIds}::text[]))
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
  private async originateCall(lead: LeadToDial, attemptId: string): Promise<void> {
    // The second interlock, checked before anything is built rather than before
    // it is sent. There is no path from here to a gateway with this false: the
    // command string is never constructed, so it cannot be logged, retried, or
    // accidentally forwarded either.
    if (!this.originationEnabled) {
      throw new OriginationDisabledError();
    }

    if (!this.eslConnection) {
      throw new Error('ESL not connected');
    }

    const phoneNumber = this.normalizePhoneNumber(lead.phoneNumber);

    // Build originate command with &socket() to hand off to FlowEngine
    // Format: originate {vars}sofia/gateway/external/+1XXXXXXXXXX &socket(host:port async full)
    const callerId = await this.getNextCallerId(lead.tenantId);
    const originateVars = {
      ignore_early_media: 'true',
      origination_caller_id_number: callerId,
      origination_caller_id_name: 'Hopwhistle',
      hopwhistle_lead_id: lead.id,
      hopwhistle_campaign_id: lead.campaignId,
      hopwhistle_tenant_id: lead.tenantId,
      // The correlation id, carried on the channel.
      //
      // This is what makes the uncertain case answerable at all. If this process
      // dies between submitting the command and recording the acceptance, the
      // reservation is left in ORIGINATION_SUBMITTED and a reaper moves it to
      // NEEDS_RECONCILIATION rather than freeing the lead. Deciding what
      // actually happened then means asking FreeSWITCH whether a channel exists
      // carrying this id — without it there is no way to tell an abandoned
      // reservation from a live call, and the only safe action would be to leave
      // the lead stuck forever.
      hopwhistle_attempt_id: attemptId,
    };

    // The carrier waterfall for this tenant's predictive dialer, resolved per
    // call so an admin changing carriers in the settings UI takes effect on the
    // next origination without a worker restart.
    //
    // The channel variables are handed to the builder rather than wrapped
    // around its output: it emits its own `{...}` prefix carrying the per-leg
    // timeout, and two adjacent brace groups is not valid originate syntax.
    const { dialString, chain } = await getOutboundDialString(
      this.prisma,
      lead.tenantId,
      'PREDICTIVE_DIALER',
      phoneNumber,
      { channelVariables: originateVars }
    );

    if (!dialString) {
      // Not a routable number. Refusing is the only safe answer — building
      // `sofia/gateway/<gw>/<garbage>` would burn an attempt, and the
      // reservation, on a call that cannot connect.
      throw new Error(`refusing to originate: ${lead.phoneNumber} is not a routable destination`);
    }

    const application = `&socket(${SOCKET_LISTENER_HOST}:${SOCKET_LISTENER_PORT} async full)`;

    const originateCmd = `originate ${dialString} ${application}`;

    logger.info({
      msg: 'Originating call',
      leadId: lead.id,
      phone: phoneNumber,
      carrierOrder: chain.carrierOrder,
      gateways: chain.gateways.map(g => g.gateway),
      routeSource: chain.source,
    });

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
   * Record that a human was actually reached.
   *
   * `CONTACTED` means exactly that and nothing weaker. The old code set it — and
   * `autodialer.ts` still would — before the originate command was even sent,
   * which marks a lead contacted whether it rings, is busy, is disconnected, or
   * is never dialed at all, and corrupts every conversion denominator that
   * divides by it.
   *
   * Only an answer event may call this. `attemptLead` deliberately does not.
   */
  async recordHumanContact(leadId: string, outcome: AttemptOutcome): Promise<void> {
    if (!provesHumanContact(outcome)) {
      throw new Error(
        `refusing to mark lead ${leadId} CONTACTED: ${outcome} is not evidence a human was reached`
      );
    }
    // No cast into an enum member that may not exist. `CONTACTED` is a declared
    // member of LeadStatus and always has been — F-1 was only ever about
    // `DIALING`, which is now a reservation state rather than a lead status.
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'CONTACTED', lastContactedAt: new Date() },
    });
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
