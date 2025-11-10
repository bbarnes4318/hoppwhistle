import { getPrismaClient } from '../lib/prisma.js';

export interface AuditLogData {
  tenantId: string;
  userId?: string;
  apiKeyId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  resource?: string;
  method?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  success?: boolean;
  error?: string;
}

/**
 * Create an audit log entry
 */
export async function auditLog(data: AuditLogData): Promise<void> {
  const prisma = getPrismaClient();
  
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        apiKeyId: data.apiKeyId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        resource: data.resource,
        method: data.method,
        changes: data.changes,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        requestId: data.requestId,
        success: data.success ?? true,
        error: data.error,
      },
    });
  } catch (error) {
    // Don't throw - audit logging failures shouldn't break the request
    console.error('Failed to create audit log:', error);
  }
}

/**
 * Audit entity creation
 */
export async function auditCreate(
  tenantId: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  context: {
    userId?: string;
    apiKeyId?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }
): Promise<void> {
  await auditLog({
    tenantId,
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    action: `${entityType.toLowerCase()}.create`,
    entityType,
    entityId,
    changes: { after: data },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    success: true,
  });
}

/**
 * Audit entity update
 */
export async function auditUpdate(
  tenantId: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  context: {
    userId?: string;
    apiKeyId?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }
): Promise<void> {
  // Calculate changes
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = {
        before: before[key],
        after: after[key],
      };
    }
  }

  await auditLog({
    tenantId,
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    action: `${entityType.toLowerCase()}.update`,
    entityType,
    entityId,
    changes,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    success: true,
  });
}

/**
 * Audit entity deletion
 */
export async function auditDelete(
  tenantId: string,
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  context: {
    userId?: string;
    apiKeyId?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }
): Promise<void> {
  await auditLog({
    tenantId,
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    action: `${entityType.toLowerCase()}.delete`,
    entityType,
    entityId,
    changes: { before: data },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    success: true,
  });
}

/**
 * Audit sensitive read (e.g., reading user data, API keys, etc.)
 */
export async function auditRead(
  tenantId: string,
  entityType: string,
  entityId: string,
  resource: string,
  context: {
    userId?: string;
    apiKeyId?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
  }
): Promise<void> {
  await auditLog({
    tenantId,
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    action: `${entityType.toLowerCase()}.read`,
    entityType,
    entityId,
    resource,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
    success: true,
  });
}

