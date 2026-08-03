/**
 * The Hopper supervisor — the one place the legacy Hopper may be started.
 *
 * The fake below records every `start` call. Nothing here constructs a
 * FreeSWITCH connection, a Prisma client, or a socket.
 */

import { describe, expect, it } from 'vitest';

import { HOPPER_ENV, HopperState } from '../../config/hopper-gate.js';
import {
  superviseLegacyHopper,
  type StartableHopper,
  type SupervisorLog,
} from '../hopper-supervisor.js';

function fakeHopper(over: { start?: StartableHopper['start'] } = {}) {
  const calls: Array<Parameters<StartableHopper['start']>[0]> = [];
  const hopper: StartableHopper = {
    start:
      over.start ??
      (options => {
        calls.push(options);
        return Promise.resolve();
      }),
  };
  return { hopper, calls };
}

function fakeLog(): SupervisorLog & { records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  return {
    records,
    info: r => records.push({ level: 'info', ...r }),
    warn: r => records.push({ level: 'warn', ...r }),
    error: r => records.push({ level: 'error', ...r }),
  };
}

const ENABLED = {
  [HOPPER_ENV.enabled]: 'true',
  [HOPPER_ENV.tenants]: 'tenant-a',
  VITEST: 'true',
  [HOPPER_ENV.testAuthorized]: 'true',
};

describe('1 and 20. the Hopper does not start without authorization', () => {
  it('never calls start with no configuration', async () => {
    const { hopper, calls } = fakeHopper();
    const status = await superviseLegacyHopper({}, hopper, fakeLog());

    expect(calls).toHaveLength(0);
    expect(status.state).toBe(HopperState.DISABLED);
  });

  it('never calls start under a bare test runner, which is what CI is', async () => {
    // Test 20: the Hopper must not start in CI. Running the suite sets VITEST,
    // and without explicit authorization that alone refuses.
    const { hopper, calls } = fakeHopper();
    const status = await superviseLegacyHopper(
      { [HOPPER_ENV.enabled]: 'true', [HOPPER_ENV.tenants]: 'tenant-a', VITEST: 'true' },
      hopper,
      fakeLog()
    );

    expect(calls).toHaveLength(0);
    expect(status.state).toBe(HopperState.REFUSED_CONFIGURATION);
  });

  it('never calls start when the emergency stop is engaged', async () => {
    const { hopper, calls } = fakeHopper();
    await superviseLegacyHopper(
      { ...ENABLED, [HOPPER_ENV.emergencyStop]: 'true' },
      hopper,
      fakeLog()
    );
    expect(calls).toHaveLength(0);
  });

  it('logs exactly one sanitized line when it declines', async () => {
    const log = fakeLog();
    const { hopper } = fakeHopper();
    await superviseLegacyHopper({ [HOPPER_ENV.enabled]: 'not-a-boolean' }, hopper, log);

    expect(log.records).toHaveLength(1);
    expect(log.records[0].level).toBe('warn');
    // Names the variable, never the value it found.
    expect(JSON.stringify(log.records[0])).toContain(HOPPER_ENV.enabled);
    expect(JSON.stringify(log.records[0])).not.toContain('not-a-boolean');
  });
});

describe('the scope reaches the worker intact', () => {
  it('passes the resolved allowlist and the origination interlock', async () => {
    const { hopper, calls } = fakeHopper();
    const status = await superviseLegacyHopper(
      {
        ...ENABLED,
        [HOPPER_ENV.tenants]: 'tenant-a,tenant-b',
        [HOPPER_ENV.campaigns]: 'camp-1',
      },
      hopper,
      fakeLog()
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].scope.tenantIds).toEqual(['tenant-a', 'tenant-b']);
    expect(calls[0].scope.campaignIds).toEqual(['camp-1']);
    expect(status.state).toBe(HopperState.RUNNING);
  });

  it('21. starts with origination off unless its own switch says otherwise', async () => {
    const { hopper, calls } = fakeHopper();
    await superviseLegacyHopper(ENABLED, hopper, fakeLog());
    expect(calls[0].originationEnabled).toBe(false);

    const second = fakeHopper();
    await superviseLegacyHopper(
      { ...ENABLED, [HOPPER_ENV.origination]: 'true' },
      second.hopper,
      fakeLog()
    );
    expect(second.calls[0].originationEnabled).toBe(true);
  });
});

describe('12. a failing Hopper does not take the rest of the worker down', () => {
  it('never throws, so main() continues to the other services', async () => {
    // Billing, the ClickHouse ETL and industry research are unrelated and ran
    // fine before the Hopper had a gate. A dialer failing is not a reason to
    // stop invoicing people.
    const { hopper } = fakeHopper({ start: () => Promise.reject(new Error('ESL unreachable')) });
    const log = fakeLog();

    const status = await superviseLegacyHopper(ENABLED, hopper, log);

    expect(status.state).toBe(HopperState.FAILED);
    expect(log.records.some(r => r.level === 'error')).toBe(true);
  });

  it('reports failed rather than running when start rejects', async () => {
    const { hopper } = fakeHopper({ start: () => Promise.reject(new Error('boom')) });
    const status = await superviseLegacyHopper(ENABLED, hopper, fakeLog());
    expect(status.state).not.toBe(HopperState.RUNNING);
  });
});

describe('11. the reported status distinguishes the cases', () => {
  it('gives disabled, refused, running and failed distinct states', async () => {
    const disabled = await superviseLegacyHopper({}, fakeHopper().hopper, fakeLog());
    const refused = await superviseLegacyHopper(
      { [HOPPER_ENV.enabled]: 'true', VITEST: 'true', [HOPPER_ENV.testAuthorized]: 'true' },
      fakeHopper().hopper,
      fakeLog()
    );
    const running = await superviseLegacyHopper(ENABLED, fakeHopper().hopper, fakeLog());
    const failed = await superviseLegacyHopper(
      ENABLED,
      fakeHopper({ start: () => Promise.reject(new Error('x')) }).hopper,
      fakeLog()
    );

    expect(disabled.state).toBe(HopperState.DISABLED);
    expect(refused.state).toBe(HopperState.REFUSED_CONFIGURATION);
    expect(running.state).toBe(HopperState.RUNNING);
    expect(failed.state).toBe(HopperState.FAILED);
    expect(new Set([disabled.state, refused.state, running.state, failed.state]).size).toBe(4);
  });

  it('only reports running after start actually resolved', async () => {
    let resolved = false;
    const { hopper } = fakeHopper({
      start: async () => {
        await Promise.resolve();
        resolved = true;
      },
    });
    const status = await superviseLegacyHopper(ENABLED, hopper, fakeLog());
    expect(resolved).toBe(true);
    expect(status.state).toBe(HopperState.RUNNING);
  });
});
