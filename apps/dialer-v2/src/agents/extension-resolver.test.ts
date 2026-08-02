import { describe, expect, it, vi } from 'vitest';

import {
  ExtensionRejection,
  ExtensionResolver,
  StaticExtensionSource,
  type ExtensionBinding,
  type ExtensionSource,
} from './extension-resolver.js';

const T0 = 1_800_000_000_000;

function binding(overrides: Partial<ExtensionBinding> = {}): ExtensionBinding {
  return {
    tenantId: 'tenant-a',
    userId: 'user-1',
    agentId: 'agent-1',
    extension: '1001',
    sipDomain: 'hopwhistle.com',
    enabled: true,
    maxConcurrentCalls: 1,
    ...overrides,
  };
}

function build(bindings: ExtensionBinding[] = [], nowRef = { value: T0 }) {
  const source = new StaticExtensionSource();
  for (const b of bindings) source.add(b);
  return {
    source,
    nowRef,
    resolver: new ExtensionResolver({ source, now: () => nowRef.value, ttlMs: 60_000 }),
  };
}

describe('agent to extension', () => {
  it('resolves the correct extension', async () => {
    const { resolver } = build([binding()]);
    const result = await resolver.forAgent('tenant-a', 'agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding.extension).toBe('1001');
      expect(result.binding.maxConcurrentCalls).toBe(1);
    }
  });

  it('rejects an agent with no extension', async () => {
    // The previous default was `extension: null`, which silently meant no agent
    // could ever pass SIP eligibility. That must be an explicit rejection.
    const { resolver } = build([]);
    const result = await resolver.forAgent('tenant-a', 'agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.NO_EXTENSION);
  });

  it('rejects a disabled extension', async () => {
    const { resolver } = build([binding({ enabled: false })]);
    const result = await resolver.forAgent('tenant-a', 'agent-1');
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.DISABLED);
  });

  it('rejects an ambiguous assignment rather than guessing', async () => {
    // Two live extensions means we cannot say which one a call would reach.
    const { resolver } = build([binding(), binding({ extension: '1002' })]);
    const result = await resolver.forAgent('tenant-a', 'agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.AMBIGUOUS);
  });

  it('never assumes agentId equals extension', async () => {
    const { resolver } = build([binding({ agentId: 'agent-1', extension: '7788' })]);
    const result = await resolver.forAgent('tenant-a', 'agent-1');
    if (result.ok) expect(result.binding.extension).toBe('7788');
  });

  it('rejects an unknown agent', async () => {
    const { resolver } = build([binding()]);
    const result = await resolver.forAgent('tenant-a', 'nobody');
    expect(result.ok).toBe(false);
  });

  it('rejects an unusable tenant id without querying', async () => {
    const byAgent = vi.fn(() => Promise.resolve([] as ExtensionBinding[]));
    const source: ExtensionSource = {
      byAgent,
      bySipIdentity: vi.fn(() => Promise.resolve([] as ExtensionBinding[])),
    };
    const resolver = new ExtensionResolver({ source });
    const result = await resolver.forAgent('global', 'agent-1');

    expect(result.ok).toBe(false);
    expect(byAgent).not.toHaveBeenCalled();
  });
});

describe('cross-tenant', () => {
  it('rejects when the lookup returns another tenant binding', async () => {
    const { resolver } = build([binding({ tenantId: 'tenant-b' })]);
    // The source matches by agentId within the tenant, so this returns nothing —
    // but the resolver must also refuse if such a row ever reaches it.
    const result = await resolver.forAgent('tenant-a', 'agent-1');
    expect(result.ok).toBe(false);
  });

  it('refuses a SIP identity that maps to two tenants', async () => {
    // The same extension@domain existing in two tenants is a configuration
    // error. Picking either one would attribute a real registration, and later
    // real capacity, to a tenant that may not own it.
    const { resolver } = build([
      binding({ tenantId: 'tenant-a' }),
      binding({ tenantId: 'tenant-b', agentId: 'agent-9' }),
    ]);
    const result = await resolver.forSipIdentity('1001', 'hopwhistle.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.CROSS_TENANT);
  });
});

describe('SIP identity resolution', () => {
  it('resolves extension@domain to a verified tenant', async () => {
    // This is what replaces trusting the SIP `domain_name` header as a tenant
    // id: the domain is an input to a lookup, never an output.
    const { resolver } = build([binding()]);
    const result = await resolver.forSipIdentity('1001', 'hopwhistle.com');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.binding.tenantId).toBe('tenant-a');
  });

  it('refuses an unknown SIP identity', async () => {
    const { resolver } = build([binding()]);
    const result = await resolver.forSipIdentity('9999', 'attacker.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.UNRESOLVED_SIP_IDENTITY);
  });

  it('refuses a domain that merely looks like a tenant id', async () => {
    const { resolver } = build([binding()]);
    const result = await resolver.forSipIdentity('1001', 'tenant-a');
    expect(result.ok).toBe(false);
  });

  it('requires both extension and domain', async () => {
    const { resolver } = build([binding()]);
    expect((await resolver.forSipIdentity('', 'hopwhistle.com')).ok).toBe(false);
    expect((await resolver.forSipIdentity('1001', '')).ok).toBe(false);
  });
});

describe('caching and invalidation', () => {
  it('caches within the TTL', async () => {
    const byAgent = vi.fn(() => Promise.resolve([binding()]));
    const source: ExtensionSource = {
      byAgent,
      bySipIdentity: vi.fn(() => Promise.resolve([] as ExtensionBinding[])),
    };
    const resolver = new ExtensionResolver({ source, ttlMs: 60_000 });

    await resolver.forAgent('tenant-a', 'agent-1');
    await resolver.forAgent('tenant-a', 'agent-1');
    expect(byAgent).toHaveBeenCalledTimes(1);
  });

  it('re-resolves after the TTL, so a reassignment is picked up', async () => {
    const nowRef = { value: T0 };
    const source = new StaticExtensionSource();
    source.add(binding({ extension: '1001' }));
    const resolver = new ExtensionResolver({ source, now: () => nowRef.value, ttlMs: 60_000 });

    const first = await resolver.forAgent('tenant-a', 'agent-1');
    if (first.ok) expect(first.binding.extension).toBe('1001');

    source.clear();
    source.add(binding({ extension: '2002' }));
    nowRef.value = T0 + 61_000;

    const second = await resolver.forAgent('tenant-a', 'agent-1');
    if (second.ok) expect(second.binding.extension).toBe('2002');
  });

  it('serves a stale mapping until the TTL, which invalidation clears', async () => {
    const source = new StaticExtensionSource();
    source.add(binding({ extension: '1001' }));
    const resolver = new ExtensionResolver({ source, ttlMs: 60_000 });

    await resolver.forAgent('tenant-a', 'agent-1');
    source.clear();
    source.add(binding({ extension: '2002' }));

    const stale = await resolver.forAgent('tenant-a', 'agent-1');
    if (stale.ok) expect(stale.binding.extension).toBe('1001');

    resolver.invalidateAgent('tenant-a', 'agent-1');
    const fresh = await resolver.forAgent('tenant-a', 'agent-1');
    if (fresh.ok) expect(fresh.binding.extension).toBe('2002');
  });
});

describe('failure handling', () => {
  it('fails closed when the lookup throws', async () => {
    const source: ExtensionSource = {
      byAgent: () => Promise.reject(new Error('db down')),
      bySipIdentity: () => Promise.reject(new Error('db down')),
    };
    const resolver = new ExtensionResolver({ source });

    const result = await resolver.forAgent('tenant-a', 'agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection).toBe(ExtensionRejection.LOOKUP_FAILED);
  });

  it('does not cache a lookup failure as a durable negative', async () => {
    let fail = true;
    const source: ExtensionSource = {
      byAgent: () => (fail ? Promise.reject(new Error('blip')) : Promise.resolve([binding()])),
      bySipIdentity: () => Promise.resolve([]),
    };
    const resolver = new ExtensionResolver({ source, ttlMs: 60_000 });

    expect((await resolver.forAgent('tenant-a', 'agent-1')).ok).toBe(false);
    fail = false;
    // A transient database blip must not lock the agent out for the whole TTL.
    expect((await resolver.forAgent('tenant-a', 'agent-1')).ok).toBe(true);
  });
});
