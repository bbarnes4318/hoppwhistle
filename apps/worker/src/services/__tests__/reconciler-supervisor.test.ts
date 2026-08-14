/**
 * The reconciler's startup gate.
 *
 * Mirrors `hopper-supervisor.test.ts`. The reconciler cannot dial, but it can
 * free a lead, so it gets the same discipline: off by default, scoped when on,
 * and unable to take the rest of the worker down.
 */

import { describe, expect, it } from 'vitest';

import { HOPPER_ENV } from '../../config/hopper-gate.js';
import { RECONCILER_ENV } from '../../config/reconciliation-policy.js';
import {
  permitsReconciliation,
  ReconcilerState,
  resolveReconcilerGate,
  superviseReconciler,
  type CyclingReconciler,
  type SupervisorLog,
} from '../reconciler-supervisor.js';

const SCOPED = {
  [RECONCILER_ENV.enabled]: 'true',
  [HOPPER_ENV.tenants]: 'tenant-a',
};

function recordingLog(): SupervisorLog & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    info: r => lines.push(r),
    warn: r => lines.push(r),
    error: r => lines.push(r),
  };
}

class CountingReconciler implements CyclingReconciler {
  cycles = 0;
  lastScope: { tenantIds: readonly string[]; campaignIds: readonly string[] } | null = null;
  runOnce(scope: { tenantIds: readonly string[]; campaignIds: readonly string[] }) {
    this.cycles++;
    this.lastScope = scope;
    return Promise.resolve({ claimed: 0, released: 0, parkedForReview: 0 });
  }
}

describe('disabled by default', () => {
  it('an empty environment does not run', async () => {
    const reconciler = new CountingReconciler();
    const status = await superviseReconciler({}, reconciler, recordingLog());

    expect(status.state).toBe(ReconcilerState.DISABLED);
    expect(reconciler.cycles).toBe(0);
  });

  it('refuses a malformed switch rather than defaulting', async () => {
    const status = await superviseReconciler(
      { [RECONCILER_ENV.enabled]: 'yes' },
      new CountingReconciler(),
      recordingLog()
    );
    expect(status.state).toBe(ReconcilerState.REFUSED_CONFIGURATION);
    expect(status.detail).toContain(RECONCILER_ENV.enabled);
  });

  it('refuses enabled-without-scope', async () => {
    // "On, for everything" must not be reachable by omission.
    const reconciler = new CountingReconciler();
    const status = await superviseReconciler(
      { [RECONCILER_ENV.enabled]: 'true' },
      reconciler,
      recordingLog()
    );
    expect(status.state).toBe(ReconcilerState.REFUSED_CONFIGURATION);
    expect(status.scope.tenantIds).toEqual([]);
    expect(reconciler.cycles).toBe(0);
  });

  it('an empty allowlist is not a wildcard', () => {
    const status = resolveReconcilerGate({
      [RECONCILER_ENV.enabled]: 'true',
      [HOPPER_ENV.tenants]: ' , ,, ',
    });
    expect(status.state).toBe(ReconcilerState.REFUSED_CONFIGURATION);
  });
});

describe('enabled and scoped', () => {
  it('runs a cycle with the named scope', async () => {
    const reconciler = new CountingReconciler();
    const status = await superviseReconciler(
      { ...SCOPED, [HOPPER_ENV.campaigns]: 'camp-1,camp-2' },
      reconciler,
      recordingLog()
    );

    expect(status.state).toBe(ReconcilerState.RUNNING);
    expect(permitsReconciliation(status)).toBe(true);
    expect(reconciler.lastScope).toEqual({
      tenantIds: ['tenant-a'],
      campaignIds: ['camp-1', 'camp-2'],
    });
  });

  it('runs independently of the Hopper being enabled', async () => {
    // The attempts most needing reconciliation are the ones left behind after
    // the Hopper was turned off.
    const reconciler = new CountingReconciler();
    const status = await superviseReconciler(
      { ...SCOPED, [HOPPER_ENV.enabled]: 'false' },
      reconciler,
      recordingLog()
    );
    expect(status.state).toBe(ReconcilerState.RUNNING);
    expect(reconciler.cycles).toBe(1);
  });
});

describe('it cannot take the worker down', () => {
  it('a failing cycle reports failure rather than throwing', async () => {
    const exploding: CyclingReconciler = {
      runOnce: () => Promise.reject(new Error('postgres://user:hunter2@db/app is unreachable')),
    };
    const log = recordingLog();

    const status = await superviseReconciler(SCOPED, exploding, log);

    expect(status.state).toBe(ReconcilerState.FAILED);
    expect(status.detail).not.toContain('hunter2');
  });

  it('never logs a value read from the environment', async () => {
    const log = recordingLog();
    await superviseReconciler(
      { [RECONCILER_ENV.enabled]: 'super-secret-typo' },
      new CountingReconciler(),
      log
    );
    expect(JSON.stringify(log.lines)).not.toContain('super-secret-typo');
  });
});
