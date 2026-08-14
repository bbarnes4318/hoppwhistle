/**
 * The reconciler, against fakes.
 *
 * The store and the FreeSWITCH port are both injected, so these tests exercise
 * the orchestration — what is asked, in what order, what is written, and what is
 * refused — without a database or a socket. The transactional claims are proved
 * separately, against real PostgreSQL, in `reconciliation.live.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLICY,
  type ReconciliationPolicy,
} from '../../config/reconciliation-policy.js';
import { AttemptReconciler, type AttemptLedger } from '../attempt-reconciler.js';
import {
  UnavailableFreeSwitchPort,
  type LookupResult,
  type ReadOnlyFreeSwitchPort,
} from '../freeswitch-readonly.js';
import { ReservationState } from '../lead-reservation.js';
import {
  EvidenceSource,
  LedgerClaim,
  ReconciliationOutcome,
  type ChannelSighting,
  type LedgerRecord,
} from '../reconciliation-contract.js';
import {
  FinalizeRejection,
  type ClaimedAttempt,
  type FinalizeInput,
  type ReconciliationClaimStore,
  type RunRecord,
} from '../reconciliation-store.js';

const ATTEMPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAN_A = '11111111-1111-4111-8111-111111111111';
const CHAN_B = '22222222-2222-4222-8222-222222222222';
const NOW = 1_700_000_000_000;

const POLICY: ReconciliationPolicy = { enabled: true, ...DEFAULT_POLICY };

function claim(overrides: Partial<ClaimedAttempt> = {}): ClaimedAttempt {
  return {
    reservationId: 'res-1',
    attemptId: ATTEMPT,
    leadId: 'lead-1',
    tenantId: 'tenant-1',
    campaignId: 'campaign-1',
    state: ReservationState.NEEDS_RECONCILIATION,
    reconcilerToken: 'token-1',
    reconcileAttempts: 0,
    reservedAtMs: NOW - 5_000,
    ageMs: 5_000,
    ...overrides,
  };
}

class FakeStore implements ReconciliationClaimStore {
  readonly finalized: FinalizeInput[] = [];
  readonly runs: RunRecord[] = [];
  finalizeResult: { ok: true } | { ok: false; rejection: FinalizeRejection } = { ok: true };

  constructor(private readonly claims: ClaimedAttempt[] = []) {}

  claimBatch(): Promise<ClaimedAttempt[]> {
    return Promise.resolve(this.claims);
  }
  finalize(input: FinalizeInput): Promise<typeof this.finalizeResult> {
    this.finalized.push(input);
    return Promise.resolve(this.finalizeResult);
  }
  recordRun(record: RunRecord): Promise<{ ok: boolean }> {
    this.runs.push(record);
    return Promise.resolve({ ok: true });
  }
}

class FakePort implements ReadOnlyFreeSwitchPort {
  constructor(private readonly live: LookupResult<ChannelSighting[]>) {}
  findActiveChannelByAttemptId(): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve(this.live);
  }
  findRecentChannelHistoryByAttemptId(): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve({ available: false, detail: 'no history exists', value: [] });
  }
  getChannelVariables(): Promise<LookupResult<Record<string, string>>> {
    return Promise.resolve({ available: true, detail: '', value: {} });
  }
}

function livePort(uuids: string[]): FakePort {
  return new FakePort({
    available: true,
    detail: 'inspected',
    value: uuids.map(uuid => ({
      channelUuid: uuid,
      attemptId: ATTEMPT,
      observedAtMs: NOW,
      answerState: 'ACTIVE',
    })),
  });
}

function fakeLedger(records: LedgerRecord[]): AttemptLedger {
  return {
    findByAttemptId: () =>
      Promise.resolve({ available: true, detail: 'ledger', value: records }),
  };
}

function reconciler(
  store: ReconciliationClaimStore,
  freeswitch: ReadOnlyFreeSwitchPort,
  extra: Partial<{ ledger: AttemptLedger; policy: ReconciliationPolicy }> = {}
): AttemptReconciler {
  return new AttemptReconciler({
    store,
    freeswitch,
    policy: extra.policy ?? POLICY,
    ledger: extra.ledger,
    now: () => NOW,
  });
}

const SCOPE = { tenantIds: ['tenant-1'], campaignIds: [] as string[] };

describe('the gate', () => {
  it('does nothing at all when disabled', async () => {
    const store = new FakeStore([claim()]);
    const r = reconciler(store, livePort([]), {
      policy: { ...POLICY, enabled: false },
    });
    const report = await r.runOnce(SCOPE);
    expect(report.claimed).toBe(0);
    expect(store.finalized).toEqual([]);
    expect(store.runs).toEqual([]);
  });
});

describe('a live call is held, never redialed', () => {
  it('applies no transition and extends the lease', async () => {
    const store = new FakeStore([claim()]);
    const report = await reconciler(store, livePort([CHAN_A])).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.ACTIVE_CALL_CONFIRMED);
    expect(store.finalized[0].transitionTo).toBeNull();
    expect(store.finalized[0].extendLeaseToMs).toBeGreaterThan(NOW);
    expect(report.released).toBe(0);
  });

  it('records the channel uuid and the evidence timestamp', async () => {
    const store = new FakeStore([claim()]);
    await reconciler(store, livePort([CHAN_A])).runOnce(SCOPE);
    expect(store.runs[0].channelUuid).toBe(CHAN_A);
    expect(store.runs[0].evidenceAtMs).toBe(NOW);
  });
});

describe('absence never releases', () => {
  it('an unreachable switch reschedules and holds', async () => {
    const store = new FakeStore([claim()]);
    const report = await reconciler(store, new UnavailableFreeSwitchPort()).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.FREESWITCH_UNREACHABLE);
    expect(store.finalized[0].transitionTo).toBeNull();
    expect(store.finalized[0].nextReconcileAtMs).toBe(NOW + POLICY.initialDelayMs);
    expect(store.finalized[0].requiresManualReview).toBe(false);
  });

  it('an unreachable switch is recorded as unavailable, not as checked', async () => {
    const store = new FakeStore([claim()]);
    await reconciler(store, new UnavailableFreeSwitchPort()).runOnce(SCOPE);
    expect(store.runs[0].sourcesUnavailable).toContain(EvidenceSource.LIVE_CHANNELS);
    expect(store.runs[0].sourcesChecked).not.toContain(EvidenceSource.LIVE_CHANNELS);
  });

  it('an absent ledger is neither checked nor unavailable', async () => {
    // It was not consulted. Claiming either would be a statement about evidence
    // nobody looked for.
    const store = new FakeStore([claim()]);
    await reconciler(store, livePort([])).runOnce(SCOPE);
    expect(store.runs[0].sourcesChecked).not.toContain(EvidenceSource.EVENT_LEDGER);
    expect(store.runs[0].sourcesUnavailable).not.toContain(EvidenceSource.EVENT_LEDGER);
  });

  it('a source that throws is unavailable, and its error is discarded', async () => {
    const store = new FakeStore([claim()]);
    const exploding: AttemptLedger = {
      findByAttemptId: () =>
        Promise.reject(new Error('postgres://user:hunter2@db:5432/app is unreachable')),
    };
    await reconciler(store, livePort([]), { ledger: exploding }).runOnce(SCOPE);

    expect(store.runs[0].sourcesUnavailable).toContain(EvidenceSource.EVENT_LEDGER);
    expect(JSON.stringify(store.runs[0])).not.toContain('hunter2');
  });

  it('escalates to manual review once the budget is spent', async () => {
    const store = new FakeStore([claim({ reconcileAttempts: POLICY.maxAttempts - 1 })]);
    const report = await reconciler(store, livePort([])).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.MANUAL_REVIEW_REQUIRED);
    expect(store.finalized[0].requiresManualReview).toBe(true);
    expect(store.finalized[0].transitionTo).toBeNull();
    expect(store.finalized[0].nextReconcileAtMs).toBeNull();
  });
});

describe('positive ledger evidence resolves', () => {
  it('completes on a termination record', async () => {
    const store = new FakeStore([claim()]);
    const ledger = fakeLedger([
      {
        claim: LedgerClaim.CHANNEL_TERMINATED,
        channelUuid: CHAN_A,
        occurredAtMs: NOW - 1_000,
        hangupCause: 'NORMAL_CLEARING',
        provesHumanContact: true,
      },
    ]);
    const report = await reconciler(store, livePort([]), { ledger }).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.COMPLETED_CALL_CONFIRMED);
    expect(store.finalized[0].transitionTo).toBe(ReservationState.COMPLETED);
    expect(report.released).toBe(1);
  });

  it('does not mark the lead contacted even when the ledger claims it does', async () => {
    // `provesHumanContact: true` above is deliberately a lie the reconciler must
    // not act on. Reconciliation cannot establish who was on a call.
    const store = new FakeStore([claim()]);
    const ledger = fakeLedger([
      {
        claim: LedgerClaim.CHANNEL_TERMINATED,
        channelUuid: CHAN_A,
        occurredAtMs: NOW - 1_000,
        hangupCause: 'NORMAL_CLEARING',
        provesHumanContact: true,
      },
    ]);
    await reconciler(store, livePort([]), { ledger }).runOnce(SCOPE);
    expect(store.finalized[0].attemptOutcome).not.toBe('ANSWERED_BY_HUMAN');
  });

  it('two channels for one attempt enter manual review', async () => {
    const store = new FakeStore([claim()]);
    const report = await reconciler(store, livePort([CHAN_A, CHAN_B])).runOnce(SCOPE);

    expect(report.attempts[0].outcome).toBe(ReconciliationOutcome.EVIDENCE_CONFLICT);
    expect(store.finalized[0].requiresManualReview).toBe(true);
    expect(store.finalized[0].transitionTo).toBeNull();
  });
});

describe('fencing', () => {
  it('reports a refused write instead of claiming success', async () => {
    const store = new FakeStore([claim()]);
    store.finalizeResult = { ok: false, rejection: FinalizeRejection.STALE_CLAIM };

    const report = await reconciler(store, livePort([CHAN_A])).runOnce(SCOPE);

    expect(report.fenced).toBe(1);
    expect(report.reconciled).toBe(0);
    expect(report.attempts[0].finalizeRejection).toBe(FinalizeRejection.STALE_CLAIM);
    expect(report.attempts[0].released).toBe(false);
  });

  it('still writes the audit row, categorised as a fencing failure', async () => {
    // A refused finalize is exactly what an audit trail exists to show.
    const store = new FakeStore([claim()]);
    store.finalizeResult = { ok: false, rejection: FinalizeRejection.STALE_CLAIM };
    await reconciler(store, livePort([CHAN_A])).runOnce(SCOPE);

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0].errorCategory).toBe('fencing');
    expect(store.runs[0].newState).toBeNull();
  });

  it('carries the claim token into the audit row', async () => {
    const store = new FakeStore([claim({ reconcilerToken: 'token-xyz' })]);
    await reconciler(store, livePort([])).runOnce(SCOPE);
    expect(store.runs[0].fencingToken).toBe('token-xyz');
    expect(store.finalized[0].reconcilerToken).toBe('token-xyz');
  });
});

describe('the audit row', () => {
  it('records every field an operator needs to re-derive the decision', async () => {
    const store = new FakeStore([claim({ reconcileAttempts: 2 })]);
    await reconciler(store, livePort([])).runOnce(SCOPE);

    const run = store.runs[0];
    expect(run.reservationId).toBe('res-1');
    expect(run.attemptId).toBe(ATTEMPT);
    expect(run.leadId).toBe('lead-1');
    expect(run.tenantId).toBe('tenant-1');
    expect(run.campaignId).toBe('campaign-1');
    expect(run.previousState).toBe(ReservationState.NEEDS_RECONCILIATION);
    expect(run.retryCount).toBe(3);
    expect(run.startedAtMs).toBe(NOW);
    expect(run.completedAtMs).toBe(NOW);
    expect(run.outcome).toBeTruthy();
  });

  it('backs off between attempts', async () => {
    for (const [attempts, expected] of [
      [0, POLICY.initialDelayMs],
      [1, POLICY.initialDelayMs * 2],
      [2, POLICY.initialDelayMs * 4],
    ] as const) {
      const store = new FakeStore([claim({ reconcileAttempts: attempts })]);
      await reconciler(store, livePort([])).runOnce(SCOPE);
      expect(store.finalized[0].nextReconcileAtMs).toBe(NOW + expected);
    }
  });
});

describe('resilience', () => {
  it('a claim query that throws yields an empty cycle rather than a crash', async () => {
    const store: ReconciliationClaimStore = {
      claimBatch: () => Promise.reject(new Error('db gone')),
      finalize: () => Promise.resolve({ ok: true }),
      recordRun: () => Promise.resolve({ ok: true }),
    };
    const report = await reconciler(store, livePort([])).runOnce(SCOPE);
    expect(report.claimed).toBe(0);
  });

  it('processes every claim in a batch', async () => {
    const store = new FakeStore([
      claim({ reservationId: 'res-1', reconcilerToken: 't1' }),
      claim({ reservationId: 'res-2', reconcilerToken: 't2' }),
      claim({ reservationId: 'res-3', reconcilerToken: 't3' }),
    ]);
    const report = await reconciler(store, livePort([])).runOnce(SCOPE);
    expect(report.claimed).toBe(3);
    expect(store.finalized.map(f => f.reservationId)).toEqual(['res-1', 'res-2', 'res-3']);
  });
});
