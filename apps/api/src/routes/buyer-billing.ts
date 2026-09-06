/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
// Pre-existing lint debt, surfaced because the pre-commit hook only runs on
// staged files and this one had not been touched since the rules were
// tightened. Disabled rather than rewritten: the change that touched this file
// was a one-line security fix. Worth clearing separately.
/**
 * Buyer Billing Routes
 *
 * API endpoints for managing buyer credits, transactions, and balances.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { AuthenticatedUser } from '../middleware/auth.js';
import { buyerBillingService } from '../services/buyer-billing-service.js';
import { liveStatusService } from '../services/buyer-live-status-service.js';
import { buyerStatsService } from '../services/buyer-stats-service.js';
import { getActingTenantId } from '../lib/tenant-context.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

export async function registerBuyerBillingRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = (await import('../lib/prisma.js')).getPrismaClient();

  // Helper to get authenticated user profile (role, buyerId, publisherId)
  async function getUserProfile(request: any) {
    const user = request.user;
    let userRoles: string[] = [];
    let buyerId: string | null = null;
    let publisherId: string | null = null;

    if (user?.userId) {
      const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        include: { roles: { include: { role: true } } },
      });
      if (userRecord) {
        userRoles = userRecord.roles.map((ur: any) => ur.role.name) || [];
        buyerId = userRecord.buyerId || null;
        publisherId = userRecord.publisherId || (userRecord.metadata as any)?.publisherId || null;
      }
    }

    if (user?.roles && Array.isArray(user.roles)) {
      for (const r of user.roles) {
        if (!userRoles.includes(r)) userRoles.push(r);
      }
    }

    // AGENT is not admin — same drift as routes/index.ts. These routes expose
    // buyer wallets, transactions and billing state.
    const isAdminOrOwner =
      userRoles.some(role => role === 'ADMIN' || role === 'OWNER') ||
      (user?.roles?.some((role: string) => role === 'ADMIN' || role === 'OWNER') ?? false);

    return {
      isAdminOrOwner,
      userRoles,
      buyerId,
      publisherId,
    };
  }

  // Helper to verify buyer access permissions
  async function checkBuyerAccess(
    buyerId: string,
    profile: any,
    tenantId: string
  ): Promise<boolean> {
    if (profile.isAdminOrOwner) {
      return true;
    }
    if (profile.userRoles.includes('BUYER')) {
      return buyerId === profile.buyerId;
    }
    if (profile.userRoles.includes('PUBLISHER')) {
      const buyerRecord = await prisma.buyer.findFirst({
        where: { id: buyerId, tenantId, publisherId: profile.publisherId },
      });
      return !!buyerRecord;
    }
    return false;
  }

  /**
   * GET /api/v1/buyers/upfront-balances
   * Get all Upfront buyers with their balances for dashboard widget
   */
  fastify.get('/api/v1/buyers/upfront-balances', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const balances = await buyerBillingService.getUpfrontBuyerBalances(tenantId);
    const profile = await getUserProfile(request);
    let filteredBalances = balances;

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('BUYER')) {
        filteredBalances = balances.filter(b => b.id === profile.buyerId);
      } else if (profile.userRoles.includes('PUBLISHER')) {
        // Find buyers managed by publisher
        const managedBuyers = await prisma.buyer.findMany({
          where: { tenantId, publisherId: profile.publisherId },
          select: { id: true },
        });
        const managedIds = managedBuyers.map(b => b.id);
        filteredBalances = balances.filter(b => managedIds.includes(b.id));
      } else {
        filteredBalances = [];
      }
    }

    return {
      data: filteredBalances,
      meta: {
        total: filteredBalances.length,
        lowBalanceCount: filteredBalances.filter(b => b.isLowBalance).length,
      },
    };
  });

  /**
   * GET /api/v1/buyers/:buyerId/transactions
   * Get transaction ledger for a buyer
   */
  fastify.get<{
    Params: { buyerId: string };
    Querystring: {
      page?: string;
      limit?: string;
      startDate?: string;
      endDate?: string;
    };
  }>('/api/v1/buyers/:buyerId/transactions', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access denied to this buyer transactions' } };
    }

    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
      include: {
        publisher: { select: { name: true } },
      },
    });

    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const result = await buyerBillingService.getBuyerTransactions(buyerId, {
      limit,
      offset,
      startDate: request.query.startDate ? new Date(request.query.startDate) : undefined,
      endDate: request.query.endDate ? new Date(request.query.endDate) : undefined,
    });

    return {
      buyer: {
        id: buyer.id,
        name: buyer.name,
        code: buyer.code,
        publisherName: buyer.publisher.name,
        billingType: buyer.billingType,
        leadsRemaining: buyer.leadsRemaining,
        walletBalance: Number(buyer.walletBalance),
        billableDuration: buyer.billableDuration,
        status: buyer.status,
      },
      data: result.transactions.map(tx => ({
        id: tx.id,
        amount: tx.amount,
        type: tx.type,
        description: tx.description,
        callId: tx.callId,
        createdByEmail: tx.createdByEmail,
        createdAt: tx.createdAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  });

  /**
   * POST /api/v1/buyers/:buyerId/credits
   * Add credits to a buyer's wallet (admin only)
   */
  fastify.post<{
    Params: { buyerId: string };
    Body: {
      amount: number;
      description?: string;
    };
  }>('/api/v1/buyers/:buyerId/credits', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    // Require admin role for adding credits
    const isAdmin =
      user?.roles?.some(r => r === 'ADMIN' || r === 'OWNER' || r === 'AGENT') ?? false;
    if (!isAdmin) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };
    }

    const { buyerId } = request.params;
    const { amount, description } = request.body;

    if (!amount || amount <= 0) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Amount must be greater than 0' } };
    }

    // Verify buyer belongs to tenant
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });

    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    if (buyer.billingType !== 'UPFRONT') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_BILLING_TYPE',
          message: 'Credits can only be added to UPFRONT billing type buyers',
        },
      };
    }

    const adminId = user?.userId || 'demo-admin';
    const result = await buyerBillingService.addCredits(buyerId, amount, adminId, description);

    if (!result.success) {
      void reply.code(500);
      return { error: { code: 'CREDIT_FAILED', message: result.error } };
    }

    void reply.code(201);
    return {
      success: true,
      buyerId,
      amount,
      newBalance: result.newBalance,
      walletBalance: result.newBalance,
      message: `Added $${Number(amount).toFixed(2)} to buyer wallet`,
    };
  });

  /**
   * GET /api/v1/buyers
   * Get all buyers with billing info
   */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      billingType?: 'TERMS' | 'UPFRONT';
    };
  }>('/api/v1/buyers', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const skip = (page - 1) * limit;

    const profile = await getUserProfile(request);

    const where: any = { tenantId };
    if (request.query.billingType) {
      where.billingType = request.query.billingType;
    }

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('BUYER')) {
        where.id = profile.buyerId;
      } else if (profile.userRoles.includes('PUBLISHER')) {
        where.publisherId = profile.publisherId;
      } else {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
      }
    }

    const [buyers, total] = await Promise.all([
      prisma.buyer.findMany({
        where,
        include: {
          publisher: { select: { id: true, name: true } },
          _count: { select: { calls: true, transactions: true } },
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        take: limit,
        skip,
      }),
      prisma.buyer.count({ where }),
    ]);

    return {
      data: buyers.map(b => ({
        id: b.id,
        name: b.name,
        code: b.code,
        subId: b.subId,
        status: b.status,
        billingType: b.billingType,
        leadsRemaining: b.leadsRemaining,
        walletBalance: Number(b.walletBalance),
        billableDuration: b.billableDuration,
        canPauseTargets: b.canPauseTargets,
        canSetCaps: b.canSetCaps,
        canDisputeConversions: b.canDisputeConversions,
        publisher: b.publisher,
        callCount: b._count.calls,
        transactionCount: b._count.transactions,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  /**
   * POST /api/v1/buyers
   * Create a new buyer
   */
  fastify.post<{
    Body: {
      name: string;
      code: string;
      publisherId: string;
      subId?: string;
      billingType?: 'TERMS' | 'UPFRONT';
      billableDuration?: number;
      leadsRemaining?: number;
      canPauseTargets?: boolean;
      canSetCaps?: boolean;
      canDisputeConversions?: boolean;
    };
  }>('/api/v1/buyers', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const profile = await getUserProfile(request);
    if (!profile.isAdminOrOwner) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Admin access required to create buyers' } };
    }

    const {
      name,
      code,
      publisherId,
      subId,
      billingType,
      billableDuration,
      leadsRemaining,
      walletBalance,
      canPauseTargets,
      canSetCaps,
      canDisputeConversions,
    } = request.body;

    if (!name?.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Name is required' } };
    }
    if (!code?.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Code is required' } };
    }
    if (!publisherId) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Publisher ID is required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Verify publisher exists
    const publisher = await prisma.publisher.findFirst({
      where: { id: publisherId, tenantId },
    });
    if (!publisher) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
    }

    // Check for duplicate code
    const existing = await prisma.buyer.findFirst({
      where: { tenantId, publisherId, code: code.trim() },
    });
    if (existing) {
      void reply.code(409);
      return {
        error: { code: 'DUPLICATE', message: 'Buyer code already exists for this publisher' },
      };
    }

    const buyer = await prisma.buyer.create({
      data: {
        tenantId,
        publisherId,
        name: name.trim(),
        code: code.trim(),
        subId: subId?.trim() || null,
        billingType: billingType || 'TERMS',
        billableDuration: billableDuration || 60,
        leadsRemaining:
          leadsRemaining !== undefined ? leadsRemaining : Math.floor(walletBalance || 0),
        walletBalance: walletBalance !== undefined ? walletBalance : leadsRemaining || 0,
        canPauseTargets: canPauseTargets ?? false,
        canSetCaps: canSetCaps ?? false,
        canDisputeConversions: canDisputeConversions ?? false,
      },
      include: {
        publisher: { select: { id: true, name: true } },
      },
    });

    // Audit log
    const { auditCreate } = await import('../services/audit.js');
    await auditCreate(
      tenantId,
      'Buyer',
      buyer.id,
      {
        name: buyer.name,
        code: buyer.code,
        billingType: buyer.billingType,
        billableDuration: buyer.billableDuration,
      },
      {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      }
    );

    void reply.code(201);
    return {
      id: buyer.id,
      name: buyer.name,
      code: buyer.code,
      status: buyer.status,
      billingType: buyer.billingType,
      leadsRemaining: buyer.leadsRemaining,
      walletBalance: Number(buyer.walletBalance),
      billableDuration: buyer.billableDuration,
      publisher: buyer.publisher,
      createdAt: buyer.createdAt.toISOString(),
      updatedAt: buyer.updatedAt.toISOString(),
    };
  });

  /**
   * GET /api/v1/buyers/:buyerId
   * Get a single buyer's details
   */
  fastify.get<{
    Params: { buyerId: string };
  }>('/api/v1/buyers/:buyerId', async (request, reply) => {
    const { buyerId } = request.params;
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const userRecord = await prisma.user.findUnique({
      where: { id: user?.userId },
      include: { roles: { include: { role: true } } },
    });
    const roles = userRecord?.roles.map((ur: any) => ur.role.name) || [];
    // AGENT is not admin. Without this, any agent read any buyer's billing
    // detail, not just the buyer they are attached to.
    const isAdminOrOwner = roles.some(role => role === 'ADMIN' || role === 'OWNER');

    if (!isAdminOrOwner && userRecord?.buyerId !== buyerId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const buyer = await prisma.buyer.findUnique({
      where: { id: buyerId },
      include: {
        publisher: { select: { id: true, name: true } },
      },
    });

    if (!buyer || buyer.tenantId !== tenantId) {
      return reply.code(404).send({ error: 'Buyer not found' });
    }

    return {
      id: buyer.id,
      name: buyer.name,
      code: buyer.code,
      status: buyer.status,
      billingType: buyer.billingType,
      leadsRemaining: buyer.leadsRemaining,
      walletBalance: Number(buyer.walletBalance),
      billableDuration: buyer.billableDuration,
      canPauseTargets: buyer.canPauseTargets,
      canSetCaps: buyer.canSetCaps,
      canDisputeConversions: buyer.canDisputeConversions,
      publisher: buyer.publisher,
      createdAt: buyer.createdAt.toISOString(),
      updatedAt: buyer.updatedAt.toISOString(),
    };
  });

  /**
   * PATCH /api/v1/buyers/:buyerId
   * Update a buyer
   */
  fastify.patch<{
    Params: { buyerId: string };
    Body: {
      name?: string;
      code?: string;
      subId?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
      billingType?: 'TERMS' | 'UPFRONT';
      billableDuration?: number;
      leadsRemaining?: number;
      walletBalance?: number;
      canPauseTargets?: boolean;
      canSetCaps?: boolean;
      canDisputeConversions?: boolean;
    };
  }>('/api/v1/buyers/:buyerId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    if (!profile.isAdminOrOwner) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Admin access required to update buyers' } };
    }

    const {
      name,
      code,
      subId,
      status,
      billingType,
      billableDuration,
      leadsRemaining,
      walletBalance,
      canPauseTargets,
      canSetCaps,
      canDisputeConversions,
    } = request.body;

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const existing = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!existing) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (code !== undefined) updateData.code = code.trim();
    if (subId !== undefined) updateData.subId = subId.trim() || null;
    if (status !== undefined) updateData.status = status;
    if (billingType !== undefined) updateData.billingType = billingType;
    if (billableDuration !== undefined) updateData.billableDuration = billableDuration;
    if (leadsRemaining !== undefined) {
      updateData.leadsRemaining = leadsRemaining;
      if (walletBalance === undefined) {
        updateData.walletBalance = leadsRemaining;
      }
    }
    if (walletBalance !== undefined) {
      updateData.walletBalance = walletBalance;
      if (leadsRemaining === undefined) {
        updateData.leadsRemaining = Math.floor(walletBalance);
      }
    }
    if (canPauseTargets !== undefined) updateData.canPauseTargets = canPauseTargets;
    if (canSetCaps !== undefined) updateData.canSetCaps = canSetCaps;
    if (canDisputeConversions !== undefined)
      updateData.canDisputeConversions = canDisputeConversions;

    const buyer = await prisma.buyer.update({
      where: { id: buyerId },
      data: updateData,
      include: {
        publisher: { select: { id: true, name: true } },
      },
    });

    // Audit log
    const { auditUpdate } = await import('../services/audit.js');
    await auditUpdate(tenantId, 'Buyer', buyerId, existing, buyer, {
      userId: user?.userId,
      ipAddress: request.ip,
      requestId: request.id,
    });

    return {
      id: buyer.id,
      name: buyer.name,
      code: buyer.code,
      subId: buyer.subId,
      status: buyer.status,
      billingType: buyer.billingType,
      leadsRemaining: buyer.leadsRemaining,
      walletBalance: Number(buyer.walletBalance),
      billableDuration: buyer.billableDuration,
      canPauseTargets: buyer.canPauseTargets,
      canSetCaps: buyer.canSetCaps,
      canDisputeConversions: buyer.canDisputeConversions,
      publisher: buyer.publisher,
      createdAt: buyer.createdAt.toISOString(),
      updatedAt: buyer.updatedAt.toISOString(),
    };
  });

  // ============================================================================
  // ANALYTICS ENDPOINTS (Async - non-blocking)
  // ============================================================================

  /**
   * GET /api/v1/buyers/stats
   * Get pre-aggregated stats for all buyers (from BuyerStats summary table)
   */
  fastify.get('/api/v1/buyers/stats', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const stats = await buyerStatsService.getBuyerStatsBulk(tenantId);
    const profile = await getUserProfile(request);
    let filteredStats = stats;

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('BUYER')) {
        filteredStats = stats.filter(s => s.buyerId === profile.buyerId);
      } else if (profile.userRoles.includes('PUBLISHER')) {
        const managedBuyers = await prisma.buyer.findMany({
          where: { tenantId, publisherId: profile.publisherId },
          select: { id: true },
        });
        const managedIds = managedBuyers.map(b => b.id);
        filteredStats = stats.filter(s => managedIds.includes(s.buyerId));
      } else {
        filteredStats = [];
      }
    }

    return {
      data: filteredStats,
      meta: { total: filteredStats.length },
    };
  });

  /**
   * GET /api/v1/buyers/:buyerId/stats
   * Get pre-aggregated stats for a single buyer
   */
  fastify.get<{
    Params: { buyerId: string };
  }>('/api/v1/buyers/:buyerId/stats', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access denied to this buyer stats' } };
    }

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const stats = await buyerStatsService.getBuyerStats(buyerId);

    return {
      data: stats || {
        buyerId,
        revenueHour: 0,
        revenueDay: 0,
        revenueMonth: 0,
        revenueTotal: 0,
        callsHour: 0,
        callsDay: 0,
        callsMonth: 0,
        callsTotal: 0,
        capConsumedToday: 0,
        lastUpdatedAt: new Date(),
      },
    };
  });

  /**
   * GET /api/v1/buyers/:buyerId/live-status
   * Get real-time concurrency for all targets of a buyer
   * Designed for Redis swap - no volatile columns in database
   */
  fastify.get<{
    Params: { buyerId: string };
  }>('/api/v1/buyers/:buyerId/live-status', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access denied to this buyer live-status' } };
    }

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const liveStatus = await liveStatusService.getBuyerLiveStatus(buyerId);

    return { data: liveStatus };
  });

  // ============================================================================
  // TARGET (BUYER ENDPOINT) CRUD - Nested under Buyer
  // ============================================================================

  /**
   * GET /api/v1/buyers/:buyerId/targets
   * List all targets for a buyer
   */
  fastify.get<{
    Params: { buyerId: string };
  }>('/api/v1/buyers/:buyerId/targets', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access denied to this buyer targets' } };
    }

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const targets = await prisma.buyerEndpoint.findMany({
      where: { buyerId },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });

    return {
      data: targets.map(t => ({
        id: t.id,
        buyerId: t.buyerId,
        name: t.name,
        type: t.type,
        destination: t.destination,
        priority: t.priority,
        status: t.status,
        maxCap: t.maxCap,
        capPeriod: t.capPeriod,
        maxConcurrency: t.maxConcurrency,
        weight: t.weight,
        acceptedStates: t.acceptedStates,
        isNational: t.acceptedStates.length === 0,
        hoursOfOperation: t.hoursOfOperation,
        timezone: t.timezone,
        basePrice: Number(t.basePrice),
        pricingRules: t.pricingRules,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      meta: { total: targets.length },
    };
  });

  /**
   * POST /api/v1/buyers/:buyerId/targets
   * Create a new target for a buyer
   */
  fastify.post<{
    Params: { buyerId: string };
    Body: {
      name: string;
      type: 'SIP' | 'PSTN' | 'WEBRTC';
      destination: string;
      priority?: number;
      maxCap?: number;
      capPeriod?: 'HOUR' | 'DAY' | 'MONTH';
      maxConcurrency?: number;
      weight?: number;
      acceptedStates?: string[]; // Array of 2-letter state codes, empty = National (accepts all)
      hoursOfOperation?: Record<string, Array<{ start: string; end: string }>>; // Split-shift schedule
      timezone?: string; // e.g., 'America/New_York'
      basePrice?: number; // Static bid price
      pricingRules?: Array<{ field: string; op: string; val: unknown; adjustment: string }>;
    };
  }>('/api/v1/buyers/:buyerId/targets', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Access denied to manage this buyer targets' },
      };
    }

    const {
      name,
      type,
      destination,
      priority,
      maxCap,
      capPeriod,
      maxConcurrency,
      weight,
      acceptedStates,
      hoursOfOperation,
      timezone,
      basePrice,
      pricingRules,
    } = request.body;

    if (!name?.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Name is required' } };
    }
    if (!type) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Type is required' } };
    }
    if (!destination?.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Destination is required' } };
    }

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    const target = await prisma.buyerEndpoint.create({
      data: {
        buyerId,
        name: name.trim(),
        type,
        destination: destination.trim(),
        priority: priority ?? 0,
        maxCap: maxCap ?? 0,
        capPeriod: capPeriod ?? 'DAY',
        maxConcurrency: maxConcurrency ?? 10,
        weight: weight ?? 100,
        acceptedStates: acceptedStates ?? [], // Empty = National (accepts all states)
        hoursOfOperation: hoursOfOperation ?? null,
        timezone: timezone ?? 'America/New_York',
        basePrice: basePrice ?? 0,
        pricingRules: pricingRules ?? null,
      },
    });

    void reply.code(201);
    return {
      id: target.id,
      buyerId: target.buyerId,
      name: target.name,
      type: target.type,
      destination: target.destination,
      priority: target.priority,
      status: target.status,
      maxCap: target.maxCap,
      capPeriod: target.capPeriod,
      maxConcurrency: target.maxConcurrency,
      weight: target.weight,
      acceptedStates: target.acceptedStates,
      isNational: target.acceptedStates.length === 0,
      hoursOfOperation: target.hoursOfOperation,
      timezone: target.timezone,
      basePrice: Number(target.basePrice),
      pricingRules: target.pricingRules,
      createdAt: target.createdAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
    };
  });

  /**
   * PATCH /api/v1/buyers/:buyerId/targets/:targetId
   * Update a target
   */
  fastify.patch<{
    Params: { buyerId: string; targetId: string };
    Body: {
      name?: string;
      type?: 'SIP' | 'PSTN' | 'WEBRTC';
      destination?: string;
      priority?: number;
      status?: 'ACTIVE' | 'INACTIVE' | 'FAILED';
      maxCap?: number;
      capPeriod?: 'HOUR' | 'DAY' | 'MONTH';
      maxConcurrency?: number;
      weight?: number;
      acceptedStates?: string[]; // Array of 2-letter state codes, empty = National (accepts all)
      hoursOfOperation?: Record<string, Array<{ start: string; end: string }>> | null; // Split-shift schedule
      timezone?: string; // e.g., 'America/New_York'
      basePrice?: number; // Static bid price
      pricingRules?: Array<{ field: string; op: string; val: unknown; adjustment: string }> | null;
    };
  }>('/api/v1/buyers/:buyerId/targets/:targetId', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId, targetId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Access denied to manage this buyer targets' },
      };
    }

    const {
      name,
      type,
      destination,
      priority,
      status,
      maxCap,
      capPeriod,
      maxConcurrency,
      weight,
      acceptedStates,
      hoursOfOperation,
      timezone,
      basePrice,
      pricingRules,
    } = request.body;

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    // Verify target belongs to buyer
    const existing = await prisma.buyerEndpoint.findFirst({
      where: { id: targetId, buyerId },
    });
    if (!existing) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Target not found' } };
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (type !== undefined) updateData.type = type;
    if (destination !== undefined) updateData.destination = destination.trim();
    if (priority !== undefined) updateData.priority = priority;
    if (status !== undefined) updateData.status = status;
    if (maxCap !== undefined) updateData.maxCap = maxCap;
    if (capPeriod !== undefined) updateData.capPeriod = capPeriod;
    if (maxConcurrency !== undefined) updateData.maxConcurrency = maxConcurrency;
    if (weight !== undefined) updateData.weight = weight;
    if (acceptedStates !== undefined) updateData.acceptedStates = acceptedStates;
    if (hoursOfOperation !== undefined) updateData.hoursOfOperation = hoursOfOperation;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (basePrice !== undefined) updateData.basePrice = basePrice;
    if (pricingRules !== undefined) updateData.pricingRules = pricingRules;

    const target = await prisma.buyerEndpoint.update({
      where: { id: targetId },
      data: updateData,
    });

    return {
      id: target.id,
      buyerId: target.buyerId,
      name: target.name,
      type: target.type,
      destination: target.destination,
      priority: target.priority,
      status: target.status,
      maxCap: target.maxCap,
      capPeriod: target.capPeriod,
      maxConcurrency: target.maxConcurrency,
      weight: target.weight,
      acceptedStates: target.acceptedStates,
      isNational: target.acceptedStates.length === 0,
      hoursOfOperation: target.hoursOfOperation,
      timezone: target.timezone,
      basePrice: Number(target.basePrice),
      pricingRules: target.pricingRules,
      createdAt: target.createdAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
    };
  });

  /**
   * DELETE /api/v1/buyers/:buyerId/targets/:targetId
   * Delete a target
   */
  fastify.delete<{
    Params: { buyerId: string; targetId: string };
  }>('/api/v1/buyers/:buyerId/targets/:targetId', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId, targetId } = request.params;
    const profile = await getUserProfile(request);
    const isAllowed = await checkBuyerAccess(buyerId, profile, tenantId);

    if (!isAllowed) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Access denied to manage this buyer targets' },
      };
    }

    // Verify buyer belongs to tenant
    const buyer = await prisma.buyer.findFirst({
      where: { id: buyerId, tenantId },
    });
    if (!buyer) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Buyer not found' } };
    }

    // Verify target belongs to buyer
    const existing = await prisma.buyerEndpoint.findFirst({
      where: { id: targetId, buyerId },
    });
    if (!existing) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Target not found' } };
    }

    await prisma.buyerEndpoint.delete({
      where: { id: targetId },
    });

    void reply.code(204);
    return null;
  });
}
