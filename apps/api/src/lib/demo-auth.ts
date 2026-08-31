/**
 * Whether the demo-tenant bypass is switched on for this process.
 *
 * When enabled, a request carrying `X-Demo-Tenant-Id` (or `?demoTenantId=`) is
 * accepted as that tenant with no credential whatsoever. That is a deliberate
 * convenience for demo environments and a full authentication bypass anywhere
 * else, so it is opt-in: unset, or any value other than 'true', means off.
 *
 * This lives in one place because the policy was previously duplicated -- the
 * global /api/v1 hook had one copy and `resolveTenantContext` in the automation
 * routes had another, so gating the first left the second wide open on the
 * /api/automation/* aliases, which never run the hook at all.
 *
 * Read at call time rather than captured at import: a test that exercises the
 * demo path can opt into it, and everything else stays closed by default.
 */
export function isDemoTenantAuthEnabled(): boolean {
  return process.env.ALLOW_DEMO_TENANT_AUTH === 'true';
}

/** The banner emitted at boot when the bypass is live. Warn loudly, once. */
export function warnIfDemoTenantAuthEnabled(): void {
  if (!isDemoTenantAuthEnabled()) return;
  // console rather than the fastify logger: this runs during boot, before
  // pino's transport is reliably up -- the logged version never reached the
  // output. A warning nobody sees reads as reassurance in review.
  console.warn(
    '[SECURITY] ALLOW_DEMO_TENANT_AUTH is enabled: any request carrying ' +
      'X-Demo-Tenant-Id is treated as that tenant without credentials. ' +
      'This must never be set in production.'
  );
}
