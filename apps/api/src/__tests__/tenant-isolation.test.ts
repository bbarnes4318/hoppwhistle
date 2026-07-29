import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDemoTenantHeaderAllowed, resolveTenantId, resolveTenantIdOrNull } from '../lib/tenant.js';

const ORIGINAL_ENV = { ...process.env };

describe('tenant resolution', () => {
  beforeEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.ALLOW_DEMO_TENANT;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns the authenticated user's tenant", () => {
    expect(resolveTenantId({ tenantId: 'tenant-a' })).toBe('tenant-a');
  });

  it('ignores a client-supplied demo tenant when the caller is authenticated', () => {
    process.env.DEMO_MODE = 'true';

    // The header names another tenant; the credentials must win.
    expect(resolveTenantId({ tenantId: 'tenant-a' }, 'tenant-b')).toBe('tenant-a');
  });

  it('ignores the demo tenant header when demo mode is off', () => {
    expect(resolveTenantId(undefined, 'tenant-b')).toBeUndefined();
    expect(resolveTenantIdOrNull(undefined, 'tenant-b')).toBeNull();
  });

  it('accepts the demo tenant header only for anonymous callers in demo mode', () => {
    process.env.DEMO_MODE = 'true';

    expect(resolveTenantId(undefined, 'tenant-b')).toBe('tenant-b');
    expect(resolveTenantId(null, 'tenant-b')).toBe('tenant-b');
  });

  it('never allows the demo tenant header in production without an explicit opt-in', () => {
    process.env.NODE_ENV = 'production';

    expect(isDemoTenantHeaderAllowed()).toBe(false);
    expect(resolveTenantId(undefined, 'tenant-b')).toBeUndefined();
  });

  it('treats a user without a tenant as unresolved rather than falling back', () => {
    expect(resolveTenantId({ tenantId: null })).toBeUndefined();
    expect(resolveTenantId({})).toBeUndefined();
  });
});
