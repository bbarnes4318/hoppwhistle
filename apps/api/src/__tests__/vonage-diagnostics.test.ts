import { resolveChain, type RouteRow } from '@hopwhistle/shared';
import { describe, expect, it } from 'vitest';

import {
  judgeGateway,
  judgeInboundForwarding,
  judgeVonageLeg,
  parseSofiaGatewayStatus,
} from '../services/vonage-diagnostics.js';

const SOFIA_UP = [
  '=================================================================================================',
  'Name    \tvonage',
  'Profile \texternal',
  'Scheme  \tDigest',
  'Realm   \tsip.nexmo.com',
  'Proxy   \tsip:sip.nexmo.com',
  'State   \tNOREG',
  'Status  \tUP (ping)',
  '=================================================================================================',
].join('\n');

function chainWith(over: Partial<RouteRow['steps'][number]> = {}, numberFormat: 'NANP11' | 'E164' = 'NANP11') {
  return resolveChain(
    {
      callType: 'CC_MANUAL',
      enabled: true,
      steps: [
        {
          position: 0,
          enabled: true,
          carrierCode: 'VONAGE',
          carrierName: 'Vonage',
          callerIdStrategy: 'POOL',
          callerIdPool: ['14155550100'],
          gateways: [{ name: 'vonage', priority: 0, enabled: true, numberFormat }],
          ...over,
        },
      ],
    },
    'CC_MANUAL',
    new Date(),
    { currentCallerId: '12816991120' }
  );
}

describe('Vonage diagnostics', () => {
  it('reads a loaded, pinging gateway', () => {
    const status = parseSofiaGatewayStatus(SOFIA_UP);
    expect(status).toMatchObject({ loaded: true, state: 'NOREG', status: 'UP (ping)' });
    expect(judgeGateway(status).status).toBe('pass');
  });

  it('fails a gateway FreeSWITCH never loaded', () => {
    const status = parseSofiaGatewayStatus('Invalid Gateway!');
    expect(status.loaded).toBe(false);
    expect(judgeGateway(status).status).toBe('fail');
  });

  it('warns on a gateway whose pings go unanswered', () => {
    expect(judgeGateway(parseSofiaGatewayStatus(SOFIA_UP.replace('UP (ping)', 'DOWN'))).status).toBe('warn');
  });

  it('passes a Vonage leg dialed 1XXXXXXXXXX presenting an owned number', () => {
    expect(judgeVonageLeg(chainWith(), '8005551212', ['+14155550100']).status).toBe('pass');
  });

  it('fails a Vonage leg dialed with a plus', () => {
    const r = judgeVonageLeg(chainWith({}, 'E164'), '8005551212', ['+14155550100']);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('NANP11');
  });

  it('fails a Vonage leg with no number of its own', () => {
    expect(judgeVonageLeg(chainWith({ callerIdPool: [] }), '8005551212', []).status).toBe('fail');
  });

  it('skips a waterfall Vonage is not on', () => {
    expect(judgeVonageLeg(chainWith({ enabled: false }), '8005551212', []).status).toBe('skip');
  });

  it('compares a number’s forwarding with the configured mode', () => {
    const expected = { mode: 'sip' as const, uri: 'sip:14155550100@sbc.example.com:5080' };
    expect(
      judgeInboundForwarding(
        '+14155550100',
        { voiceCallbackType: 'sip', voiceCallbackValue: expected.uri },
        expected
      ).status
    ).toBe('pass');
    expect(
      judgeInboundForwarding('+14155550100', { applicationId: 'app-1' }, expected).status
    ).toBe('fail');
    expect(judgeInboundForwarding('+14155550100', null, expected).status).toBe('fail');
  });
});
