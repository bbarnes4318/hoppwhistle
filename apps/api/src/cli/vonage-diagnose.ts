/**
 * Vonage end-to-end diagnostic — opt-in, read-only unless told otherwise.
 *
 *   pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <tenantId>
 *   pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <id> --dest 8005551212
 *   pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <id> --check-numbers
 *   pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <id> --test-call 1NXXNXXXXXX --yes
 *
 * Checks, in order:
 *   1. FreeSWITCH has loaded `sofia/gateway/vonage`, and its OPTIONS pings are answered.
 *   2. Every outbound waterfall that has Vonage enabled dials it as 1XXXXXXXXXX and
 *      presents one of this tenant's own Vonage numbers.
 *   3. This tenant's Vonage DIDs exist, are ACTIVE and have an inbound route.
 *   4. (--check-numbers) Each of those DIDs forwards, at Vonage, to where the
 *      configured routing mode says it should. Needs VONAGE_API_KEY/SECRET.
 *   5. Recent calls attributed to the vonage gateway (calls.metadata.carrier).
 *   6. (--test-call N --yes) Places ONE real call to N through the vonage
 *      gateway only, hangs up on answer, and prints the result. Costs money and
 *      rings a phone, which is why it needs both flags.
 *
 * Nothing here runs in CI: it needs a real FreeSWITCH and real credentials.
 */

import {
  CALL_ROUTE_TYPES,
  formatForGateway,
  normalizeNanp,
  type CallRouteType,
} from '@hopwhistle/shared';

import { getPrismaClient } from '../lib/prisma.js';
import { getCarrierChain } from '../services/carrier-routing.js';
import { freeswitchService } from '../services/freeswitch-service.js';
import {
  VonageAdapter,
  renderVonageSipUri,
} from '../services/provisioning/adapters/vonage-adapter.js';
import {
  formatReport,
  judgeGateway,
  judgeInboundForwarding,
  judgeVonageLeg,
  parseSofiaGatewayStatus,
  type CheckResult,
} from '../services/vonage-diagnostics.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const tenantId = arg('tenant');
  if (!tenantId) {
    console.error('usage: vonage-diagnose --tenant <tenantId> [--dest N] [--check-numbers] [--test-call N --yes]');
    process.exit(2);
  }
  const destination = arg('dest') ?? '8005551212';
  const prisma = getPrismaClient();
  const results: CheckResult[] = [];

  // 1. Gateway
  try {
    const out = await withTimeout(
      freeswitchService.executeApi('sofia', 'status gateway vonage'),
      5_000,
      'ESL'
    );
    results.push(judgeGateway(parseSofiaGatewayStatus(out)));
  } catch (error) {
    const message = (error as Error).message;
    results.push(
      /invalid gateway/i.test(message)
        ? judgeGateway(parseSofiaGatewayStatus(message))
        : { name: 'FreeSWITCH reachable over ESL', status: 'fail', detail: message }
    );
  }

  // 2. Outbound waterfalls
  const vonageNumbers = await prisma.phoneNumber.findMany({
    where: { tenantId, provider: 'vonage' },
    select: { id: true, number: true, status: true, callerIdEligible: true },
    orderBy: { number: 'asc' },
  });
  const eligible = vonageNumbers
    .filter(n => n.status === 'ACTIVE' && n.callerIdEligible)
    .map(n => n.number);

  for (const callType of CALL_ROUTE_TYPES as readonly CallRouteType[]) {
    if (callType === 'INBOUND') continue;
    const chain = await getCarrierChain(tenantId, callType, eligible[0] ?? null);
    results.push(judgeVonageLeg(chain, destination, eligible));
  }

  // 3. Inbound DIDs
  if (vonageNumbers.length === 0) {
    results.push({
      name: 'Vonage DIDs on this account',
      status: 'warn',
      detail: 'None. Buy or import Vonage numbers (provider "vonage") to receive calls and to present caller ID.',
    });
  }
  for (const n of vonageNumbers) {
    const route = await prisma.didRoute.findFirst({
      where: { tenantId, phoneNumberId: n.id },
      select: { id: true },
    });
    results.push({
      name: `Vonage DID ${n.number}`,
      status: n.status === 'ACTIVE' && route ? 'pass' : 'warn',
      detail: `status=${n.status} callerIdEligible=${n.callerIdEligible} inboundRoute=${route ? route.id : 'NONE — calls to it will be rejected'}`,
    });
  }

  // 4. Vonage-side forwarding
  if (flag('check-numbers')) {
    const adapter = new VonageAdapter();
    const routing = adapter.routing();
    if (!adapter.isConfigured()) {
      results.push({ name: 'Vonage Numbers API', status: 'skip', detail: 'VONAGE_API_KEY/SECRET not set' });
    } else if (!routing.ok) {
      results.push({ name: 'Vonage number routing mode', status: 'fail', detail: routing.reason });
    } else {
      for (const n of vonageNumbers) {
        const msisdn = n.number.replace(/\D/g, '');
        const owned = await adapter.getNumber(msisdn).catch(() => null);
        const meta = (owned?.metadata ?? {}) as Record<string, string | undefined>;
        results.push(
          judgeInboundForwarding(
            n.number,
            owned ? meta : null,
            routing.mode === 'sip'
              ? { mode: 'sip', uri: renderVonageSipUri(routing.sipUri, msisdn) }
              : { mode: 'application', applicationId: routing.applicationId }
          )
        );
      }
    }
  }

  // 5. CDR attribution
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const attributed = await prisma.call.count({
    where: {
      tenantId,
      createdAt: { gte: since },
      metadata: { path: ['carrier', 'gateway'], equals: 'vonage' },
    },
  });
  results.push({
    name: 'Calls connected through the vonage gateway (7 days)',
    status: attributed > 0 ? 'pass' : 'skip',
    detail: `${attributed} call(s) carry calls.metadata.carrier.gateway = "vonage"`,
  });

  // 6. Opt-in live call
  const testCall = arg('test-call');
  if (testCall) {
    const ten = normalizeNanp(testCall);
    if (!flag('yes')) {
      results.push({ name: 'Live test call', status: 'skip', detail: 'Add --yes to place a real call.' });
    } else if (!ten || eligible.length === 0) {
      results.push({
        name: 'Live test call',
        status: 'fail',
        detail: !ten ? `${testCall} is not a NANP number` : 'No Vonage caller ID to present',
      });
    } else {
      const cid = eligible[0].replace(/\D/g, '').replace(/^(\d{10})$/, '1$1');
      const dial = `{origination_caller_id_number=${cid},sip_from_user=${cid},progress_timeout=10,call_timeout=30,hopwhistle_carrier=VONAGE}sofia/gateway/vonage/${formatForGateway(ten, 'NANP11')}`;
      try {
        const out = await withTimeout(
          freeswitchService.executeApi('originate', `${dial} &hangup(NORMAL_CLEARING)`),
          45_000,
          'originate'
        );
        results.push({ name: 'Live test call', status: 'pass', detail: `answered: ${out}` });
      } catch (error) {
        results.push({ name: 'Live test call', status: 'fail', detail: (error as Error).message });
      }
    }
  }

  console.log(formatReport(results));
  await prisma.$disconnect();
  process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
