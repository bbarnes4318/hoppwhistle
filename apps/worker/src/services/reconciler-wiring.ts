/**
 * Composition for the attempt reconciler.
 *
 * Kept out of the entrypoint so `index.ts` stays a list of decisions rather than
 * a list of constructions, and kept out of `attempt-reconciler.ts` so that file
 * has no reason to import a Prisma client — which is what lets its tests run
 * against literals.
 *
 * ── Why the port is unavailable by default ───────────────────────────────────
 *
 * Building an `AllowlistedFreeSwitchAdapter` requires an ESL connection, and
 * opening one is exactly the kind of thing this round is not authorized to do
 * against any real switch. So the default is `UnavailableFreeSwitchPort`, which
 * reports every source unreachable — and the classifier reads that as
 * `FREESWITCH_UNREACHABLE`, which never releases anything. A deployment wanting
 * the live-channel source must supply a connection explicitly, and the adapter
 * it gets still refuses every command outside the allowlist.
 *
 * The event ledger is not wired at all, because none exists. See
 * `docs/dialer-v2/ORIGINATION_EVIDENCE_TRACE.md`.
 */

import { PrismaClient } from '@prisma/client';

import {
  resolveReconciliationPolicy,
  type PolicyEnv,
} from '../config/reconciliation-policy.js';
import { logger } from '../lib/logger.js';

import { AttemptReconciler } from './attempt-reconciler.js';
import { UnavailableFreeSwitchPort } from './freeswitch-readonly.js';
import { ReconciliationStore } from './reconciliation-store.js';

/** What the entrypoint needs: something to cycle, and how often. */
export interface WiredReconciler {
  runOnce(scope: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<{ claimed: number; released: number; parkedForReview: number }>;
  cycleIntervalMs: number;
}

/**
 * Build the reconciler, or return null when it is not enabled.
 *
 * Returning null rather than a disabled instance means no Prisma client is
 * created, no connection pool is opened, and nothing is scheduled in the
 * ordinary case where the reconciler is off — which is every environment today.
 */
export function buildAttemptReconciler(env: PolicyEnv): WiredReconciler | null {
  const resolution = resolveReconciliationPolicy(env);
  if (!resolution.ok || !resolution.policy.enabled) return null;

  const prisma = new PrismaClient();
  const store = new ReconciliationStore({
    db: prisma,
    ownerId: env.RECONCILER_OWNER_ID?.trim() || `reconciler-${process.pid}`,
    leaseMs: resolution.policy.leaseMs,
  });

  const reconciler = new AttemptReconciler({
    store,
    freeswitch: new UnavailableFreeSwitchPort(
      'no read-only FreeSWITCH connection is configured for the reconciler'
    ),
    policy: resolution.policy,
    onOutcome: (outcome, detail) => {
      logger.info({ msg: 'Attempt reconciled', outcome, detail });
    },
  });

  return {
    runOnce: scope => reconciler.runOnce(scope),
    // The floor of the backoff. Cycling faster than this finds nothing, because
    // each attempt sets its own `reconcileNotBefore` when it is deferred.
    cycleIntervalMs: resolution.policy.initialDelayMs,
  };
}
