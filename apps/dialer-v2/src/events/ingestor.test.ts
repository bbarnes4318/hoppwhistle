import { describe, expect, it, vi } from 'vitest';

import { EventIngestor } from './ingestor.js';
import { deriveEventId, normalizeEslEvent } from './normalize.js';
import { InMemoryDedupeStore, InMemoryEventStore } from './store.js';
import { QuarantineReason, TelephonyEventType, type RawEslEvent } from './types.js';

const T0 = 1_800_000_000_000;

function rawEvent(overrides: RawEslEvent = {}): RawEslEvent {
  return {
    'Event-Name': 'CHANNEL_ANSWER',
    'Event-Date-Timestamp': String(T0 * 1000),
    'Event-Sequence': '4242',
    'Core-UUID': 'core-1',
    'Unique-ID': 'chan-abc',
    'Channel-Name': 'sofia/gateway/fractel3/+18005551212',
    'Caller-Caller-ID-Number': '+18656000124',
    'Caller-Destination-Number': '+18005551212',
    'Hangup-Cause': undefined,
    variable_hopwhistle_tenant_id: 'tenant-a',
    variable_hopwhistle_campaign_id: 'camp-1',
    variable_hopwhistle_lead_id: 'lead-1',
    variable_hopwhistle_dialer_version: '2',
    ...overrides,
  };
}

function makeIngestor(now = () => T0) {
  const store = new InMemoryEventStore();
  const dedupe = new InMemoryDedupeStore(now);
  const seen: string[] = [];
  const ingestor = new EventIngestor({
    store,
    dedupe,
    now,
    onEvent: e => seen.push(e.eventId),
  });
  return { store, dedupe, ingestor, seen };
}

describe('normalization', () => {
  it('parses a complete event', () => {
    const result = normalizeEslEvent(rawEvent(), T0 + 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.eventType).toBe(TelephonyEventType.CHANNEL_ANSWER);
    expect(result.event.eventVersion).toBe(1);
    expect(result.event.tenantId).toBe('tenant-a');
    expect(result.event.campaignId).toBe('camp-1');
    expect(result.event.leadId).toBe('lead-1');
    expect(result.event.channelUuid).toBe('chan-abc');
    expect(result.event.gateway).toBe('fractel3');
    expect(result.event.answerState).toBe('answered');
    expect(result.event.dialerVersion).toBe(2);
    expect(result.event.occurredAt).toBe(T0);
    expect(result.event.receivedAt).toBe(T0 + 50);
  });

  it('converts the FreeSWITCH microsecond timestamp correctly', () => {
    // Off by 1000x makes every event look decades stale and trips the pacing
    // controller's event-lag hard stop.
    const result = normalizeEslEvent(rawEvent({ 'Event-Date-Timestamp': '1800000000123456' }), T0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.occurredAt).toBe(1_800_000_000_123);
  });

  it('tolerates missing optional headers', () => {
    const result = normalizeEslEvent(
      {
        'Event-Name': 'CHANNEL_CREATE',
        variable_hopwhistle_tenant_id: 'tenant-a',
      },
      T0
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.campaignId).toBeNull();
    expect(result.event.gateway).toBeNull();
    expect(result.event.channelUuid).toBeNull();
    expect(result.event.hangupCause).toBeNull();
  });

  it('treats FreeSWITCH _undef_ as absent', () => {
    const result = normalizeEslEvent(rawEvent({ variable_hopwhistle_campaign_id: '_undef_' }), T0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.campaignId).toBeNull();
  });

  it('derives gateway only from a gateway channel', () => {
    const agentLeg = normalizeEslEvent(
      rawEvent({ 'Channel-Name': 'sofia/internal/1001@hopwhistle.com' }),
      T0
    );
    expect(agentLeg.ok).toBe(true);
    if (agentLeg.ok) expect(agentLeg.event.gateway).toBeNull();
  });

  it('maps events to the right answer state', () => {
    const cases: Array<[string, string]> = [
      ['CHANNEL_CREATE', 'ringing'],
      ['CHANNEL_PROGRESS', 'early'],
      ['CHANNEL_ANSWER', 'answered'],
      ['CHANNEL_BRIDGE', 'answered'],
      ['CHANNEL_HANGUP', 'hangup'],
    ];
    for (const [name, expected] of cases) {
      const result = normalizeEslEvent(rawEvent({ 'Event-Name': name }), T0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.event.answerState).toBe(expected);
    }
  });
});

describe('tenant attribution', () => {
  it('quarantines an event with no tenant rather than assigning a default', () => {
    const result = normalizeEslEvent(rawEvent({ variable_hopwhistle_tenant_id: undefined }), T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.quarantined.reason).toBe(QuarantineReason.NO_TENANT);
    expect(result.quarantined.channelUuid).toBe('chan-abc');
  });

  it('quarantines a reserved tenant id rather than letting it into the keyspace', () => {
    for (const tenantId of ['global', 'platform', 'admin']) {
      const result = normalizeEslEvent(rawEvent({ variable_hopwhistle_tenant_id: tenantId }), T0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.quarantined.reason).toBe(QuarantineReason.INVALID_TENANT_ID);
    }
  });

  it('quarantines a tenant id containing a Redis delimiter', () => {
    const result = normalizeEslEvent(
      rawEvent({ variable_hopwhistle_tenant_id: 'tenant-a:evil' }),
      T0
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.quarantined.reason).toBe(QuarantineReason.INVALID_TENANT_ID);
  });

  it('quarantines an unsupported event type', () => {
    const result = normalizeEslEvent(rawEvent({ 'Event-Name': 'HEARTBEAT' }), T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.quarantined.reason).toBe(QuarantineReason.UNSUPPORTED_EVENT);
  });

  it('keeps only a small forensic header subset when quarantining', () => {
    const result = normalizeEslEvent(
      rawEvent({ variable_hopwhistle_tenant_id: undefined, variable_secret_thing: 'sensitive' }),
      T0
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.quarantined.detail)).not.toContain('sensitive');
    expect(result.quarantined.detail['Event-Name']).toBe('CHANNEL_ANSWER');
  });
});

describe('deterministic identity', () => {
  it('produces the same id for the same physical event', () => {
    const raw = rawEvent();
    expect(deriveEventId(raw, 'CHANNEL_ANSWER', T0)).toBe(deriveEventId(raw, 'CHANNEL_ANSWER', T0));
  });

  it('distinguishes different events on the same channel', () => {
    const a = deriveEventId(rawEvent({ 'Event-Sequence': '1' }), 'CHANNEL_ANSWER', T0);
    const b = deriveEventId(rawEvent({ 'Event-Sequence': '2' }), 'CHANNEL_ANSWER', T0);
    expect(a).not.toBe(b);
  });

  it('distinguishes DTMF digits arriving in the same millisecond', () => {
    const a = deriveEventId(
      rawEvent({ 'Event-Name': 'DTMF', 'DTMF-Digit': '1', 'Event-Sequence': undefined }),
      'DTMF',
      T0
    );
    const b = deriveEventId(
      rawEvent({ 'Event-Name': 'DTMF', 'DTMF-Digit': '2', 'Event-Sequence': undefined }),
      'DTMF',
      T0
    );
    expect(a).not.toBe(b);
  });
});

describe('deduplication', () => {
  it('accepts an event once and rejects the replay', async () => {
    const { ingestor, seen } = makeIngestor();
    const raw = rawEvent();

    expect(await ingestor.handleRaw(raw)).not.toBeNull();
    expect(await ingestor.handleRaw(raw)).toBeNull();

    const metrics = ingestor.getMetrics();
    expect(metrics.received).toBe(2);
    expect(metrics.normalized).toBe(1);
    expect(metrics.duplicates).toBe(1);
    // A duplicate must not re-notify subscribers.
    expect(seen).toHaveLength(1);
  });

  it('does not duplicate stored records when a whole stream is replayed', async () => {
    const { ingestor, store } = makeIngestor();
    const stream = [
      rawEvent({ 'Event-Name': 'CHANNEL_CREATE', 'Event-Sequence': '1' }),
      rawEvent({ 'Event-Name': 'CHANNEL_PROGRESS', 'Event-Sequence': '2' }),
      rawEvent({ 'Event-Name': 'CHANNEL_ANSWER', 'Event-Sequence': '3' }),
      rawEvent({ 'Event-Name': 'CHANNEL_HANGUP', 'Event-Sequence': '4' }),
    ];

    for (const e of stream) await ingestor.handleRaw(e);
    const afterFirstPass = store.size();

    for (const e of stream) await ingestor.handleRaw(e);
    expect(store.size()).toBe(afterFirstPass);
    expect(ingestor.getMetrics().duplicates).toBe(4);
  });

  it('scopes dedupe per tenant, so two tenants can share an id without collision', async () => {
    const store = new InMemoryEventStore();
    const dedupe = new InMemoryDedupeStore(() => T0);
    expect(await dedupe.markSeen('tenant-a', 'evt-1', 1000)).toBe(true);
    expect(await dedupe.markSeen('tenant-b', 'evt-1', 1000)).toBe(true);
    expect(await dedupe.markSeen('tenant-a', 'evt-1', 1000)).toBe(false);
    expect(store.size()).toBe(0);
  });
});

describe('ordering', () => {
  it('counts an event that would move a channel backwards', async () => {
    const { ingestor } = makeIngestor();
    await ingestor.handleRaw(rawEvent({ 'Event-Name': 'CHANNEL_ANSWER', 'Event-Sequence': '5' }));
    await ingestor.handleRaw(rawEvent({ 'Event-Name': 'CHANNEL_PROGRESS', 'Event-Sequence': '6' }));

    expect(ingestor.getMetrics().outOfOrder).toBe(1);
  });

  it('does not treat forward progress as out of order', async () => {
    const { ingestor } = makeIngestor();
    for (const [i, name] of [
      'CHANNEL_CREATE',
      'CHANNEL_PROGRESS',
      'CHANNEL_ANSWER',
      'CHANNEL_BRIDGE',
    ].entries()) {
      await ingestor.handleRaw(rawEvent({ 'Event-Name': name, 'Event-Sequence': String(i) }));
    }
    expect(ingestor.getMetrics().outOfOrder).toBe(0);
  });

  it('releases channel tracking after the terminal event', async () => {
    const { ingestor } = makeIngestor();
    await ingestor.handleRaw(rawEvent({ 'Event-Name': 'CHANNEL_CREATE', 'Event-Sequence': '1' }));
    expect(ingestor.trackedChannelCount()).toBe(1);
    await ingestor.handleRaw(
      rawEvent({ 'Event-Name': 'CHANNEL_HANGUP_COMPLETE', 'Event-Sequence': '2' })
    );
    expect(ingestor.trackedChannelCount()).toBe(0);
  });
});

describe('robustness', () => {
  it('never throws on malformed input', async () => {
    const { ingestor } = makeIngestor();
    await expect(ingestor.handleRaw({} as RawEslEvent)).resolves.toBeNull();
    await expect(ingestor.handleRaw(null as unknown as RawEslEvent)).resolves.toBeNull();
  });

  it('survives a throwing subscriber without losing the event', async () => {
    const store = new InMemoryEventStore();
    const onError = vi.fn();
    const ingestor = new EventIngestor({
      store,
      dedupe: new InMemoryDedupeStore(() => T0),
      now: () => T0,
      onEvent: () => {
        throw new Error('subscriber exploded');
      },
      onError,
    });

    const event = await ingestor.handleRaw(rawEvent());
    expect(event).not.toBeNull();
    expect(store.size()).toBe(1);
    expect(onError).toHaveBeenCalled();
    expect(ingestor.getMetrics().errors).toBe(1);
  });

  it('quarantines rather than crashing on an unattributable event', async () => {
    const { ingestor, store } = makeIngestor();
    await ingestor.handleRaw(rawEvent({ variable_hopwhistle_tenant_id: undefined }));
    expect(ingestor.getMetrics().quarantined).toBe(1);
    expect(await store.quarantinedCount()).toBe(1);
    expect(store.size()).toBe(0);
  });
});

describe('staleness signal', () => {
  it('reports no age before any event arrives', () => {
    const { ingestor } = makeIngestor();
    expect(ingestor.lastEventAgeMs()).toBeNull();
  });

  it('reports the age of the last accepted event', async () => {
    let now = T0;
    const { ingestor } = makeIngestor(() => now);
    await ingestor.handleRaw(rawEvent());
    now = T0 + 5_000;
    expect(ingestor.lastEventAgeMs()).toBe(5_000);
  });

  it('measures lag as occurredAt to receivedAt', async () => {
    const { ingestor } = makeIngestor(() => T0 + 250);
    await ingestor.handleRaw(rawEvent());
    expect(ingestor.currentLagMs()).toBe(250);
  });

  it('does not refresh the age on a duplicate', async () => {
    let now = T0;
    const { ingestor } = makeIngestor(() => now);
    await ingestor.handleRaw(rawEvent());
    now = T0 + 10_000;
    await ingestor.handleRaw(rawEvent());
    // Still measured from the original acceptance, not the replay.
    expect(ingestor.lastEventAgeMs()).toBe(10_000);
  });
});

describe('tenant isolation of stored events', () => {
  it('never returns another tenant events', async () => {
    const { ingestor, store } = makeIngestor();
    await ingestor.handleRaw(rawEvent({ variable_hopwhistle_tenant_id: 'tenant-a' }));
    await ingestor.handleRaw(
      rawEvent({ variable_hopwhistle_tenant_id: 'tenant-b', 'Event-Sequence': '99' })
    );

    const forA = await store.recentForTenant('tenant-a', 10);
    expect(forA).toHaveLength(1);
    expect(forA[0].tenantId).toBe('tenant-a');
  });
});
