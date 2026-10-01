/**
 * Vonage end-to-end diagnostics — the pure parts.
 *
 * The CLI in `cli/vonage-diagnose.ts` gathers facts from FreeSWITCH, the
 * database and (optionally) the Vonage Numbers API; the judgements about those
 * facts live here so they can be tested without any of the three.
 */

import { formatForGateway, normalizeNanp, type ResolvedChain } from '@hopwhistle/shared';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface SofiaGatewayStatus {
  loaded: boolean;
  /** Registration state, e.g. NOREG for an unregistered trunk (expected here). */
  state: string | null;
  /** UP / DOWN, from OPTIONS pings when `ping` is configured. */
  status: string | null;
  proxy: string | null;
}

/**
 * Read `sofia status gateway <name>` output.
 *
 * FreeSWITCH prints tab-separated `Key \t value` lines for a known gateway and
 * "Invalid Gateway!" for one it has not loaded — which, for `vonage`, is what
 * a partial credential pair in the environment produces by design.
 */
export function parseSofiaGatewayStatus(output: string): SofiaGatewayStatus {
  const text = output ?? '';
  if (/invalid gateway/i.test(text) || !/\bName\b/.test(text)) {
    return { loaded: false, state: null, status: null, proxy: null };
  }
  const field = (key: string): string | null => {
    const match = new RegExp(`^\\s*${key}\\s+(.+?)\\s*$`, 'mi').exec(text);
    return match ? match[1].trim() : null;
  };
  return { loaded: true, state: field('State'), status: field('Status'), proxy: field('Proxy') };
}

export function judgeGateway(status: SofiaGatewayStatus): CheckResult {
  if (!status.loaded) {
    return {
      name: 'FreeSWITCH has loaded sofia/gateway/vonage',
      status: 'fail',
      detail:
        'Gateway not loaded. Check the FreeSWITCH start-up log for "Vonage SIP trunk" — a ' +
        'username without a password (or the reverse) leaves it unloaded on purpose.',
    };
  }
  const up = (status.status ?? '').toUpperCase().startsWith('UP');
  return {
    name: 'FreeSWITCH has loaded sofia/gateway/vonage',
    status: up ? 'pass' : 'warn',
    detail: `state=${status.state ?? '?'} status=${status.status ?? '?'} proxy=${status.proxy ?? '?'}${
      up ? '' : ' — OPTIONS pings are not being answered; check the proxy and the IP allow-list'
    }`,
  };
}

/**
 * Whether a resolved chain dials Vonage, and dials it correctly.
 *
 * Correct means: the leg's destination is international digits with no `+`
 * (Vonage rejects a `+`), and the caller ID it will present is one of this
 * tenant's own Vonage numbers rather than another carrier's DID, which Vonage
 * would refuse.
 */
export function judgeVonageLeg(
  chain: ResolvedChain,
  destination: string,
  vonageNumbers: string[]
): CheckResult {
  const name = `${chain.callType}: Vonage leg`;
  const leg = chain.gateways.find(g => g.carrierCode === 'VONAGE');
  if (!leg) {
    return {
      name,
      status: 'skip',
      detail: `Vonage is not enabled on this waterfall (now dialing: ${
        chain.carrierOrder.join(' → ') || 'nothing'
      })`,
    };
  }

  const tenDigits = normalizeNanp(destination);
  const dialed = tenDigits ? formatForGateway(tenDigits, leg.numberFormat, leg.techPrefix) : '';
  if (!/^1\d{10}$/.test(dialed)) {
    return {
      name,
      status: 'fail',
      detail: `Vonage would be dialed as "${dialed}"; it accepts 1XXXXXXXXXX only. Set the vonage gateway's format to NANP11.`,
    };
  }

  const position = chain.gateways.indexOf(leg) + 1;
  const owned = new Set(vonageNumbers.map(n => n.replace(/\D/g, '').slice(-10)));
  const presented = (leg.callerId ?? '').replace(/\D/g, '').slice(-10);

  if (leg.callerIdUnavailable) {
    return {
      name,
      status: 'fail',
      detail: `Leg ${position} dials ${dialed}, but this account has no ACTIVE caller-ID-eligible Vonage number; Vonage will refuse the caller ID.`,
    };
  }
  if (!leg.callerId) {
    return {
      name,
      status: 'pass',
      detail: `Leg ${position} dials ${dialed} and keeps the call's own caller ID (already a Vonage number, or the carrier is set to keep it).`,
    };
  }
  if (!owned.has(presented)) {
    return {
      name,
      status: 'fail',
      detail: `Leg ${position} would present ${leg.callerId}, which is not one of this account's Vonage numbers.`,
    };
  }
  return {
    name,
    status: 'pass',
    detail: `Leg ${position} of ${chain.gateways.length} dials sofia/gateway/${leg.gateway}/${dialed} presenting ${leg.callerId}${
      leg.demoted ? ' (currently demoted: circuit open)' : ''
    }`,
  };
}

/** Whether a number's Vonage-side forwarding matches what this platform expects. */
export function judgeInboundForwarding(
  number: string,
  actual: { voiceCallbackType?: string; voiceCallbackValue?: string; applicationId?: string } | null,
  expected: { mode: 'sip'; uri: string } | { mode: 'application'; applicationId: string }
): CheckResult {
  const name = `Inbound forwarding for ${number}`;
  if (!actual) {
    return { name, status: 'fail', detail: 'The Vonage account does not hold this number.' };
  }
  if (expected.mode === 'sip') {
    if (actual.voiceCallbackType === 'sip' && actual.voiceCallbackValue === expected.uri) {
      return {
        name,
        status: actual.applicationId ? 'warn' : 'pass',
        detail: actual.applicationId
          ? `Forwards to ${expected.uri}, but is still linked to application ${actual.applicationId}; unlink it.`
          : `Forwards to ${expected.uri}`,
      };
    }
    return {
      name,
      status: 'fail',
      detail: `Forwards to ${actual.voiceCallbackType ?? 'nothing'}:${
        actual.voiceCallbackValue ?? actual.applicationId ?? ''
      }, expected sip:${expected.uri}. Re-point it from the Numbers page or the Vonage dashboard.`,
    };
  }
  return actual.applicationId === expected.applicationId
    ? { name, status: 'pass', detail: `Attached to application ${expected.applicationId}` }
    : {
        name,
        status: 'fail',
        detail: `Attached to ${actual.applicationId ?? 'no application'}, expected ${expected.applicationId}`,
      };
}

export function formatReport(results: CheckResult[]): string {
  const mark: Record<CheckStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
  return results.map(r => `[${mark[r.status]}] ${r.name}\n       ${r.detail}`).join('\n');
}
