/**
 * Payroll Routes
 * Time tracking and payroll management endpoints
 */
import { FastifyInstance, FastifyRequest } from 'fastify';

import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as timeTrackingService from '../services/time-tracking-service.js';

interface AuthRequest extends FastifyRequest {
  user?: {
    tenantId: string;
    userId?: string;
    roles?: string[];
  };
}

export async function registerPayrollRoutes(fastify: FastifyInstance) {
  // ============================================================================
  // User Endpoints - Time Entries
  // ============================================================================

  /**
   * POST /api/v1/time-entries - Log hours for a date
   */
  fastify.post<{
    Body: {
      date: string;
      hoursWorked: number;
      notes?: string;
    };
  }>(
    '/api/v1/time-entries',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      try {
        const { date, hoursWorked, notes } = request.body;

        // Validate hours
        if (typeof hoursWorked !== 'number' || hoursWorked <= 0 || hoursWorked > 24) {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Hours worked must be a positive number less than 24',
            },
          });
        }

        const entry = await timeTrackingService.logHours({
          userId: user.userId,
          date: new Date(date),
          hoursWorked,
          notes,
        });

        return reply.code(201).send({
          id: entry.id,
          userId: entry.userId,
          date: entry.date.toISOString().split('T')[0],
          hoursWorked: Number(entry.hoursWorked),
          notes: entry.notes,
          payrollPayoutId: entry.payrollPayoutId,
          createdAt: entry.createdAt.toISOString(),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'CREATE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * PATCH /api/v1/time-entries/:entryId - Update a time entry
   */
  fastify.patch<{
    Params: { entryId: string };
    Body: {
      hoursWorked: number;
      notes?: string;
    };
  }>(
    '/api/v1/time-entries/:entryId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      try {
        const { entryId } = request.params;
        const { hoursWorked, notes } = request.body;

        const entry = await timeTrackingService.updateTimeEntry(
          entryId,
          user.userId,
          hoursWorked,
          notes
        );

        return reply.send({
          id: entry.id,
          userId: entry.userId,
          date: entry.date.toISOString().split('T')[0],
          hoursWorked: Number(entry.hoursWorked),
          notes: entry.notes,
          payrollPayoutId: entry.payrollPayoutId,
          updatedAt: entry.updatedAt.toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.code(statusCode).send({
          error: { code: statusCode === 403 ? 'LOCKED' : 'UPDATE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * DELETE /api/v1/time-entries/:entryId - Delete a time entry
   */
  fastify.delete<{
    Params: { entryId: string };
  }>(
    '/api/v1/time-entries/:entryId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      try {
        await timeTrackingService.deleteTimeEntry(request.params.entryId, user.userId);
        return reply.code(204).send();
      } catch (err: any) {
        const statusCode = err.statusCode || 400;
        return reply.code(statusCode).send({
          error: { code: statusCode === 403 ? 'LOCKED' : 'DELETE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * GET /api/v1/time-entries/me - Get current user's time entries
   */
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/api/v1/time-entries/me',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      const { startDate, endDate } = request.query;

      const entries = await timeTrackingService.getUserTimeEntries(
        user.userId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );

      return {
        data: entries.map(e => ({
          id: e.id,
          date: e.date.toISOString().split('T')[0],
          hoursWorked: Number(e.hoursWorked),
          notes: e.notes,
          payrollPayoutId: e.payrollPayoutId,
          isLocked: !!e.payrollPayoutId,
          payrollPayout: e.payrollPayout
            ? {
                id: e.payrollPayout.id,
                status: e.payrollPayout.status,
              }
            : null,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    }
  );

  /**
   * GET /api/v1/time-entries/me/summary - Get earnings summary
   */
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/api/v1/time-entries/me/summary',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      // Default to current month
      const now = new Date();
      const startDate = request.query.startDate
        ? new Date(request.query.startDate)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = request.query.endDate
        ? new Date(request.query.endDate)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const summary = await timeTrackingService.getEarningsSummary(user.userId, startDate, endDate);

      return summary;
    }
  );

  // ============================================================================
  // User Endpoints - Banking
  // ============================================================================

  /**
   * PUT /api/v1/user/banking - Update own banking info
   */
  fastify.put<{
    Body: {
      bankName: string;
      accountNumber: string;
      routingNumber: string;
    };
  }>(
    '/api/v1/user/banking',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      try {
        const result = await timeTrackingService.updateBankingInfo({
          userId: user.userId,
          bankName: request.body.bankName,
          accountNumber: request.body.accountNumber,
          routingNumber: request.body.routingNumber,
        });

        return result;
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'UPDATE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * GET /api/v1/user/banking - Get own banking info (decrypted)
   */
  fastify.get(
    '/api/v1/user/banking',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      try {
        const bankingInfo = await timeTrackingService.getBankingInfo(user.userId, user.userId);
        return bankingInfo;
      } catch (err: any) {
        return reply.code(500).send({
          error: { code: 'FETCH_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * GET /api/v1/user/payouts - Get own payout history
   */
  fastify.get(
    '/api/v1/user/payouts',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'User authentication required' },
        });
      }

      const payouts = await timeTrackingService.getUserPayouts(user.userId);

      return {
        data: payouts.map(p => ({
          id: p.id,
          startDate: p.startDate.toISOString().split('T')[0],
          endDate: p.endDate.toISOString().split('T')[0],
          totalHours: Number(p.totalHours),
          totalAmount: Number(p.totalAmount),
          status: p.status,
          paidAt: p.paidAt?.toISOString() || null,
          entriesCount: p._count.timeEntries,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    }
  );

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * GET /api/v1/admin/time-entries - Get all time entries (admin)
   */
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      userId?: string;
    };
  }>(
    '/api/v1/admin/time-entries',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const { startDate, endDate, userId } = request.query;

      const entries = await timeTrackingService.getAllTimeEntries(user.tenantId, {
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        userId,
      });

      return {
        data: entries.map(e => ({
          id: e.id,
          userId: e.userId,
          userName: e.user
            ? `${e.user.firstName || ''} ${e.user.lastName || ''}`.trim() || e.user.email
            : 'Unknown',
          userEmail: e.user?.email,
          date: e.date.toISOString().split('T')[0],
          hoursWorked: Number(e.hoursWorked),
          notes: e.notes,
          isLocked: !!e.payrollPayoutId,
          payrollPayoutId: e.payrollPayoutId,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    }
  );

  /**
   * POST /api/v1/admin/set-pay-rate - Set pay rate for a user
   */
  fastify.post<{
    Body: {
      userId: string;
      payRate: number;
    };
  }>(
    '/api/v1/admin/set-pay-rate',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      try {
        const { userId, payRate } = request.body;

        if (typeof payRate !== 'number' || payRate < 0) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'Pay rate must be a non-negative number' },
          });
        }

        const result = await timeTrackingService.setPayRate(userId, payRate);

        return {
          userId: result.userId,
          payRate: Number(result.payRate),
          updatedAt: result.updatedAt.toISOString(),
        };
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'UPDATE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * GET /api/v1/admin/payroll-report - Get payroll liability report
   */
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/api/v1/admin/payroll-report',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      const user = (request as AuthRequest).user;

      if (!user?.tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      // Default to current month
      const now = new Date();
      const startDate = request.query.startDate
        ? new Date(request.query.startDate)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = request.query.endDate
        ? new Date(request.query.endDate)
        : new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const report = await timeTrackingService.getPayrollReport(user.tenantId, startDate, endDate);

      const totalLiability = report.reduce((sum, r) => sum + r.totalDue, 0);
      const totalHours = report.reduce((sum, r) => sum + r.totalHours, 0);

      return {
        period: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        },
        summary: {
          totalEmployees: report.length,
          totalHours,
          totalLiability,
        },
        data: report,
      };
    }
  );

  /**
   * POST /api/v1/admin/validate-payroll - Validate users before payout
   */
  fastify.post<{
    Body: {
      userIds: string[];
    };
  }>(
    '/api/v1/admin/validate-payroll',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      try {
        const result = await timeTrackingService.validatePayrollBatch(request.body.userIds);
        return result;
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/payouts - Create a payout for a user
   */
  fastify.post<{
    Body: {
      userId: string;
      startDate: string;
      endDate: string;
    };
  }>(
    '/api/v1/admin/payouts',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      try {
        const { userId, startDate, endDate } = request.body;

        const payout = await timeTrackingService.createPayout({
          userId,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
        });

        return reply.code(201).send({
          id: payout.id,
          userId: payout.userId,
          startDate: payout.startDate.toISOString().split('T')[0],
          endDate: payout.endDate.toISOString().split('T')[0],
          totalHours: Number(payout.totalHours),
          totalAmount: Number(payout.totalAmount),
          status: payout.status,
          entriesLocked: payout.entriesLocked,
          createdAt: payout.createdAt.toISOString(),
        });
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'CREATE_FAILED', message: err.message },
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/payouts/:payoutId/mark-paid - Mark payout as paid
   */
  fastify.post<{
    Params: { payoutId: string };
  }>(
    '/api/v1/admin/payouts/:payoutId/mark-paid',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'OWNER')],
    },
    async (request, reply) => {
      try {
        const payout = await timeTrackingService.markPayoutPaid(request.params.payoutId);

        return {
          id: payout.id,
          status: payout.status,
          paidAt: payout.paidAt?.toISOString(),
        };
      } catch (err: any) {
        return reply.code(400).send({
          error: { code: 'UPDATE_FAILED', message: err.message },
        });
      }
    }
  );
}
