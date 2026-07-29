/**
 * Tenant resolution.
 *
 * Multi-tenancy invariant: a request's tenant is derived from its
 * credentials, never from client-supplied input. The legacy
 * `x-demo-tenant-id` header (and its `demoTenantId` query twin) used to take
 * precedence over the authenticated principal, which let any logged-in user
 * read and write another tenant's data simply by setting a header.
 *
 * The header is now only honoured for genuinely unauthenticated requests, and
 * only when the deployment explicitly opts into demo mode. Whenever a request
 * carries real credentials, that principal's tenant wins.
 */

export interface TenantPrincipal {
  tenantId?: string | null;
}

/**
 * Whether this deployment accepts the demo tenant header at all.
 * Disabled unless `DEMO_MODE=true` is set; never enabled implicitly in
 * production.
 */
export function isDemoTenantHeaderAllowed(): boolean {
  if (process.env.DEMO_MODE === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.DEMO_MODE !== 'false' && process.env.ALLOW_DEMO_TENANT === 'true';
}

/**
 * Resolve the tenant a request is allowed to touch.
 *
 * Authenticated principal always wins. The demo header is a fallback for
 * anonymous demo sessions only.
 */
export function resolveTenantId(
  user: TenantPrincipal | undefined | null,
  demoTenantId?: string | null
): string | undefined {
  const authenticatedTenantId = user?.tenantId;
  if (authenticatedTenantId) return authenticatedTenantId;
  if (demoTenantId && isDemoTenantHeaderAllowed()) return demoTenantId;
  return undefined;
}

/**
 * Same as {@link resolveTenantId} but normalised to `null` for call sites that
 * model "no tenant" that way.
 */
export function resolveTenantIdOrNull(
  user: TenantPrincipal | undefined | null,
  demoTenantId?: string | null
): string | null {
  return resolveTenantId(user, demoTenantId) ?? null;
}
