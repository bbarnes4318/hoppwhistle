// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-named-as-default-member
const { compare, hash } = bcrypt;
import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { createSession, generateCsrfToken } from '../middleware/session.js';
import { auditLog } from '../services/audit.js';
import { verifyGoogleToken } from '../services/google-auth.js';

// Password validation: min 8 chars, 1 uppercase, 1 number
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

// Default tenant ID for new users (must exist in database)
const DEFAULT_TENANT_ID = 'default-tenant-id';

interface UserRole {
  role: { name: string };
}

/**
 * Auth routes: Login, Register, Google OAuth, CSRF, Logout
 * All routes prefixed with /api for nginx routing
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  // ============================================================================
  // Email/Password Login
  // ============================================================================
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and password are required',
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        tenant: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    // Check if user exists and has a password (not Google-only)
    if (!user || !user.passwordHash) {
      await auditLog({
        tenantId: 'unknown',
        action: 'auth.login.failed',
        entityType: 'User',
        resource: '/api/auth/login',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Invalid credentials',
      });

      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    // Verify password
    if (!(await compare(password, user.passwordHash))) {
      await auditLog({
        tenantId: user.tenantId || 'unknown',
        action: 'auth.login.failed',
        entityType: 'User',
        resource: '/api/auth/login',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Invalid password',
      });

      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    if (user.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'User account is not active',
        },
      });
    }

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant is not active',
        },
      });
    }

    // Update last login
    await prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {});

    // Create JWT token
    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    // Create session
    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    // Audit successful login
    await auditLog({
      tenantId: user.tenantId || 'default',
      userId: user.id,
      action: 'auth.login.success',
      entityType: 'User',
      resource: '/api/auth/login',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    return reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map((ur: UserRole) => ur.role.name),
      },
    });
  });

  // ============================================================================
  // Email Registration
  // ============================================================================
  fastify.post('/api/auth/register', async (request, reply) => {
    const { email, password, firstName, lastName } = request.body as {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
    };

    if (!email || !password) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and password are required',
        },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
        },
      });
    }

    // Validate password strength
    if (!PASSWORD_REGEX.test(password)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
        },
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      if (existingUser.authMethod === 'GOOGLE' && !existingUser.passwordHash) {
        return reply.code(409).send({
          error: {
            code: 'EMAIL_EXISTS_GOOGLE',
            message: 'This email is registered with Google. Please sign in with Google.',
          },
        });
      }
      return reply.code(409).send({
        error: {
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        },
      });
    }

    // Hash password (12 salt rounds for security)
    const passwordHash = await hash(password, 12);

    // Create user with default tenant
    const user = await prisma.user.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        email: normalizedEmail,
        passwordHash,
        authMethod: 'EMAIL',
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        status: 'ACTIVE',
      },
    });

    // Audit registration
    await auditLog({
      tenantId: 'default',
      userId: user.id,
      action: 'auth.register.success',
      entityType: 'User',
      resource: '/api/auth/register',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    // Create JWT token
    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    // Create session
    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    void reply.code(201);
    return reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: [],
      },
    });
  });

  // ============================================================================
  // Google OAuth Login
  // ============================================================================
  fastify.post('/api/auth/google', async (request, reply) => {
    const { credential } = request.body as { credential: string };

    if (!credential) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Google credential token is required',
        },
      });
    }

    // Verify Google token
    const result = await verifyGoogleToken(credential);

    if (!result.success) {
      await auditLog({
        tenantId: 'unknown',
        action: 'auth.google.failed',
        entityType: 'User',
        resource: '/api/auth/google',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: result.error,
      });

      return reply.code(401).send({
        error: {
          code: result.code,
          message: result.error,
        },
      });
    }

    const googleUser = result.user;
    const normalizedEmail = googleUser.email.toLowerCase();

    // Check if user exists by googleId first
    let user = await prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
      include: {
        tenant: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      // Check if user exists by email (Safe Account Linking)
      const existingEmailUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          tenant: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (existingEmailUser) {
        // Safe Account Linking: Link Google to existing email account
        user = await prisma.user.update({
          where: { id: existingEmailUser.id },
          data: {
            googleId: googleUser.googleId,
            firstName: existingEmailUser.firstName || googleUser.firstName,
            lastName: existingEmailUser.lastName || googleUser.lastName,
            lastLoginAt: new Date(),
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

        await auditLog({
          tenantId: user.tenantId || 'default',
          userId: user.id,
          action: 'auth.google.linked',
          entityType: 'User',
          resource: '/api/auth/google',
          method: 'POST',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: true,
        });
      } else {
        // Create new user with Google and default tenant
        user = await prisma.user.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            email: normalizedEmail,
            googleId: googleUser.googleId,
            authMethod: 'GOOGLE',
            firstName: googleUser.firstName,
            lastName: googleUser.lastName,
            status: 'ACTIVE',
            lastLoginAt: new Date(),
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

        await auditLog({
          tenantId: 'default',
          userId: user.id,
          action: 'auth.google.register',
          entityType: 'User',
          resource: '/api/auth/google',
          method: 'POST',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: true,
        });
      }
    } else {
      // Update last login for existing Google user
      await prisma.user
        .update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })
        .catch(() => {});
    }

    if (user.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'User account is not active',
        },
      });
    }

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant is not active',
        },
      });
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
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    // Audit successful Google login
    await auditLog({
      tenantId: user.tenantId || 'default',
      userId: user.id,
      action: 'auth.google.success',
      entityType: 'User',
      resource: '/api/auth/google',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    return reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map((ur: UserRole) => ur.role.name),
      },
    });
  });

  // ============================================================================
  // CSRF Token
  // ============================================================================
  fastify.get(
    '/api/auth/csrf',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const sessionId = request.cookies.sessionId || (request.headers['x-session-id'] as string);
      if (!sessionId) {
        return reply.code(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Session required',
          },
        });
      }

      const csrfToken = generateCsrfToken(sessionId);
      return reply.send({ csrfToken });
    }
  );

  // ============================================================================
  // Logout
  // ============================================================================
  fastify.post(
    '/api/auth/logout',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const sessionId = request.cookies.sessionId;
      if (sessionId) {
        const { deleteSession } = await import('../middleware/session.js');
        await deleteSession(sessionId);
        void reply.clearCookie('sessionId');
      }

      await auditLog({
        tenantId: (request.user as { tenantId?: string })?.tenantId || 'default',
        userId: (request.user as { userId: string }).userId,
        action: 'auth.logout',
        entityType: 'User',
        resource: '/api/auth/logout',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({ success: true });
    }
  );
}
