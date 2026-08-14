/**
 * The operator surface for attempts the reconciler could not resolve.
 *
 * Routes under `/api/v1/dialer-v2/reconciliation`. Two of them: read the queue,
 * and resolve one attempt. There is no endpoint here that can originate a call,
 * enable the Hopper, enable origination, or write to `leads` — and there is no
 * generic update, so a resolution can only be one of four declared choices.
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 *
 * These routes do NOT trust `request.user`, for the reason documented in
 * `dialer-v2-shadow.ts`: the global hook populates it from `x-demo-tenant-id`
 * with `roles: ['ADMIN','OWNER']`, so any route trusting it accepts a
 * browser-chosen tenant with admin rights. Verification is independent, through
 * `verifyDialerV2Auth`, which reads only `Authorization: Bearer` and `x-api-key`.
 *
 * ── Redaction ────────────────────────────────────────────────────────────────
 *
 * The queue returns no phone number. An operator deciding whether a call
 * happened does not need the number, and the queue is the kind of screen that
 * gets left open. The lead is identified by id and by a masked number that shows
 * the last four digits only.
 */

import { applyManualResolution, AttemptResolutionChoice, ResolutionRejection } from '@hopwhistle/shared';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  verifyDialerV2Auth,
  type AuthFailure,
  type VerifiedAuthContext,
} from '../lib/dialer-v2-auth.js';
import { buildDialerV2VerifyDeps } from '../lib/dialer-v2-verify-deps.js';
import { getPrismaClient } from '../lib/prisma.js';
import {
  actorFor,
  mayResolveAttempt,
  mayViewReconciliationQueue,
} from '../lib/reconciliation-auth.js';

export interface ReconciliationRouteOptions {
  /** Injected in tests so no server or database is needed. */
  verify?: (
    request: FastifyRequest
  ) => Promise<{ ok: true; context: VerifiedAuthContext } | { ok: false; failure: AuthFailure }>;
  /** Injected in tests. Defaults to the shared Prisma client. */
  db?: {
    $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  };
}

/**
 * Show only the last four digits.
 *
 * A queue row exists to let somebody decide whether a call happened, and the
 * full number is not needed for that. Four digits is enough to match against a
 * carrier log an operator is holding.
 */
export function maskNumber(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

interface QueueRow {
  id: string;
  attemptId: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  phoneNumber: string | null;
  reservedAt: Date;
  token: string;
  reconcileAttempts: number;
  manualReviewReason: string | null;
  lastReconciliationOutcome: string | null;
  channelUuid: string | null;
  sourcesChecked: string[] | null;
  sourcesUnavailable: string[] | null;
}

function defaultVerifier(fastify: FastifyInstance) {
  const deps = buildDialerV2VerifyDeps(fastify);
  return async (request: FastifyRequest) => {
    return verifyDialerV2Auth(
      {
        authorization: request.headers.authorization,
        'x-api-key': request.headers['x-api-key'] as string | undefined,
      },
      deps
    );
  };
}

/** Resolve the caller, or send the right response. Null means already answered. */
async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  verify: NonNullable<ReconciliationRouteOptions['verify']>,
  permitted: (context: VerifiedAuthContext) => boolean
): Promise<VerifiedAuthContext | null> {
  const result = await verify(request);

  if (!result.ok) {
    void reply.code(401);
    // Not echoed: the reason would tell a prober whether a tenant or key exists.
    void reply.send({
      error: { code: 'UNAUTHORIZED', message: 'Verified authentication required' },
    });
    return null;
  }

  if (!permitted(result.context)) {
    void reply.code(403);
    void reply.send({
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
    });
    return null;
  }

  return result.context;
}

/** Rejections that are the caller's fault, and the status each deserves. */
const REJECTION_STATUS: Readonly<Record<ResolutionRejection, number>> = Object.freeze({
  [ResolutionRejection.NOT_IN_REVIEW]: 404,
  [ResolutionRejection.WRONG_TENANT]: 404,
  [ResolutionRejection.STALE_TOKEN]: 409,
  [ResolutionRejection.ALREADY_RESOLVED]: 409,
  [ResolutionRejection.ACKNOWLEDGEMENT_REQUIRED]: 422,
  [ResolutionRejection.INVALID_REQUEST]: 400,
  [ResolutionRejection.STORE_UNAVAILABLE]: 503,
});

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerDialerV2ReconciliationRoutes(
  fastify: FastifyInstance,
  options: ReconciliationRouteOptions = {}
) {
  const verify = options.verify ?? defaultVerifier(fastify);
  const db = options.db ?? (getPrismaClient() as unknown as NonNullable<ReconciliationRouteOptions['db']>);

  /**
   * The manual-review queue for the caller's tenant.
   *
   * `tenantId` is taken from the verified context and appears in the predicate.
   * There is no tenant parameter, so there is nothing for a caller to widen.
   */
  fastify.get<{ Querystring: { limit?: string; campaignId?: string } }>(
    '/api/v1/dialer-v2/reconciliation/queue',
    async (request, reply) => {
      const auth = await authorize(request, reply, verify, mayViewReconciliationQueue);
      if (!auth) return reply;

      const rawLimit = Number.parseInt(request.query.limit ?? '', 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;

      const rows = await db!.$queryRawUnsafe<QueueRow[]>(
        `SELECT r."id", r."attemptId", r."leadId", r."tenantId", r."campaignId",
                l."phoneNumber", r."reservedAt", r."token", r."reconcileAttempts",
                r."manualReviewReason", r."lastReconciliationOutcome",
                run."channelUuid", run."sourcesChecked", run."sourcesUnavailable"
           FROM "lead_dial_reservations" r
           JOIN "leads" l ON l."id" = r."leadId"
           LEFT JOIN LATERAL (
             SELECT "channelUuid", "sourcesChecked", "sourcesUnavailable"
               FROM "attempt_reconciliation_runs"
              WHERE "reservationId" = r."id"
              ORDER BY "startedAt" DESC
              LIMIT 1
           ) run ON true
          WHERE r."tenantId" = $1
            AND r."manualReviewRequired" = true
            AND r."releasedAt" IS NULL
            AND ($2::text IS NULL OR r."campaignId" = $2::text)
          ORDER BY r."reservedAt" ASC
          LIMIT $3`,
        auth.tenantId,
        request.query.campaignId ?? null,
        limit
      );

      const now = Date.now();
      return {
        data: rows.map(row => ({
          reservationId: row.id,
          attemptId: row.attemptId,
          tenantId: row.tenantId,
          campaignId: row.campaignId,
          leadId: row.leadId,
          // Never the full number. See the module comment.
          leadNumberMasked: maskNumber(row.phoneNumber),
          reservationAgeMs: Math.max(0, now - new Date(row.reservedAt).getTime()),
          reconciliationState: row.lastReconciliationOutcome,
          manualReviewReason: row.manualReviewReason,
          channelUuid: row.channelUuid,
          evidenceSourcesChecked: row.sourcesChecked ?? [],
          evidenceSourcesUnavailable: row.sourcesUnavailable ?? [],
          retryCount: row.reconcileAttempts,
          // The token the decision must be presented with. A resolution carrying
          // a stale one is refused, so a screen left open overnight cannot apply
          // a decision to an attempt that has since moved on.
          token: row.token,
        })),
        meta: {
          tenantId: auth.tenantId,
          authSource: auth.source,
          count: rows.length,
          // Stated on every response. Nothing here places or ends a call.
          originated: false,
          note: 'These attempts are held. Resolving one never originates a call.',
        },
      };
    }
  );

  fastify.post<{
    Params: { reservationId: string };
    Body: {
      choice?: string;
      reason?: string;
      presentedToken?: string;
      acknowledgedRedialRisk?: boolean;
    };
  }>('/api/v1/dialer-v2/reconciliation/:reservationId/resolve', async (request, reply) => {
    const auth = await authorize(request, reply, verify, mayResolveAttempt);
    if (!auth) return reply;

    const body = request.body ?? {};
    const actor = actorFor(auth);

    const result = await applyManualResolution(
      {
        reservationId: request.params.reservationId,
        // From the verified context, never from the body. A caller cannot name
        // the tenant whose attempt it is resolving.
        tenantId: auth.tenantId,
        presentedToken: String(body.presentedToken ?? ''),
        choice: body.choice as AttemptResolutionChoice,
        reason: String(body.reason ?? ''),
        actorId: actor.actorId,
        actorLabel: actor.actorLabel,
        acknowledgedRedialRisk: body.acknowledgedRedialRisk === true,
      },
      { db: db! }
    );

    if (!result.ok) {
      void reply.code(REJECTION_STATUS[result.rejection] ?? 400);
      return {
        error: { code: result.rejection, message: result.detail },
      };
    }

    return {
      data: {
        reservationId: result.reservationId,
        choice: result.choice,
        resolvedBy: actor.actorId,
      },
      meta: {
        tenantId: auth.tenantId,
        authSource: auth.source,
        originated: false,
        note: 'The attempt was resolved. No call was placed and no lead was marked contacted.',
      },
    };
  });
}
