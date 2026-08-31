// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-named-as-default-member
const { compare, hash } = bcrypt;
import { FastifyInstance, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { createSession, generateCsrfToken } from '../middleware/session.js';
import { auditLog } from '../services/audit.js';
import { verifyGoogleToken } from '../services/google-auth.js';

// Password validation: min 8 chars, 1 uppercase, 1 number
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

interface UserRole {
  role: { name: string };
}

/**
 * Auth routes: Login, Register, Google OAuth, CSRF, Logout
 * All routes prefixed with /api for nginx routing
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();
  await Promise.resolve(); // satisfy eslint require-await

  // Helper to get or create a default tenant ID dynamically, optionally resolving from request host/domain/slug
  async function getDefaultTenantId(request?: FastifyRequest): Promise<string> {
    if (request) {
      let host = request.hostname || '';
      if (!host && request.headers.host) {
        host = request.headers.host.split(':')[0];
      }

      const referer = request.headers.referer;
      if (referer) {
        try {
          const refUrl = new URL(referer);
          if (refUrl.hostname) {
            host = refUrl.hostname;
          }
        } catch {}
      }

      const origin = request.headers.origin;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          if (originUrl.hostname) {
            host = originUrl.hostname;
          }
        } catch {}
      }

      if (host) {
        // Normalize host (lowercase and strip port if present)
        host = host.split(':')[0].toLowerCase();

        // 1. Try matching the exact domain
        let tenant = await prisma.tenant.findFirst({
          where: { domain: host },
        });
        if (tenant) {
          return tenant.id;
        }

        // 2. Try matching the first subdomain to the tenant slug
        const parts = host.split('.');
        if (parts.length > 1) {
          const subdomain = parts[0];
          tenant = await prisma.tenant.findUnique({
            where: { slug: subdomain },
          });
          if (tenant) {
            return tenant.id;
          }
        }
      }
    }

    // 3. Try to find the primary seeded tenant ('test-org')
    let defaultTenant = await prisma.tenant.findUnique({
      where: { slug: 'test-org' },
    });

    // 4. Try to find 'default' slug
    if (!defaultTenant) {
      defaultTenant = await prisma.tenant.findUnique({
        where: { slug: 'default' },
      });
    }

    // 5. Fallback to any active tenant that is not a test-generated one
    if (!defaultTenant) {
      const activeTenants = await prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
      });
      // Filter out test tenants like test-123456789
      defaultTenant = activeTenants.find(t => !/^test-\d+$/.test(t.slug)) || activeTenants[0];
    }

    // 6. Fallback to the absolute first tenant
    if (!defaultTenant) {
      defaultTenant = await prisma.tenant.findFirst({
        orderBy: { createdAt: 'asc' },
      });
    }

    // 7. Create default organization if none exists
    if (!defaultTenant) {
      defaultTenant = await prisma.tenant.create({
        data: {
          name: 'Default Organization',
          slug: 'default',
          status: 'ACTIVE',
          metadata: {
            plan: 'enterprise',
          },
        },
      });
    }
    return defaultTenant.id;
  }

  /**
   * The role a self-serve signup gets: the least privileged one there is.
   *
   * This used to ask for ADMIN, fall back to OWNER, and fall back again to
   * `findFirst()` -- whatever role row the database happened to return. Every
   * account created through the public signup page, by email or through Google,
   * came out a platform administrator, active immediately, with nobody asked.
   *
   * READONLY is now the only role this function will ever grant, and it grants
   * nothing at all if READONLY is missing: a signup with no role can be given
   * one deliberately, whereas a signup with a guessed role is exactly what went
   * wrong here. Privilege is granted by an existing admin through
   * /api/v1/users/invite or PATCH /api/v1/users/:userId, never by signing up.
   */
  async function assignDefaultRole(userId: string): Promise<void> {
    const role = await prisma.role.findFirst({
      where: { name: 'READONLY' },
    });

    if (!role) {
      fastify.log.error(
        { userId },
        'READONLY role missing; self-serve signup left with no role rather than a guessed one'
      );
      return;
    }

    await prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
      },
    });
  }

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
          code: user.status === 'PENDING' ? 'ACCOUNT_PENDING_APPROVAL' : 'FORBIDDEN',
          message:
            user.status === 'PENDING'
              ? 'Your account is awaiting approval by an administrator.'
              : 'User account is not active',
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
    const { email, password, firstName, lastName, position } = request.body as {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      position?: string;
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

    const userPosition = position || 'Licensed Agent';
    const defaultScript = userPosition === 'Retention' ? 'retention' : 'sales';

    // Create user with default tenant
    const user = await prisma.user.create({
      data: {
        tenantId: await getDefaultTenantId(request),
        email: normalizedEmail,
        passwordHash,
        authMethod: 'EMAIL',
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        // Awaiting approval, not live. Login, the Google path and the auth
        // middleware all refuse a user who is not ACTIVE, so this account can
        // obtain no session until an admin approves it.
        status: 'PENDING',
        metadata: {
          position: userPosition,
          defaultScript: defaultScript,
        },
      },
    });

    await assignDefaultRole(user.id);

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

    // Deliberately no token and no session: registering must not sign you in
    // while the account is still waiting on approval. Handing back a JWT here
    // is what made the public signup page a way onto the platform.
    void reply.code(202);
    return reply.send({
      status: 'PENDING_APPROVAL',
      message:
        'Your account has been created and is awaiting approval. ' +
        'You will be able to sign in once an administrator approves it.',
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
            tenantId: await getDefaultTenantId(request),
            email: normalizedEmail,
            googleId: googleUser.googleId,
            authMethod: 'GOOGLE',
            firstName: googleUser.firstName,
            lastName: googleUser.lastName,
            // Same rule as email signup: a brand new Google account is a
            // self-serve signup and waits for approval. The status check below
            // turns this into a 403 before any token is issued.
            status: 'PENDING',
            lastLoginAt: new Date(),
          },
        });

        await assignDefaultRole(user.id);

        // Fetch user again with relation to return correctly
        const userWithRoles = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            tenant: true,
            roles: {
              include: {
                role: true,
              },
            },
          },
        });
        if (userWithRoles) {
          user = userWithRoles;
        }

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
          code: user.status === 'PENDING' ? 'ACCOUNT_PENDING_APPROVAL' : 'FORBIDDEN',
          message:
            user.status === 'PENDING'
              ? 'Your account is awaiting approval by an administrator.'
              : 'User account is not active',
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
  // Get Current User (Me)
  // ============================================================================
  fastify.get(
    '/api/auth/me',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { userId } = request.user as { userId: string; tenantId?: string };

      if (!userId) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Not authenticated',
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      let publisherAccessToRecordings = false;
      let buyerAccessToRecordings = false;

      if (user.publisherId) {
        const pub = await prisma.publisher.findUnique({
          where: { id: user.publisherId },
          select: { accessToRecordings: true },
        });
        publisherAccessToRecordings = pub?.accessToRecordings ?? false;
      }

      if (user.buyerId) {
        const buyer = await prisma.buyer.findUnique({
          where: { id: user.buyerId },
          select: { metadata: true },
        });
        const buyerMetadata = buyer?.metadata as Record<string, unknown> | null;
        buyerAccessToRecordings = !!buyerMetadata?.accessToRecordings;
      }

      const userMetadata = user.metadata as Record<string, unknown> | null;

      return reply.send({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map((ur: UserRole) => ur.role.name),
        tenantId: user.tenantId,
        buyerId: user.buyerId,
        publisherId: user.publisherId || (userMetadata?.publisherId as string | null) || null,
        publisherAccessToRecordings,
        buyerAccessToRecordings,
        position: userMetadata?.position || null,
        defaultScript: userMetadata?.defaultScript || null,
        customScripts: userMetadata?.customScripts || null,
      });
    }
  );

  // ============================================================================
  // Update User Settings (me)
  // ============================================================================
  fastify.patch(
    '/api/auth/me/settings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { userId } = request.user as { userId: string };
      const { position, defaultScript, customScripts } = request.body as {
        position?: string;
        defaultScript?: string;
        customScripts?: Record<string, string>;
      };

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      const currentMetadata = (user.metadata as Record<string, any>) || {};
      const newMetadata = {
        ...currentMetadata,
      };

      if (position !== undefined) newMetadata.position = position;
      if (defaultScript !== undefined) newMetadata.defaultScript = defaultScript;
      if (customScripts !== undefined) {
        newMetadata.customScripts = {
          ...((currentMetadata.customScripts as Record<string, string>) || {}),
          ...customScripts,
        };
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { metadata: newMetadata },
      });

      return reply.send({
        success: true,
        metadata: updated.metadata,
      });
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
