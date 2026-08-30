/**
 * Auction Service - RTB Ping Engine
 *
 * Handles real-time bidding for lead auctions.
 * Evaluates buyer eligibility, runs the auction, and returns bid tokens.
 *
 * Architecture Constraints Applied:
 * 1. Money Safety: All monetary values use Decimal (Prisma) / number math with fixed precision
 * 2. Operating Hours: Supports split shifts (array of time ranges per day)
 * 3. Pricing Rules: Structured JSON format (field/op/val) - NO code strings
 * 4. Thundering Herd: Redis-based reserved cap tracking for high concurrency
 * 5. Signed Tokens: JWT HS256 tokens containing ping_id, bid_amount, buyer_id
 */

import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import {
  checkCallerStateEligibility,
  resolveCallerState as resolveStateFromSources,
  type StateResolutionSource,
} from '../lib/geo.js';
import { logger } from '../lib/logger.js';
import { callerStateUnresolvedTotal } from '../lib/metrics.js';
import { getPrismaClient } from '../lib/prisma.js';

import { getRedisClient } from './redis.js';

// ============================================================================
// Types
// ============================================================================

export interface PingPayload {
  request_id?: string;
  vertical?: string;
  caller: {
    zip?: string;
    state?: string;
    age?: number;
    [key: string]: unknown;
  };
  source?: string;
  min_bid?: number;
}

export interface PingResult {
  ping_id: string;
  bid: number;
  token?: string;
  expires_at?: string;
  message?: string;
}

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

// Structured pricing rule format (safe from code injection)
export interface PricingRule {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  val: string | number | (string | number)[];
  adjustment: string; // Decimal string for precision
}

// Split-shift hours format
export interface TimeRange {
  start: string; // "09:00"
  end: string; // "17:00"
}

export type HoursOfOperation = {
  [day: string]: TimeRange[];
};

interface EligibleBuyer {
  endpointId: string;
  buyerId: string;
  buyerName: string;
  destination: string;
  basePrice: Decimal;
  pricingRules: PricingRule[] | null;
  acceptedStates: string[];
  hoursOfOperation: HoursOfOperation | null;
  timezone: string | null;
  maxCap: number;
  capPeriod: string;
  status: string;
}

// ============================================================================
// Auction Service
// ============================================================================

export class AuctionService {
  private readonly BID_TOKEN_TTL_SECONDS = 300; // 5 minutes
  private readonly REDIS_CAP_TTL_SECONDS = 300; // 5 minutes for reserved cap
  private readonly JWT_SECRET: string;

  constructor() {
    this.JWT_SECRET =
      process.env.JWT_SECRET || process.env.PING_TOKEN_SECRET || 'default-ping-secret';
  }

  /**
   * Main entry point for RTB ping processing
   */
  async processPing(publisherId: string, payload: PingPayload): Promise<PingResult> {
    const prisma = getPrismaClient();

    // Idempotency check
    if (payload.request_id) {
      const cached = await this.getCachedResult(payload.request_id);
      if (cached) {
        logger.info({ msg: 'Returning cached ping result', requestId: payload.request_id });
        return cached;
      }
    }

    // Resolve caller state from payload
    const { state: callerState, source: callerStateSource } = this.resolveCallerState(payload);
    logger.info({
      msg: 'RTB ping: Resolved caller state',
      requestId: payload.request_id,
      resolvedState: callerState,
      resolvedStateSource: callerStateSource,
    });
    if (callerStateSource === 'UNRESOLVED') {
      callerStateUnresolvedTotal.inc({ ingress_path: 'rtb_ping' });
    }

    // Fetch eligible buyer endpoints
    const endpoints = await this.fetchEligibleEndpoints(publisherId, payload.vertical);

    if (endpoints.length === 0) {
      const pingRequest = await this.savePingRequest(prisma, publisherId, payload, 'NO_BID');
      return {
        ping_id: pingRequest.id,
        bid: 0,
        message: 'No matching buyers',
      };
    }

    // Run filters and calculate bids in parallel
    const bidPromises = endpoints.map(async endpoint => {
      // Filter checks
      const geoCheck = this.checkGeo(callerState, endpoint.acceptedStates);
      if (!geoCheck.pass) {
        return {
          endpoint,
          bid: null,
          status: 'FILTERED' as const,
          reason: geoCheck.reason || null,
        };
      }

      const hoursCheck = this.checkHours(endpoint.hoursOfOperation, endpoint.timezone);
      if (!hoursCheck.pass) {
        return {
          endpoint,
          bid: null,
          status: 'FILTERED' as const,
          reason: hoursCheck.reason || null,
        };
      }

      const capCheck = await this.checkCap(
        endpoint.endpointId,
        endpoint.maxCap,
        endpoint.capPeriod
      );
      if (!capCheck.pass) {
        return {
          endpoint,
          bid: null,
          status: 'FILTERED' as const,
          reason: capCheck.reason || null,
        };
      }

      // Calculate bid
      const bidAmount = this.calculateBid(endpoint.basePrice, endpoint.pricingRules, payload);

      // Check min bid floor
      if (payload.min_bid && bidAmount < payload.min_bid) {
        return {
          endpoint,
          bid: null,
          status: 'FILTERED' as const,
          reason: `Bid ${bidAmount} below floor ${payload.min_bid}`,
        };
      }

      return { endpoint, bid: bidAmount, status: 'LOST' as const, reason: null };
    });

    const bidResults = await Promise.all(bidPromises);

    // Sort valid bids by price (desc) and select winner
    const validBids = bidResults
      .filter(r => r.bid !== null)
      .sort((a, b) => (b.bid ?? 0) - (a.bid ?? 0));

    if (validBids.length === 0) {
      const pingRequest = await this.savePingRequest(prisma, publisherId, payload, 'NO_BID');
      // Save filtered bids for audit
      await this.saveBuyerBids(prisma, pingRequest.id, bidResults);
      return {
        ping_id: pingRequest.id,
        bid: 0,
        message: 'No matching buyers after filtering',
      };
    }

    // Winner selection
    const winner = validBids[0];

    // Reserve cap in Redis (thundering herd protection)
    await this.reserveCap(winner.endpoint.endpointId);

    // Save to database
    const pingRequest = await this.savePingRequest(prisma, publisherId, payload, 'WON');

    // Mark winner and losers
    const bidsWithStatus = bidResults.map(r => ({
      ...r,
      status: r.endpoint.endpointId === winner.endpoint.endpointId ? ('WON' as const) : r.status,
    }));
    await this.saveBuyerBids(prisma, pingRequest.id, bidsWithStatus);

    // Update winning bid ID
    const winningBid = await prisma.buyerBid.findFirst({
      where: { pingRequestId: pingRequest.id, status: 'WON' },
    });
    if (winningBid) {
      await prisma.pingRequest.update({
        where: { id: pingRequest.id },
        data: { winningBidId: winningBid.id },
      });
    }

    // Generate signed token
    const expiresAt = new Date(Date.now() + this.BID_TOKEN_TTL_SECONDS * 1000);
    const token = await this.generateBidToken(
      pingRequest.id,
      winner.bid,
      winner.endpoint.buyerId,
      expiresAt
    );

    // Cache result for idempotency
    const result: PingResult = {
      ping_id: pingRequest.id,
      bid: winner.bid,
      token,
      expires_at: expiresAt.toISOString(),
    };

    if (payload.request_id) {
      await this.cacheResult(payload.request_id, result);
    }

    logger.info({
      msg: 'Ping auction completed',
      pingId: pingRequest.id,
      winningBid: winner.bid,
      buyerId: winner.endpoint.buyerId,
      totalCandidates: endpoints.length,
      filteredOut: bidResults.filter(r => r.bid === null).length,
    });

    return result;
  }

  // ============================================================================
  // State Resolution
  // ============================================================================

  private resolveCallerState(payload: PingPayload): { state: string | null; source: StateResolutionSource } {
    return resolveStateFromSources({
      suppliedState: payload.caller?.state,
      zip: payload.caller?.zip,
    });
  }

  // ============================================================================
  // Data Fetching
  // ============================================================================

  private async fetchEligibleEndpoints(
    publisherId: string,
    _vertical?: string
  ): Promise<EligibleBuyer[]> {
    const prisma = getPrismaClient();

    // Fetch active buyer endpoints for this publisher
    const endpoints = await prisma.buyerEndpoint.findMany({
      where: {
        status: 'ACTIVE',
        buyer: {
          status: 'ACTIVE',
          publisherId,
        },
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return endpoints.map(ep => ({
      endpointId: ep.id,
      buyerId: ep.buyer.id,
      buyerName: ep.buyer.name,
      destination: ep.destination,
      basePrice: ep.basePrice,
      pricingRules: ep.pricingRules as PricingRule[] | null,
      acceptedStates: ep.acceptedStates,
      hoursOfOperation: ep.hoursOfOperation as HoursOfOperation | null,
      timezone: ep.timezone,
      maxCap: ep.maxCap,
      capPeriod: ep.capPeriod,
      status: ep.status,
    }));
  }

  // ============================================================================
  // Filter Methods
  // ============================================================================

  private checkGeo(callerState: string | null, acceptedStates: string[]): FilterResult {
    const { accepted, reason } = checkCallerStateEligibility(callerState, acceptedStates);
    if (!accepted) {
      // Distinct rejection reason for unresolved state vs. an ordinary geo
      // mismatch, so the two don't look identical in BuyerBid.rejectionReason.
      if (reason === 'STATE_UNRESOLVED') {
        return {
          pass: false,
          reason: `STATE_UNRESOLVED: caller state could not be determined, buyer requires one of [${acceptedStates.join(', ')}]`,
        };
      }
      return { pass: false, reason: `State ${callerState} not in accepted states` };
    }
    return { pass: true };
  }

  /**
   * Check operating hours with split-shift support
   * Iterates through all time blocks for the current day
   */
  public checkHours(
    hoursOfOperation: HoursOfOperation | null,
    timezone: string | null
  ): FilterResult {
    // If no hours configured, buyer is always open (24/7)
    if (!hoursOfOperation) {
      return { pass: true };
    }

    const tz = timezone || 'America/New_York';
    const now = new Date();

    // Get day of week in buyer's timezone
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz });
    const dayOfWeek = dayFormatter.format(now).toLowerCase(); // "mon", "tue", etc.

    const todayHours = hoursOfOperation[dayOfWeek];

    // If no hours for today, buyer is closed
    if (!todayHours || todayHours.length === 0) {
      return { pass: false, reason: `Buyer closed on ${dayOfWeek}` };
    }

    // Get current time in buyer's timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    const currentTime = timeFormatter.format(now); // "14:30"

    // Check if current time falls within any time block (split shifts)
    const isOpen = todayHours.some(block => {
      return currentTime >= block.start && currentTime < block.end;
    });

    if (!isOpen) {
      return { pass: false, reason: `Buyer closed at ${currentTime} (${tz})` };
    }

    return { pass: true };
  }

  /**
   * Cap check with Redis thundering herd protection
   * Formula: (SQL_Actual_Count + Redis_Reserved_Count) < Max_Cap
   */
  public async checkCap(
    endpointId: string,
    maxCap: number,
    capPeriod: string
  ): Promise<FilterResult> {
    // 0 maxCap = unlimited
    if (maxCap === 0) {
      return { pass: true };
    }

    const prisma = getPrismaClient();
    // Redis client is used via getReservedCap method

    // Calculate time boundary based on cap period
    const now = new Date();
    let startTime: Date;

    switch (capPeriod) {
      case 'HOUR':
        startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
        break;
      case 'MONTH':
        startTime = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'DAY':
      default:
        startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
    }

    // Get actual count from database
    const [actualCount, reservedCount] = await Promise.all([
      prisma.call.count({
        where: {
          targetId: endpointId,
          createdAt: { gte: startTime },
          status: { in: ['COMPLETED', 'ANSWERED'] },
        },
      }),
      this.getReservedCap(endpointId),
    ]);

    const totalUsed = actualCount + reservedCount;

    if (totalUsed >= maxCap) {
      return { pass: false, reason: `Cap exceeded: ${totalUsed}/${maxCap}` };
    }

    return { pass: true };
  }

  // ============================================================================
  // Redis Cap Management (Thundering Herd Protection)
  // ============================================================================

  private getCapKey(endpointId: string): string {
    return `ping:cap:reserved:${endpointId}`;
  }

  private async getReservedCap(endpointId: string): Promise<number> {
    try {
      const redis = getRedisClient();
      const value = await redis.get(this.getCapKey(endpointId));
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      logger.warn({ msg: 'Redis error getting reserved cap, falling back to 0', error });
      return 0;
    }
  }

  private async reserveCap(endpointId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = this.getCapKey(endpointId);
      await redis.incr(key);
      await redis.expire(key, this.REDIS_CAP_TTL_SECONDS);
    } catch (error) {
      logger.warn({ msg: 'Redis error reserving cap', endpointId, error });
    }
  }

  // ============================================================================
  // Pricing Calculation
  // ============================================================================

  /**
   * Calculate bid price with structured pricing rules (safe evaluation)
   */
  private calculateBid(
    basePrice: Decimal,
    pricingRules: PricingRule[] | null,
    payload: PingPayload
  ): number {
    let price = Number(basePrice);

    if (!pricingRules || pricingRules.length === 0) {
      return price;
    }

    for (const rule of pricingRules) {
      if (this.evaluateRule(rule, payload)) {
        const adjustment = parseFloat(rule.adjustment);
        price += adjustment;
      }
    }

    // Ensure non-negative
    return Math.max(0, price);
  }

  /**
   * Safe rule evaluation - no code execution, structured comparison only
   */
  private evaluateRule(rule: PricingRule, payload: PingPayload): boolean {
    const fieldValue = payload.caller?.[rule.field];

    if (fieldValue === undefined || fieldValue === null) {
      return false;
    }

    switch (rule.op) {
      case 'eq':
        return fieldValue === rule.val;
      case 'neq':
        return fieldValue !== rule.val;
      case 'gt':
        return typeof fieldValue === 'number' && fieldValue > (rule.val as number);
      case 'gte':
        return typeof fieldValue === 'number' && fieldValue >= (rule.val as number);
      case 'lt':
        return typeof fieldValue === 'number' && fieldValue < (rule.val as number);
      case 'lte':
        return typeof fieldValue === 'number' && fieldValue <= (rule.val as number);
      case 'in':
        return Array.isArray(rule.val) && rule.val.includes(fieldValue as string | number);
      default:
        return false;
    }
  }

  // ============================================================================
  // Token Generation (HS256 Signed JWT)
  // ============================================================================

  private async generateBidToken(
    pingId: string,
    bidAmount: number,
    buyerId: string,
    expiresAt: Date
  ): Promise<string> {
    // Simple HS256 JWT implementation
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      ping_id: pingId,
      bid_amount: bidAmount,
      buyer_id: buyerId,
      exp: Math.floor(expiresAt.getTime() / 1000),
      iat: Math.floor(Date.now() / 1000),
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signature = await this.hmacSha256(`${encodedHeader}.${encodedPayload}`, this.JWT_SECRET);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async hmacSha256(message: string, secret: string): Promise<string> {
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(message);
    return hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Verify a bid token (for POST endpoint)
   */
  async verifyBidToken(token: string): Promise<{
    valid: boolean;
    pingId?: string;
    bidAmount?: number;
    buyerId?: string;
    error?: string;
  }> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      const [encodedHeader, encodedPayload, signature] = parts;

      // Verify signature
      const expectedSignature = await this.hmacSha256(
        `${encodedHeader}.${encodedPayload}`,
        this.JWT_SECRET
      );
      if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid signature' };
      }

      // Decode payload
      interface BidTokenPayload {
        exp?: number;
        ping_id?: string;
        bid_amount?: number;
        buyer_id?: string;
      }
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64').toString()
      ) as BidTokenPayload;

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, error: 'Token expired' };
      }

      return {
        valid: true,
        pingId: payload.ping_id,
        bidAmount: payload.bid_amount,
        buyerId: payload.buyer_id,
      };
    } catch (error) {
      return { valid: false, error: 'Token verification failed' };
    }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private async savePingRequest(
    prisma: ReturnType<typeof getPrismaClient>,
    publisherId: string,
    payload: PingPayload,
    status: 'PROCESSING' | 'WON' | 'NO_BID'
  ) {
    const expiresAt = new Date(Date.now() + this.BID_TOKEN_TTL_SECONDS * 1000);

    return prisma.pingRequest.create({
      data: {
        publisherId,
        requestId: payload.request_id || null,
        vertical: payload.vertical || null,
        payload: payload as unknown as Prisma.InputJsonValue,
        status,
        minBidAmount: payload.min_bid ? new Decimal(payload.min_bid) : null,
        expiresAt,
      },
    });
  }

  private async saveBuyerBids(
    prisma: ReturnType<typeof getPrismaClient>,
    pingRequestId: string,
    bids: Array<{
      endpoint: EligibleBuyer;
      bid: number | null;
      status: 'WON' | 'LOST' | 'FILTERED';
      reason: string | null;
    }>
  ) {
    const bidData = bids.map(b => ({
      pingRequestId,
      buyerEndpointId: b.endpoint.endpointId,
      buyerId: b.endpoint.buyerId,
      amount: new Decimal(b.bid ?? 0),
      status: b.status,
      rejectionReason: b.reason,
    }));

    await prisma.buyerBid.createMany({
      data: bidData,
    });
  }

  // ============================================================================
  // Idempotency Cache
  // ============================================================================

  private async getCachedResult(requestId: string): Promise<PingResult | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`ping:result:${requestId}`);
      return cached ? (JSON.parse(cached) as PingResult) : null;
    } catch (error) {
      logger.warn({ msg: 'Redis error getting cached result', requestId, error });
      return null;
    }
  }

  private async cacheResult(requestId: string, result: PingResult): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setex(
        `ping:result:${requestId}`,
        this.BID_TOKEN_TTL_SECONDS,
        JSON.stringify(result)
      );
    } catch (error) {
      logger.warn({ msg: 'Redis error caching result', requestId, error });
    }
  }
}

export const auctionService = new AuctionService();
