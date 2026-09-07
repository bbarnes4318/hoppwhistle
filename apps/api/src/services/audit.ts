import { getPrismaClient } from '../lib/prisma.js';

export interface AuditLogData {
  /**
   * The agency this event belongs to, or `null` when it genuinely belongs to
   * none -- a failed login for an address matching no account, an invalid JWT,
   * a CSRF failure on an unauthenticated request.
   *
   * Pass `null`, never a placeholder. `'unknown'` and `'default'` are not
   * tenant ids; `audit_logs.tenantId` is a foreign key, and a row naming a
   * tenant that does not exist will now throw rather than vanish.
   */
  tenantId: string | null;
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
 * Create an audit log entry.
 *
 * ── This function does not swallow ───────────────────────────────────────────
 *
 * It used to end with:
 *
 *     } catch (error) {
 *       // Don't throw - audit logging failures shouldn't break the request
 *       console.error('Failed to create audit log:', error);
 *     }
 *
 * which sounds prudent and was not. `audit_logs.tenantId` is a foreign key, and
 * a dozen call sites passed the strings `'unknown'` or `'default'` because the
 * column was NOT NULL and they had no tenant to give it. Every one of those
 * inserts failed the constraint, and every one of those failures was caught and
 * discarded. Login and logout, the two events an audit trail exists for, were
 * recorded nowhere. The code read as though they were.
 *
 * A trail that silently records nothing is worse than no trail, because people
 * rely on it. So this either writes the row or raises, and the caller decides
 * what that means for the request.
 *
 * ── What raising costs ───────────────────────────────────────────────────────
 *
 * A failure here now propagates. If the audit table is unwritable, operations
 * that audit will fail rather than proceed unrecorded. That is the intended
 * trade and it is deliberately not configurable: the acting-tenant switch
 * writes a row for every entry by NetEnroll staff into an agency's data, and
 * those rows are the only record of who looked at whose. An unrecorded entry
 * must not be allowed to look like a completed one.
 *
 * With `tenantId` now nullable, the failure mode this replaced cannot recur
 * from a missing tenant. What remains is a genuinely unwritable table, which is
 * an outage worth surfacing.
 */
export async function auditLog(data: AuditLogData): Promise<void> {
  const prisma = getPrismaClient();

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

