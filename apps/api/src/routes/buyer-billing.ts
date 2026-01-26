/**
 * Buyer Billing Routes
 *
 * API endpoints for managing buyer credits, transactions, and balances.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { AuthenticatedUser } from '../middleware/auth.js';
import { buyerBillingService } from '../services/buyer-billing-service.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

export async function registerBuyerBillingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/buyers/upfront-balances
   * Get all Upfront buyers with their balances for dashboard widget
   */
  fastify.get('/api/v1/buyers/upfront-balances', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const balances = await buyerBillingService.getUpfrontBuyerBalances(tenantId);

    return {
      data: balances,
      meta: {
        total: balances.length,
        lowBalanceCount: balances.filter(b => b.isLowBalance).length,
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
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    // Verify buyer belongs to tenant
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
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
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    // Require admin role for adding credits
    const isAdmin = user?.roles?.some(r => r === 'ADMIN' || r === 'OWNER') ?? false;
    if (!demoTenantId && !isAdmin) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };
    }

    const { buyerId } = request.params;
    const { amount, description } = request.body;

    if (!amount || amount < 1) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Amount must be at least 1' } };
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
      message: `Added ${amount} leads to buyer wallet`,
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
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const skip = (page - 1) * limit;

    const where: { tenantId: string; billingType?: 'TERMS' | 'UPFRONT' } = { tenantId };
    if (request.query.billingType) {
      where.billingType = request.query.billingType;
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
        status: b.status,
        billingType: b.billingType,
        leadsRemaining: b.leadsRemaining,
        billableDuration: b.billableDuration,
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
      billingType?: 'TERMS' | 'UPFRONT';
      billableDuration?: number;
      leadsRemaining?: number;
    };
  }>('/api/v1/buyers', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { name, code, publisherId, billingType, billableDuration, leadsRemaining } = request.body;

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
        billingType: billingType || 'TERMS',
        billableDuration: billableDuration || 60,
        leadsRemaining: leadsRemaining || 0,
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
      billableDuration: buyer.billableDuration,
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
      status?: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
      billingType?: 'TERMS' | 'UPFRONT';
      billableDuration?: number;
    };
  }>('/api/v1/buyers/:buyerId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { buyerId } = request.params;
    const { name, code, status, billingType, billableDuration } = request.body;

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
    if (status !== undefined) updateData.status = status;
    if (billingType !== undefined) updateData.billingType = billingType;
    if (billableDuration !== undefined) updateData.billableDuration = billableDuration;

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
      status: buyer.status,
      billingType: buyer.billingType,
      leadsRemaining: buyer.leadsRemaining,
      billableDuration: buyer.billableDuration,
      publisher: buyer.publisher,
      createdAt: buyer.createdAt.toISOString(),
      updatedAt: buyer.updatedAt.toISOString(),
    };
  });
}
