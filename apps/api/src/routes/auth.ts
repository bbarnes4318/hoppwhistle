import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { createSession, setSessionCookie, generateCsrfToken } from '../middleware/session.js';
import { getPrismaClient } from '../lib/prisma.js';
import { auditLog, auditRead } from '../services/audit.js';
import { compare, hash } from 'bcryptjs';
import { secrets } from '../services/secrets.js';

/**
 * Login endpoint
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  // Login
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and password are required',
        },
      });
      return;
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: request.user?.tenantId || 'default', // In real app, get from request
          email,
        },
      },
      include: {
        tenant: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || !(await compare(password, user.passwordHash))) {
      await auditLog({
        tenantId: 'unknown',
        action: 'auth.login.failed',
        entityType: 'User',
        resource: '/auth/login',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Invalid credentials',
      });

      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
      return;
    }

    if (user.status !== 'ACTIVE') {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'User account is not active',
        },
      });
      return;
    }

    if (user.tenant.status !== 'ACTIVE') {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant is not active',
        },
      });
      return;
    }

    // Create JWT token
    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    // Create session
    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    // Audit successful login
    await auditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.login.success',
      entityType: 'User',
      resource: '/auth/login',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map(ur => ur.role.name),
      },
    });
  });

  // Get CSRF token (for web app)
  fastify.get('/auth/csrf', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const sessionId = request.cookies.sessionId || request.headers['x-session-id'] as string;
    if (!sessionId) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Session required',
        },
      });
      return;
    }

    const csrfToken = generateCsrfToken(sessionId);
    reply.send({ csrfToken });
  });

  // Logout
  fastify.post('/auth/logout', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const sessionId = request.cookies.sessionId;
    if (sessionId) {
      const { deleteSession } = await import('../middleware/session.js');
      await deleteSession(sessionId);
      reply.clearCookie('sessionId');
    }

    await auditLog({
      tenantId: request.user!.tenantId,
      userId: request.user!.userId,
      action: 'auth.logout',
      entityType: 'User',
      resource: '/auth/logout',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    reply.send({ success: true });
  });
}

