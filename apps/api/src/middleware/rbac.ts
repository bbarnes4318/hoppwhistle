import { FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../lib/prisma.js';
import { auditLog } from '../services/audit.js';
import type { RoleName } from '@prisma/client';

export type Permission = 
  // Users & Roles
  | 'users:read' | 'users:write' | 'users:delete'
  | 'roles:read' | 'roles:write' | 'roles:delete'
  // API Keys
  | 'api_keys:read' | 'api_keys:write' | 'api_keys:delete'
  // Numbers
  | 'numbers:read' | 'numbers:write' | 'numbers:delete'
  // Campaigns
  | 'campaigns:read' | 'campaigns:write' | 'campaigns:delete'
  // Flows
  | 'flows:read' | 'flows:write' | 'flows:delete' | 'flows:publish'
  // Calls
  | 'calls:read' | 'calls:write' | 'calls:delete'
  // Recordings
  | 'recordings:read' | 'recordings:write' | 'recordings:delete'
  // Webhooks
  | 'webhooks:read' | 'webhooks:write' | 'webhooks:delete'
  // Billing
  | 'billing:read' | 'billing:write'
  // Reports
  | 'reports:read'
  // Admin
  | 'admin:*';

// Role-based permission mappings
const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  OWNER: ['admin:*'], // Owner has all permissions
  ADMIN: [
    'users:read', 'users:write', 'users:delete',
    'roles:read', 'roles:write',
    'api_keys:read', 'api_keys:write', 'api_keys:delete',
    'numbers:read', 'numbers:write', 'numbers:delete',
    'campaigns:read', 'campaigns:write', 'campaigns:delete',
    'flows:read', 'flows:write', 'flows:delete', 'flows:publish',
    'calls:read', 'calls:write', 'calls:delete',
    'recordings:read', 'recordings:write', 'recordings:delete',
    'webhooks:read', 'webhooks:write', 'webhooks:delete',
    'billing:read', 'billing:write',
    'reports:read',
  ],
  ANALYST: [
    'calls:read',
    'recordings:read',
    'reports:read',
    'campaigns:read',
    'flows:read',
    'numbers:read',
  ],
  PUBLISHER: [
    'flows:read', 'flows:write', 'flows:publish',
    'campaigns:read', 'campaigns:write',
    'calls:read',
    'recordings:read',
  ],
  BUYER: [
    'calls:read', 'calls:write',
    'recordings:read',
    'campaigns:read',
  ],
  READONLY: [
    'calls:read',
    'recordings:read',
    'campaigns:read',
    'flows:read',
    'numbers:read',
    'reports:read',
  ],
};

/**
 * Check if a permission matches a required permission
 * Supports wildcard matching (e.g., 'admin:*' matches 'admin:users:read')
 */
function permissionMatches(required: Permission, userPermission: Permission): boolean {
  if (userPermission === 'admin:*') {
    return true;
  }
  
  if (userPermission === required) {
    return true;
  }

  // Wildcard matching: 'users:*' matches 'users:read'
  const userParts = userPermission.split(':');
  const requiredParts = required.split(':');
  
  if (userParts.length !== requiredParts.length) {
    return false;
  }

  for (let i = 0; i < userParts.length; i++) {
    if (userParts[i] === '*' || userParts[i] === requiredParts[i]) {
      continue;
    }
    return false;
  }

  return true;
}

/**
 * Get user permissions from roles
 */
async function getUserPermissions(
  tenantId: string,
  userId: string
): Promise<Permission[]> {
  const prisma = getPrismaClient();
  
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

  if (!user || user.tenantId !== tenantId) {
    return [];
  }

  const permissions = new Set<Permission>();
  
  for (const userRole of user.roles) {
    const roleName = userRole.role.name as RoleName;
    const rolePerms = ROLE_PERMISSIONS[roleName] || [];
    rolePerms.forEach(perm => permissions.add(perm));
    
    // Also check custom permissions from role.permissions JSON
    if (userRole.role.permissions && Array.isArray(userRole.role.permissions)) {
      (userRole.role.permissions as Permission[]).forEach(perm => permissions.add(perm));
    }
  }

  return Array.from(permissions);
}

/**
 * Get API key scopes
 */
async function getApiKeyScopes(
  tenantId: string,
  apiKeyId: string
): Promise<Permission[]> {
  const prisma = getPrismaClient();
  
  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
  });

  if (!apiKey || apiKey.tenantId !== tenantId || apiKey.status !== 'ACTIVE') {
    return [];
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return [];
  }

  if (apiKey.scopes && Array.isArray(apiKey.scopes)) {
    return apiKey.scopes as Permission[];
  }

  return [];
}

/**
 * Check if user has required permission
 */
export async function checkPermission(
  request: FastifyRequest,
  requiredPermission: Permission
): Promise<boolean> {
  const user = request.user;
  if (!user) {
    return false;
  }

  // API key authentication
  if (user.apiKeyId) {
    const scopes = await getApiKeyScopes(user.tenantId, user.apiKeyId);
    return scopes.some(scope => permissionMatches(requiredPermission, scope as Permission));
  }

  // JWT/user authentication
  if (user.userId) {
    const permissions = await getUserPermissions(user.tenantId, user.userId);
    return permissions.some(perm => permissionMatches(requiredPermission, perm));
  }

  return false;
}

/**
 * Authorization middleware factory
 */
export function requirePermission(requiredPermission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    
    if (!user) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const hasPermission = await checkPermission(request, requiredPermission);
    
    if (!hasPermission) {
      // Audit failed authorization attempt
      await auditLog({
        tenantId: user.tenantId,
        userId: user.userId,
        apiKeyId: user.apiKeyId,
        action: 'authorization.denied',
        entityType: 'Permission',
        resource: request.url,
        method: request.method,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: `Permission denied: ${requiredPermission}`,
      });

      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: ${requiredPermission}`,
        },
      });
      return;
    }
  };
}

/**
 * Require one of multiple permissions
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    
    if (!user) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    for (const permission of permissions) {
      const hasPermission = await checkPermission(request, permission);
      if (hasPermission) {
        return; // User has at least one required permission
      }
    }

    // Audit failed authorization attempt
    await auditLog({
      tenantId: user.tenantId,
      userId: user.userId,
      apiKeyId: user.apiKeyId,
      action: 'authorization.denied',
      entityType: 'Permission',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: `Permission denied: requires one of [${permissions.join(', ')}]`,
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: `Permission denied: requires one of [${permissions.join(', ')}]`,
      },
    });
  };
}

/**
 * Require specific role
 */
export function requireRole(...roles: RoleName[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    
    if (!user || !user.userId) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
      return;
    }

    const prisma = getPrismaClient();
    const userWithRoles = await prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!userWithRoles || userWithRoles.tenantId !== user.tenantId) {
      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'User not found',
        },
      });
      return;
    }

    const userRoles = userWithRoles.roles.map(ur => ur.role.name);
    const hasRole = roles.some(role => userRoles.includes(role as string));

    if (!hasRole) {
      await auditLog({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'authorization.denied',
        entityType: 'Role',
        resource: request.url,
        method: request.method,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: `Role denied: requires one of [${roles.join(', ')}]`,
      });

      reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Role denied: requires one of [${roles.join(', ')}]`,
        },
      });
      return;
    }
  };
}

