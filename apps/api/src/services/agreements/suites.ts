/**
 * Sales workspaces and their agreement suites, as the agreement engine uses
 * them.
 *
 * A `SuiteContext` is everything a send needs to know about the ISSUER: the
 * workspace, its suite row, the frozen issuer identity it will stamp on the
 * envelope, and the template set it may send from. Routes never build one from
 * request input: the platform surface asks for NetEnroll's
 * (`platformSuiteContext`), the sales surface for the workspace the principal
 * resolved to (`lib/sales-workspace.ts`), and nothing else exists.
 */

import { BRAND_THEME_NAMES, isBrandThemeKey } from '@hopwhistle/shared';
import type { AgreementSuite, PrismaClient, SalesWorkspace } from '@prisma/client';

import { configuredPortalDomain, defaultPortalUrl } from '../../lib/tenant-brand.js';

import {
  legalNameOf,
  presentIssuer,
  type FrozenIssuer,
  type IssuerPresentation,
} from './issuer.js';
import { loadAgreementSettings } from './settings.js';
import { templateSetFor, type TemplateSetState } from './template-sets.js';

export interface SuiteContext {
  workspace: SalesWorkspace;
  suite: AgreementSuite;
  scope: 'PLATFORM' | 'TENANT';
  templates: TemplateSetState;
}

/** NetEnroll's platform workspace and suite, created on first use. */
export async function ensurePlatformWorkspace(
  prisma: PrismaClient
): Promise<{ workspace: SalesWorkspace; suite: AgreementSuite }> {
  let workspace = await prisma.salesWorkspace.findFirst({ where: { scopeType: 'PLATFORM' } });
  if (!workspace) {
    // The migration creates it; a database built by `db push`, or emptied by a
    // test, has none. The partial unique index makes a race lose cleanly.
    try {
      workspace = await prisma.salesWorkspace.create({
        data: { scopeType: 'PLATFORM', tenantId: null, name: 'NetEnroll' },
      });
    } catch {
      workspace = await prisma.salesWorkspace.findFirstOrThrow({
        where: { scopeType: 'PLATFORM' },
      });
    }
  }
  let suite = await prisma.agreementSuite.findUnique({ where: { workspaceId: workspace.id } });
  if (!suite) {
    // Seeded from the legacy singleton, exactly as the migration backfills it.
    const legacy = await loadAgreementSettings(prisma);
    try {
      suite = await prisma.agreementSuite.create({
        data: {
          workspaceId: workspace.id,
          displayName: 'NetEnroll',
          legalEntityName: 'PVN LLC',
          dbaName: 'NetEnroll',
          noticeAddress: legacy.netenrollNoticeAddress,
          noticeEmail: legacy.netenrollNoticeEmail,
          defaultSignatoryName: legacy.defaultSignatoryName,
          defaultSignatoryTitle: legacy.defaultSignatoryTitle,
          internalCopyEmails: legacy.internalCopyEmails,
          brandTheme: null,
          templateSetKey: 'netenroll',
          sealSecretRef: 'DEFAULT',
          sealLocation: 'Saint Augustine, Florida',
          referencePrefix: 'NE',
        },
      });
    } catch {
      suite = await prisma.agreementSuite.findUniqueOrThrow({
        where: { workspaceId: workspace.id },
      });
    }
  }
  return { workspace, suite };
}

/**
 * Whether a tenant is a sales issuer: a white-label tenant that is not itself
 * somebody's child. A child agency never has (or inherits) a workspace.
 */
export function isSalesIssuerTenant(tenant: {
  whiteLabel: boolean;
  parentTenantId: string | null;
}): boolean {
  return tenant.whiteLabel === true && !tenant.parentTenantId;
}

/**
 * A white-label tenant's workspace and suite, created on first use, or null
 * when the tenant is not a sales issuer. The suite starts with the tenant's
 * brand and NO legal entity, notice details or signatory: the brand is not the
 * contracting entity, so it cannot send until its owner says who that is.
 */
export async function ensureTenantWorkspace(
  prisma: PrismaClient,
  tenantId: string
): Promise<{ workspace: SalesWorkspace; suite: AgreementSuite } | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      whiteLabel: true,
      parentTenantId: true,
      brandTheme: true,
      brandName: true,
    },
  });
  if (!tenant || !isSalesIssuerTenant(tenant)) return null;
  const brandTheme = isBrandThemeKey(tenant.brandTheme) ? tenant.brandTheme : null;
  const name =
    tenant.brandName?.trim() || (brandTheme ? BRAND_THEME_NAMES[brandTheme] : null) || tenant.name;

  let workspace = await prisma.salesWorkspace.findUnique({ where: { tenantId } });
  if (!workspace) {
    try {
      workspace = await prisma.salesWorkspace.create({
        data: { scopeType: 'TENANT', tenantId, name },
      });
    } catch {
      workspace = await prisma.salesWorkspace.findUniqueOrThrow({ where: { tenantId } });
    }
  }
  let suite = await prisma.agreementSuite.findUnique({ where: { workspaceId: workspace.id } });
  if (!suite) {
    try {
      suite = await prisma.agreementSuite.create({
        data: {
          workspaceId: workspace.id,
          displayName: name,
          internalCopyEmails: [],
          brandTheme,
          // A theme with its own registered set points at it (template-sets.ts);
          // anything else has none until a platform admin assigns one.
          templateSetKey:
            brandTheme &&
            templateSetFor({ scope: 'TENANT', templateSetKey: brandTheme, brandTheme }).set
              ? brandTheme
              : null,
          referencePrefix: brandTheme === 'life-leads-plus' ? 'LLP' : 'AG',
        },
      });
    } catch {
      suite = await prisma.agreementSuite.findUniqueOrThrow({
        where: { workspaceId: workspace.id },
      });
    }
  }
  return { workspace, suite };
}

export function suiteContext(workspace: SalesWorkspace, suite: AgreementSuite): SuiteContext {
  if (suite.workspaceId !== workspace.id) throw new Error('Suite does not belong to workspace');
  const scope = workspace.scopeType;
  return {
    workspace,
    suite,
    scope,
    templates: templateSetFor({
      scope,
      templateSetKey: suite.templateSetKey,
      brandTheme: suite.brandTheme,
    }),
  };
}

export async function platformSuiteContext(prisma: PrismaClient): Promise<SuiteContext> {
  const { workspace, suite } = await ensurePlatformWorkspace(prisma);
  return suiteContext(workspace, suite);
}

/** "NetEnroll's notice email" -- the first required field that is empty, or null. */
export function missingSuiteSetting(ctx: Pick<SuiteContext, 'suite' | 'scope'>): string | null {
  const s = ctx.suite;
  const who = `${s.displayName}'s`;
  if (ctx.scope === 'TENANT' && !s.legalEntityName?.trim())
    return `${who} legal contracting entity`;
  if (!s.noticeAddress?.trim()) return `${who} notice address`;
  if (!s.noticeEmail?.trim()) return `${who} notice email`;
  return null;
}

/** What the suite screens show: configured, and if not, why not. */
export function suiteReadiness(ctx: SuiteContext): {
  templatesConfigured: boolean;
  templatesMessage: string | null;
  missingSetting: string | null;
  enabled: boolean;
  canSend: boolean;
} {
  const missingSetting = missingSuiteSetting(ctx);
  const templatesConfigured = ctx.templates.configured;
  const enabled = ctx.suite.status === 'ACTIVE' && ctx.workspace.status === 'ACTIVE';
  return {
    templatesConfigured,
    templatesMessage: ctx.templates.configured ? null : ctx.templates.reason,
    missingSetting,
    enabled,
    canSend: templatesConfigured && !missingSetting && enabled,
  };
}

/**
 * Where an issuer's links point: the suite's own origin (platform-set), else
 * the issuer tenant's portal domain (`Tenant.domain`), else null for the
 * default portal. The recipient's host and the request's host play no part.
 */
export async function linkOriginFor(ctx: SuiteContext): Promise<string | null> {
  if (ctx.suite.linkOrigin) return ctx.suite.linkOrigin.replace(/\/+$/, '');
  if (ctx.scope === 'TENANT' && ctx.workspace.tenantId) {
    const domain = await configuredPortalDomain(ctx.workspace.tenantId);
    return domain ? `https://${domain}` : null;
  }
  return null;
}

/** The issuer identity frozen into `terms.issuer` at send. */
export async function freezeIssuer(ctx: SuiteContext): Promise<FrozenIssuer> {
  const s = ctx.suite;
  return {
    workspaceId: ctx.workspace.id,
    suiteId: s.id,
    scope: ctx.scope,
    displayName: s.displayName,
    legalEntityName: (s.legalEntityName ?? '').trim(),
    dbaName: s.dbaName?.trim() || null,
    noticeAddress: (s.noticeAddress ?? '').trim(),
    noticeEmail: (s.noticeEmail ?? '').trim(),
    replyToEmail: s.replyToEmail?.trim() || null,
    brandTheme: isBrandThemeKey(s.brandTheme) ? s.brandTheme : null,
    linkOrigin: await linkOriginFor(ctx),
    templateSetKey: s.templateSetKey ?? '',
  };
}

/** The issuer as it would present right now, before anything is frozen. */
export async function currentIssuer(ctx: SuiteContext): Promise<IssuerPresentation> {
  return presentIssuer(await freezeIssuer(ctx));
}

/** "PVN LLC d/b/a NetEnroll", from the suite as configured. */
export function suiteLegalName(
  suite: Pick<AgreementSuite, 'legalEntityName' | 'dbaName' | 'displayName'>
): string {
  return legalNameOf({
    legalEntityName: suite.legalEntityName?.trim() || suite.displayName,
    dbaName: suite.dbaName?.trim() || null,
  });
}

/** The default portal, re-exported for callers building admin links. */
export { defaultPortalUrl };
