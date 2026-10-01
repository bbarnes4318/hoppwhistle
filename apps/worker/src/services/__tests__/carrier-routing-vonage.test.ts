/**
 * The predictive dialer's carrier waterfall, with Vonage in it.
 *
 * `getOutboundDialString` is what `DialerWorker.originateCall` builds its
 * originate command from. It reads the routing tables through the worker's own
 * Prisma client — the worker must not need the API up to place a call — so
 * this drives it against an in-memory stand-in for exactly the three queries
 * it issues, scoped by tenant the way Postgres would scope them.
 *
 * Nothing here opens a socket: the output is a string that is asserted on and
 * never sent.
 */

import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getOutboundDialString,
  invalidateCarrierRoutingCache,
  legOutcomeReportingEnabled,
} from '../carrier-routing.js';

interface Carrier {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: string;
  callerIdStrategy: 'PRESERVE' | 'POOL' | 'FIXED';
  callerIdNumber: string | null;
  numberProvider: string | null;
  attestation: string | null;
}

interface Gateway {
  tenantId: string;
  carrierId: string;
  name: string;
  priority: number;
  enabled: boolean;
  numberFormat: 'E164' | 'NANP11' | 'NANP10';
  techPrefix: string | null;
  circuitOpenUntil: Date | null;
  consecutiveFailures: number;
}

interface Step {
  routeKey: string;
  carrierId: string;
  position: number;
  enabled: boolean;
}

interface DidRow {
  tenantId: string;
  number: string;
  provider: string;
  status: string;
  callerIdEligible: boolean;
}

let carriers: Carrier[];
let gateways: Gateway[];
let steps: Step[];
let numbers: DidRow[];

function carrier(tenantId: string, code: string, over: Partial<Carrier> = {}): Carrier {
  const c: Carrier = {
    id: `${tenantId}-${code}`,
    tenantId,
    code,
    name: code,
    status: 'ACTIVE',
    callerIdStrategy: 'PRESERVE',
    callerIdNumber: null,
    numberProvider: code.toLowerCase(),
    attestation: null,
    ...over,
  };
  carriers.push(c);
  return c;
}

function gateway(c: Carrier, name: string, over: Partial<Gateway> = {}): void {
  gateways.push({
    tenantId: c.tenantId,
    carrierId: c.id,
    name,
    priority: 0,
    enabled: true,
    numberFormat: 'NANP11',
    techPrefix: null,
    circuitOpenUntil: null,
    consecutiveFailures: 0,
    ...over,
  });
}

/** The three reads `loadRoute` makes, honouring the tenant filter on each. */
const prisma = {
  carrierRoute: {
    findUnique: ({ where }: { where: { tenantId_callType: { tenantId: string; callType: string } } }) => {
      const { tenantId, callType } = where.tenantId_callType;
      const key = `${tenantId}:${callType}`;
      const rows = steps.filter(s => s.routeKey === key);
      if (rows.length === 0) return Promise.resolve(null);
      return Promise.resolve({
        enabled: true,
        legTimeoutSeconds: 20,
        steps: rows.map(s => ({
          ...s,
          carrier: carriers.find(c => c.id === s.carrierId && c.tenantId === tenantId)!,
        })),
      });
    },
  },
  phoneNumber: {
    findMany: ({ where }: { where: { tenantId: string; provider: { in: string[] } } }) =>
      Promise.resolve(
        numbers
          .filter(
            n =>
              n.tenantId === where.tenantId &&
              n.status === 'ACTIVE' &&
              n.callerIdEligible &&
              where.provider.in.includes(n.provider)
          )
          .map(n => ({ number: n.number, provider: n.provider }))
      ),
  },
  carrierGateway: {
    findMany: ({ where }: { where: { tenantId: string } }) =>
      Promise.resolve(gateways.filter(g => g.tenantId === where.tenantId)),
  },
} as unknown as PrismaClient;

function waterfall(tenantId: string, callType: string, order: Array<[Carrier, boolean]>): void {
  order.forEach(([c, enabled], position) =>
    steps.push({ routeKey: `${tenantId}:${callType}`, carrierId: c.id, position, enabled })
  );
}

const LEAD = '+12816991120';
const FRACTEL_CID = '+18656000126';

let tenantA: { fractel: Carrier; vonage: Carrier };

beforeEach(() => {
  carriers = [];
  gateways = [];
  steps = [];
  numbers = [];
  invalidateCarrierRoutingCache();

  const fractel = carrier('A', 'FRACTEL');
  gateway(fractel, 'fractel1');
  gateway(fractel, 'fractel2', { priority: 1 });
  const vonage = carrier('A', 'VONAGE', { callerIdStrategy: 'POOL' });
  gateway(vonage, 'vonage');
  tenantA = { fractel, vonage };

  // Tenant B has its own Vonage numbers. They must never appear on A's calls.
  const vonageB = carrier('B', 'VONAGE', { callerIdStrategy: 'POOL' });
  gateway(vonageB, 'vonage');
  waterfall('B', 'PREDICTIVE_DIALER', [[vonageB, true]]);

  numbers.push(
    { tenantId: 'A', number: '+14155550100', provider: 'vonage', status: 'ACTIVE', callerIdEligible: true },
    { tenantId: 'A', number: '+14155550101', provider: 'vonage', status: 'ACTIVE', callerIdEligible: true },
    { tenantId: 'A', number: '+14155550199', provider: 'vonage', status: 'RELEASED', callerIdEligible: true },
    { tenantId: 'B', number: '+16465550000', provider: 'vonage', status: 'ACTIVE', callerIdEligible: true }
  );
});

const originate = (tenantId = 'A') =>
  getOutboundDialString(prisma, tenantId, 'PREDICTIVE_DIALER', LEAD, {
    channelVariables: {
      origination_caller_id_number: FRACTEL_CID,
      hopwhistle_tenant_id: tenantId,
      hopwhistle_corr: 'attempt-1',
    },
    legOutcomeReporting: true,
  });

describe('predictive dialer with Vonage', () => {
  it('dials Vonage first, in its format, then the FracTEL fallback', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.vonage, true],
      [tenantA.fractel, true],
    ]);

    const { dialString, chain } = await originate();
    const legs = dialString!.split('|');

    expect(chain.carrierOrder).toEqual(['VONAGE', 'FRACTEL']);
    expect(legs[0]).toMatch(/sofia\/gateway\/vonage\/12816991120$/);
    expect(legs[1]).toMatch(/sofia\/gateway\/fractel[12]\/12816991120$/);
    expect(legs).toHaveLength(3);
  });

  it('presents one of THIS tenant’s active Vonage numbers on the Vonage leg only', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.vonage, true],
      [tenantA.fractel, true],
    ]);

    const { dialString } = await originate();
    const [vonageLeg, fractelLeg] = dialString!.split('|');

    expect(vonageLeg).toMatch(/origination_caller_id_number=1415555010[01]/);
    expect(dialString).not.toContain('6465550000'); // tenant B's
    expect(dialString).not.toContain('4155550199'); // released
    // FracTEL keeps the call's own caller ID from the {} block.
    expect(fractelLeg).not.toContain('origination_caller_id_number');
    expect(dialString).toMatch(/^\{[^}]*origination_caller_id_number=\+18656000126/);
  });

  it('dials Vonage after FracTEL when it is configured as the fallback', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.fractel, true],
      [tenantA.vonage, true],
    ]);
    const { dialString } = await originate();
    const legs = dialString!.split('|');
    expect(legs[2]).toMatch(/sofia\/gateway\/vonage\/12816991120$/);
  });

  it('rotates load across the primary carrier’s gateways without promoting Vonage', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.fractel, true],
      [tenantA.vonage, true],
    ]);
    const firsts = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const { chain } = await originate();
      firsts.add(chain.gateways[0].gateway);
      expect(chain.gateways[2].gateway).toBe('vonage');
    }
    expect(firsts).toEqual(new Set(['fractel1', 'fractel2']));
  });

  it('moves Vonage behind FracTEL while its circuit is open', async () => {
    gateways.find(g => g.tenantId === 'A' && g.name === 'vonage')!.circuitOpenUntil = new Date(
      Date.now() + 60_000
    );
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.vonage, true],
      [tenantA.fractel, true],
    ]);
    const { chain } = await originate();
    expect(chain.gateways.map(g => g.gateway).at(-1)).toBe('vonage');
    expect(chain.gateways.at(-1)!.demoted).toBe(true);
  });

  it('carries what each leg needs to report its own outcome', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.vonage, true],
      [tenantA.fractel, true],
    ]);
    const { dialString } = await originate();
    expect(dialString).toContain('api_reporting_hook=lua carrier_leg_result.lua');
    expect(dialString).toContain('hopwhistle_tenant_id=A');
    expect(dialString).toContain('hopwhistle_corr=attempt-1');
    expect(dialString).toContain('hopwhistle_gateway=vonage');
  });

  it('leaves a disabled Vonage step out entirely — the catalog default', async () => {
    waterfall('A', 'PREDICTIVE_DIALER', [
      [tenantA.fractel, true],
      [tenantA.vonage, false],
    ]);
    const { chain } = await originate();
    expect(chain.gateways.map(g => g.gateway)).not.toContain('vonage');
  });

  it('never resolves one tenant’s waterfall from another’s', async () => {
    const { chain } = await originate('B');
    expect(chain.carrierOrder).toEqual(['VONAGE']);
    expect(chain.gateways[0].callerId).toBe('16465550000');
  });
});

describe('leg outcome reporting switch', () => {
  it('is on by default and can be switched off', () => {
    const saved = process.env.CARRIER_LEG_REPORTING;
    delete process.env.CARRIER_LEG_REPORTING;
    expect(legOutcomeReportingEnabled()).toBe(true);
    process.env.CARRIER_LEG_REPORTING = 'off';
    expect(legOutcomeReportingEnabled()).toBe(false);
    if (saved === undefined) delete process.env.CARRIER_LEG_REPORTING;
    else process.env.CARRIER_LEG_REPORTING = saved;
  });
});
