import { createHash } from 'crypto';

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

import { loadPlatformContext } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { auditLog } from '../services/audit.js';

export interface AuthenticatedUser {
  /**
   * The agency this request acts as.
   *
   * For an agency user this is their own tenant. For NetEnroll staff it is the
   * agency they have explicitly entered, or undefined for the cross-agency
   * view -- which is not a wildcard: an agency-scoped route refuses it, because
   * a query with no tenant is a query we cannot safely answer.
   */
  tenantId?: string;
  userId?: string;
  email?: string;
  apiKeyId?: string;
  roles?: string[];
  scopes?: string[];
  buyerId?: string | null;
  publisherId?: string | null;

  /** Holds a `PlatformAdmin` row. Never true for an API-key principal. */
  isPlatformAdmin?: boolean;
  /**
   * The agency a platform operator has entered, mirrored from `tenantId` for
   * the UI banner and for audit rows. Null means the cross-agency view.
   */
  actingTenantId?: string | null;
  actingTenantName?: string | null;
}

/**
 * JWT authentication middleware with user validation
 */
export async function authenticateJWT(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      },
    });
    return;
  }

  try {
    // Verify JWT - jwtVerify reads from Authorization header automatically
    // We use type assertion because the module augmentation for @fastify/jwt
    // is not reliably picked up by TypeScript
    const jwtPayload = await request.jwtVerify();
    // Extract payload fields explicitly to satisfy TypeScript
    const decoded = jwtPayload as unknown as {
      tenantId: string;
      userId?: string;
      email?: string;
    };

    // Validate user exists and is active
    if (decoded.userId) {
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      // A platform admin may have no home tenant at all (`User.tenantId` is
      // nullable), and their token therefore carries none. Compare only when
      // the token actually claims one, so the check still catches a token whose
      // tenant has drifted from the user row for an ordinary agency user.
      if (!user || (decoded.tenantId != null && user.tenantId !== decoded.tenantId)) {
        reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not found',
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

      // Update last login
      await prisma.user
        .update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })
        .catch(() => {
          // Don't fail if update fails
        });

      // Extract roles
      const roles = user.roles.map(ur => ur.role.name);
      const publisherId = user.publisherId || (user.metadata as any)?.publisherId || null;

      // NetEnroll staff, and the agency they have explicitly entered.
      //
      // For staff the selection REPLACES the token's tenant rather than
      // supplementing it. The token is issued at login and cannot know which
      // agency the operator entered afterwards, and a stale tenant in a
      // long-lived token must never decide whose data is served. The row is the
      // authority; the token only says who is asking.
      const platform = await loadPlatformContext(decoded.userId);

      // Construct authenticated user object explicitly
      request.user = {
        tenantId: platform.isPlatformAdmin
          ? (platform.actingTenantId ?? undefined)
          : decoded.tenantId,
        userId: decoded.userId,
        email: decoded.email,
        // Inside an agency, a platform operator carries that agency's
        // administrator roles; in the cross-agency view they carry none. See
        // ACTING_TENANT_ROLES for why.
        roles: [
          ...roles,
          ...platform.actingRoles.filter(r => !(roles as string[]).includes(r)),
        ],
        buyerId: user.buyerId || null,
        publisherId,
        isPlatformAdmin: platform.isPlatformAdmin,
        actingTenantId: platform.actingTenantId,
        actingTenantName: platform.actingTenantName,
      };
    } else {
      // API-only token without userId
      request.user = {
        tenantId: decoded.tenantId,
        email: decoded.email,
      };
    }
  } catch (err) {
    await auditLog({
      tenantId: null,
      action: 'auth.jwt.invalid',
      entityType: 'JWT',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: err instanceof Error ? err.message : 'Invalid token',
    });

    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      },
    });
    return;
  }
}

/**
 * Hash API key for storage/comparison
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * API Key authentication middleware with database validation and scopes
 */
export async function authenticateAPIKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey) {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing API key',
      },
    });
    return;
  }

  const prisma = getPrismaClient();
  const keyHash = hashApiKey(apiKey);

  // Look up API key in database
  const dbApiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      tenant: true,
      publisher: true,
    },
  });

  // Validate API key
  if (!dbApiKey) {
    await auditLog({
      tenantId: null,
      action: 'auth.api_key.invalid',
      entityType: 'ApiKey',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: 'API key not found',
    });

    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
    });
    return;
  }

  // Check status
  if (dbApiKey.status !== 'ACTIVE') {
    await auditLog({
      tenantId: dbApiKey.tenantId,
      apiKeyId: dbApiKey.id,
      action: 'auth.api_key.inactive',
      entityType: 'ApiKey',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: `API key status: ${dbApiKey.status}`,
    });

    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key is not active',
      },
    });
    return;
  }

  // Check expiration
  if (dbApiKey.expiresAt && dbApiKey.expiresAt < new Date()) {
    await auditLog({
      tenantId: dbApiKey.tenantId,
      apiKeyId: dbApiKey.id,
      action: 'auth.api_key.expired',
      entityType: 'ApiKey',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: 'API key expired',
    });

    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key has expired',
      },
    });
    return;
  }

  // Check tenant status
  if (dbApiKey.tenant.status !== 'ACTIVE') {
    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'Tenant is not active',
      },
    });
    return;
  }

  // Update last used timestamp
  await prisma.apiKey
    .update({
      where: { id: dbApiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      // Don't fail if update fails
    });

  // Extract scopes
  const scopes =
    dbApiKey.scopes && Array.isArray(dbApiKey.scopes) ? (dbApiKey.scopes as string[]) : [];

  // Set authenticated user for API key auth
  request.user = {
    tenantId: dbApiKey.tenantId,
    apiKeyId: dbApiKey.id,
    scopes,
    publisherId: dbApiKey.publisherId || (dbApiKey.metadata as any)?.publisherId || null,
    buyerId: (dbApiKey.metadata as any)?.buyerId || null,
  };
}

/**
 * Combined authentication: try JWT first, then API key
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const apiKey = request.headers['x-api-key'] as string;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    await authenticateJWT(request, reply);
  } else if (apiKey) {
    await authenticateAPIKey(request, reply);
  } else {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing authentication (JWT token or API key)',
      },
    });
    return;
  }
}

/**
 * Register JWT plugin
 */
export async function registerAuth(fastify: FastifyInstance): Promise<void> {
  const { secrets } = await import('../services/secrets.js');

  await fastify.register(import('@fastify/jwt'), {
    secret: secrets.getRequired('JWT_SECRET'),
  });
}
