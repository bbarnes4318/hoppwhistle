import { createHash } from 'crypto';

import { FastifyRequest, FastifyReply , FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { auditLog } from '../services/audit.js';

export interface AuthenticatedUser {
  tenantId: string;
  userId?: string;
  apiKeyId?: string;
  roles?: string[];
  scopes?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * JWT authentication middleware with user validation
 */
export async function authenticateJWT(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

  const token = authHeader.substring(7);
  
  try {
    const decoded = await request.jwtVerify<AuthenticatedUser>(token);
    
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

      if (!user || user.tenantId !== decoded.tenantId) {
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
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }).catch(() => {
        // Don't fail if update fails
      });

      // Extract roles
      const roles = user.roles.map(ur => ur.role.name);

      request.user = {
        ...decoded,
        roles,
      };
    } else {
      request.user = decoded;
    }
  } catch (err) {
    await auditLog({
      tenantId: 'unknown',
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
    },
  });

  // Validate API key
  if (!dbApiKey) {
    await auditLog({
      tenantId: 'unknown',
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
  await prisma.apiKey.update({
    where: { id: dbApiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {
    // Don't fail if update fails
  });

  // Extract scopes
  const scopes = (dbApiKey.scopes && Array.isArray(dbApiKey.scopes))
    ? dbApiKey.scopes as string[]
    : [];

  request.user = {
    tenantId: dbApiKey.tenantId,
    apiKeyId: dbApiKey.id,
    scopes,
  };
}

/**
 * Combined authentication: try JWT first, then API key
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

