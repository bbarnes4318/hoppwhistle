/**
 * The one place the current SALES WORKSPACE is decided.
 *
 * ── What a sales workspace is ────────────────────────────────────────────────
 *
 * The company doing the selling: NetEnroll's own B2B sales operation (the
 * PLATFORM workspace) or one white-label issuer's (a TENANT workspace). Its
 * Sales CRM prospects, their activities, its agreement suite and settings, and
 * the envelopes that suite issued all belong to it, and every query on them is
 * filtered by the workspace this function returns.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * Decided from the authenticated principal (`request.user`) and the database,
 * and from nothing else. No header, query parameter, body field, cookie, Origin
 * or hostname is read: a workspace id sent by a client is never an input,
 * which is what makes "workspace B names workspace A" impossible rather than
 * merely refused.
 *
 *   platform admin, cross-agency view   → NetEnroll's PLATFORM workspace (MANAGER)
 *   platform admin acting in an agency  → that agency's workspace, through the
 *                                         established acting-tenant row; a role
 *                                         preview is judged as the previewed role
 *   white-label tenant OWNER            → its workspace (implicit MANAGER)
 *   user with an explicit grant         → its tenant's workspace, at the grant
 *   anybody else (AGENT, ADMIN, a child
 *   agency's people, a normal agency)   → refused
 *   API key                             → refused: grants are to people
 *
 * A child agency is never a sales issuer, and does not inherit its parent's
 * workspace: its OWNER is the owner of the child, not of the parent.
 */

import type { AgreementSuite, PrismaClient, SalesWorkspace } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  ensurePlatformWorkspace,
  ensureTenantWorkspace,
  isSalesIssuerTenant,
} from '../services/agreements/suites.js';

import { getPrismaClient } from './prisma.js';
import { getActingTenantId } from './tenant-context.js';

export type SalesAccessLevel = 'MANAGER' | 'MEMBER' | 'READONLY';

/** How the principal came to have the workspace. */
export type SalesAccessVia = 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT' | 'OWNER' | 'GRANT';

export interface ResolvedSalesWorkspace {
  workspace: SalesWorkspace;
  suite: AgreementSuite;
  level: SalesAccessLevel;
  via: SalesAccessVia;
  scope: 'PLATFORM' | 'TENANT';
  /** The issuer tenant, or null for NetEnroll's workspace. */
  tenantId: string | null;
  userId: string;
}

export interface SalesRefusal {
  statusCode: 401 | 403 | 409;
  code: string;
  message: string;
}

interface SalesPrincipal {
  userId?: string;
  apiKeyId?: string;
  tenantId?: string | null;
  roles?: string[];
  isPlatformAdmin?: boolean;
  actingTenantId?: string | null;
  previewRole?: string | null;
}

export const SALES_ACCESS_REQUIRED: SalesRefusal = {
  statusCode: 403,
  code: 'SALES_ACCESS_REQUIRED',
  message:
    "You don't have access to this Sales CRM. Ask the owner of your organization to grant it.",
};

export const SALES_WORKSPACE_UNAVAILABLE: SalesRefusal = {
  statusCode: 403,
  code: 'SALES_WORKSPACE_UNAVAILABLE',
  message: 'This organization has no Sales CRM.',
};

export const SALES_API_KEY_REFUSED: SalesRefusal = {
  statusCode: 403,
  code: 'FORBIDDEN',
  message: 'The Sales CRM is not available to API keys.',
};

const UNAUTHENTICATED: SalesRefusal = {
  statusCode: 401,
  code: 'UNAUTHORIZED',
  message: 'Authentication required',
};

/**
 * The workspace a principal may use, or why not.
 *
 * `create: false` never writes (for `/api/auth/me`, which only reports); a
 * tenant workspace that does not exist yet then reads as available to its
 * OWNER -- a grant cannot exist before its workspace does.
 */
export async function describeSalesAccess(
  principal: SalesPrincipal | undefined | null,
  options: { prisma?: PrismaClient; create?: boolean } = {}
): Promise<
  | ResolvedSalesWorkspace
  | SalesRefusal
  | { available: true; level: 'MANAGER'; via: 'OWNER'; scope: 'TENANT'; pending: true }
> {
  const prisma = options.prisma ?? getPrismaClient();
  const create = options.create !== false;
  if (!principal) return UNAUTHENTICATED;
  if (principal.apiKeyId) return SALES_API_KEY_REFUSED;
  const userId = principal.userId;
  if (!userId) return UNAUTHENTICATED;

  if (principal.isPlatformAdmin === true && !principal.actingTenantId) {
    const { workspace, suite } = await ensurePlatformWorkspace(prisma);
    return {
      workspace,
      suite,
      level: 'MANAGER',
      via: 'PLATFORM_ADMIN',
      scope: 'PLATFORM',
      tenantId: null,
      userId,
    };
  }

  const rawTenant = principal.tenantId;
  const tenantId = typeof rawTenant === 'string' && rawTenant.trim() ? rawTenant.trim() : null;
  if (!tenantId) return UNAUTHENTICATED;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { whiteLabel: true, parentTenantId: true },
  });
  if (!tenant || !isSalesIssuerTenant(tenant)) return SALES_WORKSPACE_UNAVAILABLE;

  const roles = principal.roles ?? [];
  const supporting = principal.isPlatformAdmin === true && !principal.previewRole;
  const owner = roles.includes('OWNER');

  let found: { workspace: SalesWorkspace; suite: AgreementSuite } | null;
  if (create) {
    found = await ensureTenantWorkspace(prisma, tenantId);
  } else {
    const workspace = await prisma.salesWorkspace.findUnique({
      where: { tenantId },
      include: { suite: true },
    });
    found = workspace?.suite ? { workspace, suite: workspace.suite } : null;
    if (!found) {
      return supporting || owner
        ? { available: true, level: 'MANAGER', via: 'OWNER', scope: 'TENANT', pending: true }
        : SALES_ACCESS_REQUIRED;
    }
  }
  if (!found) return SALES_WORKSPACE_UNAVAILABLE;
  if (found.workspace.status !== 'ACTIVE') return SALES_WORKSPACE_UNAVAILABLE;
  const base = {
    workspace: found.workspace,
    suite: found.suite,
    scope: 'TENANT' as const,
    tenantId,
    userId,
  };

  if (supporting) return { ...base, level: 'MANAGER', via: 'PLATFORM_SUPPORT' };
  if (owner) return { ...base, level: 'MANAGER', via: 'OWNER' };

  // An operator previewing a role holds no grant of their own: refused, as the
  // previewed role would be without one.
  if (principal.isPlatformAdmin === true) return SALES_ACCESS_REQUIRED;

  const grant = await prisma.salesWorkspaceAccess.findUnique({
    where: { workspaceId_userId: { workspaceId: found.workspace.id, userId } },
    select: { level: true },
  });
  if (!grant) return SALES_ACCESS_REQUIRED;
  return { ...base, level: grant.level, via: 'GRANT' };
}

export function isResolved(
  value: Awaited<ReturnType<typeof describeSalesAccess>>
): value is ResolvedSalesWorkspace {
  return 'workspace' in value;
}

/**
 * The current sales workspace for a request, or null after sending the
 * refusal. The only function a sales route uses to learn its workspace.
 */
export async function resolveSalesWorkspace(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ResolvedSalesWorkspace | null> {
  const principal = request.user as SalesPrincipal | undefined;
  // `tenantId` exactly as tenant-context reads it: the principal, nothing else.
  const result = await describeSalesAccess(
    principal ? { ...principal, tenantId: getActingTenantId(request) } : principal
  );
  if (isResolved(result)) return result;
  const refusal = result as SalesRefusal;
  void reply
    .code(refusal.statusCode)
    .send({ error: { code: refusal.code, message: refusal.message } });
  return null;
}

/**
 * What `/api/auth/me` reports, so the navigation is drawn from the same answer
 * the API enforces. Null when there is no Sales CRM for this principal.
 */
export async function salesCapabilityFor(principal: SalesPrincipal | undefined | null): Promise<{
  scope: 'PLATFORM' | 'TENANT';
  level: SalesAccessLevel;
  via: SalesAccessVia;
  workspaceName: string | null;
} | null> {
  try {
    const result = await describeSalesAccess(principal, { create: false });
    if (isResolved(result)) {
      return {
        scope: result.scope,
        level: result.level,
        via: result.via,
        workspaceName: result.workspace.name,
      };
    }
    if ('pending' in result) {
      return {
        scope: 'TENANT',
        level: 'MANAGER',
        via: principal?.isPlatformAdmin ? 'PLATFORM_SUPPORT' : 'OWNER',
        workspaceName: null,
      };
    }
    return null;
  } catch {
    return null;
  }
}
