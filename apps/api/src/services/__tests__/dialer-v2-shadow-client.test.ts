import { describe, expect, it, vi } from 'vitest';

import { DialerV2ShadowClient, mapStatus, unreachableStatus } from '../dialer-v2-shadow-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const healthDoc = {
  ingestionHealthy: true,
  emergencyStop: false,
  shadowEnabled: true,
  originationPermitted: false,
  originationImplemented: false,
  checks: [
    { name: 'freeswitch_esl', status: 'pass' },
    { name: 'stale_agents', status: 'warn', detail: '4 of 10 agent(s) are stale and excluded' },
    { name: 'unresolved_events', status: 'warn', detail: '7 event(s) quarantined' },
  ],
};

describe('unreachable service', () => {
  it('is reported honestly rather than as healthy', async () => {
    const client = new DialerV2ShadowClient({
      baseUrl: 'http://dialer-v2:9092',
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });

    const status = await client.getStatus();
    expect(status.serviceReachable).toBe(false);
    expect(status.ingestionHealthy).toBe(false);
    expect(status.eslConnected).toBe(false);
    expect(status.serviceDetail).toContain('did not respond');
  });

  it('returns no decisions rather than fabricating any', async () => {
    const client = new DialerV2ShadowClient({
      baseUrl: 'http://dialer-v2:9092',
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });
    expect(await client.getDecisions('t1', 10)).toEqual([]);
  });

  it('never claims origination is permitted when unreachable', () => {
    const status = unreachableStatus('down');
    expect(status.originationPermitted).toBe(false);
    expect(status.shadowEnabled).toBe(false);
  });
});

describe('status mapping', () => {
  it('extracts counts from the health document', () => {
    const status = mapStatus(healthDoc, { lastEventAgeMs: 250 });
    expect(status.serviceReachable).toBe(true);
    expect(status.ingestionHealthy).toBe(true);
    expect(status.staleAgentCount).toBe(4);
    expect(status.unresolvedEventCount).toBe(7);
    expect(status.lastEventAgeMs).toBe(250);
  });

  it('treats a failing ESL check as disconnected', () => {
    const status = mapStatus(
      { ...healthDoc, checks: [{ name: 'freeswitch_esl', status: 'fail', detail: 'down' }] },
      {}
    );
    expect(status.eslConnected).toBe(false);
  });

  it('treats a degraded ESL check as connected but reports the detail', () => {
    const status = mapStatus(
      {
        ...healthDoc,
        checks: [{ name: 'freeswitch_esl', status: 'warn', detail: 'connected but degraded' }],
      },
      {}
    );
    expect(status.eslConnected).toBe(true);
    expect(status.eslDetail).toContain('degraded');
  });

  it('tolerates a health document with no checks', () => {
    expect(() => mapStatus({}, {})).not.toThrow();
    expect(mapStatus({}, {}).staleAgentCount).toBe(0);
  });

  it('accepts a 503 body, since not-ready still carries the document', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.includes('/health') ? jsonResponse(healthDoc, 503) : jsonResponse({ lastEventAgeMs: 5 })
      )
    ) as unknown as typeof fetch;

    const client = new DialerV2ShadowClient({ baseUrl: 'http://x', fetchImpl });
    const status = await client.getStatus();
    expect(status.serviceReachable).toBe(true);
  });
});

describe('decisions', () => {
  function clientReturning(decisions: unknown[]) {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ decisions }))
    ) as unknown as typeof fetch;
    return { client: new DialerV2ShadowClient({ baseUrl: 'http://x', fetchImpl }), fetchImpl };
  }

  const sample = {
    campaignId: 'camp-1',
    decidedAtMs: 1,
    controllerVersion: '1.1.0',
    recommendedOriginateCount: 7,
    bindingConstraint: 'AGENT_CAPACITY',
    degradationMode: 'PREDICTIVE',
    safetyReasons: [],
    blockedBy: [],
    originated: false,
    explanation: 'would place 7 calls',
    agentsAvailable: 5,
    agentsEligible: 20,
    callsDialing: 2,
    liveAnswersWaiting: 0,
    abandonRate: 0.01,
    pLive: 0.2,
    confidence: 'HIGH',
  };

  it('passes the verified tenant through as a query parameter', async () => {
    const { client, fetchImpl } = clientReturning([sample]);
    await client.getDecisions('tenant-a', 25, 'camp-1');

    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('tenantId=tenant-a');
    expect(url).toContain('limit=25');
    expect(url).toContain('campaignId=camp-1');
  });

  it('issues only GET requests', async () => {
    const { client, fetchImpl } = clientReturning([sample]);
    await client.getDecisions('tenant-a', 10);
    await client.getStatus();

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    for (const [, init] of calls) {
      expect((init as RequestInit | undefined)?.method).toBe('GET');
    }
  });

  it('drops any record claiming a call was originated', async () => {
    // Shadow mode cannot originate. A record saying otherwise is corrupt and
    // must never reach a supervisor screen.
    const { client } = clientReturning([sample, { ...sample, originated: true }]);
    const decisions = await client.getDecisions('tenant-a', 10);
    expect(decisions).toHaveLength(1);
    expect(decisions.every(d => d.originated === false)).toBe(true);
  });

  it('returns an empty list for a malformed body rather than throwing', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ nonsense: true }))
    ) as unknown as typeof fetch;
    const client = new DialerV2ShadowClient({ baseUrl: 'http://x', fetchImpl });
    expect(await client.getDecisions('t1', 10)).toEqual([]);
  });

  it('URL-encodes a tenant id so it cannot forge extra parameters', async () => {
    const { client, fetchImpl } = clientReturning([]);
    await client.getDecisions('tenant&limit=9999', 10);
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('tenantId=tenant%26limit%3D9999');
    expect(url).toContain('limit=10');
  });
});
