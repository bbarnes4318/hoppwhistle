import { describe, expect, it } from 'vitest';

import {
  EVENT_VERSION,
  TelephonyEventType,
  type NormalizedTelephonyEvent,
} from '../events/types.js';

import { CallPhase, ObservationCollector } from './collector.js';

const T0 = 1_800_000_000_000;

function event(
  type: TelephonyEventType,
  overrides: Partial<NormalizedTelephonyEvent> = {}
): NormalizedTelephonyEvent {
  return {
    eventId: `${type}-${overrides.channelUuid ?? 'chan-1'}-${overrides.occurredAt ?? T0}`,
    eventType: type,
    eventVersion: EVENT_VERSION,
    occurredAt: T0,
    receivedAt: T0,
    tenantId: 'tenant-a',
    campaignId: 'camp-1',
    leadId: 'lead-1',
    attemptId: null,
    callId: null,
    agentId: null,
    channelUuid: 'chan-1',
    otherLegUuid: null,
    callerNumber: '+18656000124',
    destinationNumber: '+18005551212',
    gateway: 'fractel1',
    answerState: 'unknown',
    hangupCause: null,
    rawEventName: type,
    rawEventSubclass: null,
    dialerVersion: 1,
    ...overrides,
  };
}

function collector(nowRef = { value: T0 }) {
  return {
    nowRef,
    c: new ObservationCollector({ now: () => nowRef.value, assignmentDeadlineMs: 2_000 }),
  };
}

describe('call lifecycle', () => {
  it('tracks a full answered and bridged call', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_PROGRESS, { occurredAt: T0 + 1_000 }));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 5_000 }));
    c.apply(event(TelephonyEventType.CHANNEL_BRIDGE, { occurredAt: T0 + 6_000 }));

    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.callsBridged).toBe(1);
    expect(obs.attempts).toBe(1);
    expect(obs.liveAnswers).toBe(1);
    expect(obs.meanAnswerLatencyMs).toBe(5_000);
    expect(obs.meanBridgeLatencyMs).toBe(1_000);
    expect(obs.liveAnswersWaiting).toBe(0);
  });

  it('counts an answered-but-unbridged call as a live answer waiting', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 4_000 }));

    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.liveAnswersWaiting).toBe(1);
    expect(obs.callsInFlight).toBe(1);
  });

  it('flags a live answer that has waited past the assignment deadline', () => {
    const nowRef = { value: T0 };
    const { c } = collector(nowRef);
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER));

    expect(c.observe('tenant-a', 'camp-1').liveAnswersOverdue).toBe(0);
    nowRef.value = T0 + 3_000;
    expect(c.observe('tenant-a', 'camp-1').liveAnswersOverdue).toBe(1);
  });

  it('records an abandoned call: answered by a human, never reached an agent', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 3_000 }));
    c.apply(
      event(TelephonyEventType.CHANNEL_HANGUP, {
        occurredAt: T0 + 9_000,
        hangupCause: 'NORMAL_CLEARING',
      })
    );

    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.abandonedCount).toBe(1);
    // Compliance definition: abandoned ÷ live-answered.
    expect(obs.abandonRate).toBe(1);
    expect(obs.abandonSampleSize).toBe(1);
  });

  it('does not count a bridged call as abandoned', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 3_000 }));
    c.apply(event(TelephonyEventType.CHANNEL_BRIDGE, { occurredAt: T0 + 3_500 }));
    c.apply(
      event(TelephonyEventType.CHANNEL_HANGUP, {
        occurredAt: T0 + 90_000,
        hangupCause: 'NORMAL_CLEARING',
      })
    );
    expect(c.observe('tenant-a', 'camp-1').abandonedCount).toBe(0);
  });

  it('classifies unanswered outcomes by hangup cause', () => {
    const { c } = collector();
    const cases: Array<[string, string]> = [
      ['chan-busy', 'USER_BUSY'],
      ['chan-noans', 'NO_ANSWER'],
      ['chan-fail', 'NETWORK_OUT_OF_ORDER'],
    ];
    for (const [uuid, cause] of cases) {
      c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: uuid }));
      c.apply(
        event(TelephonyEventType.CHANNEL_HANGUP, {
          channelUuid: uuid,
          occurredAt: T0 + 15_000,
          hangupCause: cause,
        })
      );
    }

    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.attempts).toBe(3);
    expect(obs.busyRate).toBeCloseTo(1 / 3, 5);
    expect(obs.noAnswerRate).toBeCloseTo(1 / 3, 5);
    expect(obs.failureRate).toBeCloseTo(1 / 3, 5);
    expect(obs.hangupCauses.USER_BUSY).toBe(1);
  });
});

describe('resilience to imperfect event streams', () => {
  it('ignores an event that would move a call backwards', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER));
    c.apply(event(TelephonyEventType.CHANNEL_PROGRESS, { occurredAt: T0 + 100 }));

    expect(c.metrics().ignoredOutOfOrder).toBe(1);
    expect(c.observe('tenant-a', 'camp-1').callsAnswered).toBe(1);
  });

  it('treats a bridge with no prior answer as proof of answer, and counts the gap', () => {
    // The ANSWER was lost or arrived late. Discarding the bridge would
    // under-count live answers and inflate the apparent answer latency.
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_BRIDGE, { occurredAt: T0 + 7_000 }));

    expect(c.metrics().orphanBridges).toBe(1);
    expect(c.observe('tenant-a', 'camp-1').liveAnswers).toBe(1);
  });

  it('handles hangup before any answer', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(
      event(TelephonyEventType.CHANNEL_HANGUP, {
        occurredAt: T0 + 15_000,
        hangupCause: 'NO_ANSWER',
      })
    );
    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.abandonedCount).toBe(0);
    expect(obs.callsCompleted).toBe(1);
  });

  it('does not double-count when the same event is applied twice', () => {
    // The ingestor dedupes, but the collector must be idempotent-safe too.
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 3_000 }));
    c.apply(event(TelephonyEventType.CHANNEL_ANSWER, { occurredAt: T0 + 3_000 }));

    const obs = c.observe('tenant-a', 'camp-1');
    expect(obs.attempts).toBe(1);
    expect(obs.liveAnswers).toBe(1);
  });

  it('ignores an event with no channel uuid', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.DTMF, { channelUuid: null }));
    expect(c.metrics().trackedCalls).toBe(0);
  });

  it('reaps calls that have gone silent', () => {
    const nowRef = { value: T0 };
    const { c } = collector(nowRef);
    c.apply(event(TelephonyEventType.CHANNEL_CREATE));
    expect(c.metrics().trackedCalls).toBe(1);

    nowRef.value = T0 + 60 * 60 * 1000;
    expect(c.reap()).toBe(1);
    expect(c.metrics().trackedCalls).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('never merges two tenants', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { tenantId: 'tenant-a', channelUuid: 'a1' }));
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { tenantId: 'tenant-b', channelUuid: 'b1' }));

    expect(c.observe('tenant-a', 'camp-1').attempts).toBe(1);
    expect(c.observe('tenant-b', 'camp-1').attempts).toBe(1);
    expect(c.observe('tenant-a', 'camp-1').callsInFlight).toBe(1);
  });

  it('refuses to re-attribute a channel to a different tenant', () => {
    // A correlation bug must not silently move a live call between tenants.
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { tenantId: 'tenant-a' }));
    c.apply(
      event(TelephonyEventType.CHANNEL_ANSWER, { tenantId: 'tenant-b', occurredAt: T0 + 1_000 })
    );

    expect(c.observe('tenant-b', 'camp-1').callsAnswered).toBe(0);
    expect(c.observe('tenant-a', 'camp-1').callsCreated).toBe(1);
  });

  it('refuses an event with no tenant', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { tenantId: '' }));
    expect(c.metrics().trackedCalls).toBe(0);
    expect(c.metrics().processedEvents).toBe(0);
  });

  it('keeps uncampaigned traffic separate rather than merging it', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { campaignId: null, channelUuid: 'x' }));
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { campaignId: 'camp-1', channelUuid: 'y' }));

    expect(c.observe('tenant-a', 'camp-1').attempts).toBe(1);
    expect(c.observe('tenant-a', '(none)').attempts).toBe(1);
  });
});

describe('reconciliation inputs', () => {
  it('reports live channels and drops completed ones', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'live-1' }));
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'done-1' }));
    c.apply(
      event(TelephonyEventType.CHANNEL_HANGUP, { channelUuid: 'done-1', occurredAt: T0 + 5_000 })
    );

    const live = c.liveChannelUuids();
    expect(live.has('live-1')).toBe(true);
    expect(live.has('done-1')).toBe(false);
  });

  it('maps live channels to their owning agent', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'c1', agentId: 'agent-7' }));
    expect(c.channelOwners().get('c1')).toBe('agent-7');
  });

  it('omits an agent owner once the channel completes', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'c1', agentId: 'agent-7' }));
    c.apply(
      event(TelephonyEventType.CHANNEL_HANGUP, { channelUuid: 'c1', occurredAt: T0 + 1_000 })
    );
    expect(c.channelOwners().has('c1')).toBe(false);
  });
});

describe('active scopes', () => {
  it('lists every observed tenant and campaign', () => {
    const { c } = collector();
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'a', campaignId: 'camp-1' }));
    c.apply(event(TelephonyEventType.CHANNEL_CREATE, { channelUuid: 'b', campaignId: 'camp-2' }));
    c.apply(
      event(TelephonyEventType.CHANNEL_CREATE, {
        channelUuid: 'c',
        tenantId: 'tenant-b',
        campaignId: 'camp-3',
      })
    );

    const scopes = c.activeScopes();
    expect(scopes).toHaveLength(3);
    expect(scopes).toContainEqual({ tenantId: 'tenant-a', campaignId: 'camp-1' });
    expect(scopes).toContainEqual({ tenantId: 'tenant-b', campaignId: 'camp-3' });
  });
});

describe('phase enum', () => {
  it('exposes the documented lifecycle', () => {
    expect(Object.values(CallPhase)).toContain('ANSWERED');
    expect(Object.values(CallPhase)).toContain('BRIDGED');
    expect(Object.values(CallPhase)).toContain('COMPLETED');
  });
});
