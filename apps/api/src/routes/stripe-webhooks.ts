/**
 * Stripe's webhooks, and the one thing this platform does with them.
 *
 * ── Disputes, and nothing else ───────────────────────────────────────────────
 *
 * The only events handled here are `charge.dispute.created`,
 * `charge.dispute.updated` and `charge.dispute.closed`. Every other event is
 * acknowledged and ignored: a 200 with `handled: false`, so Stripe stops
 * retrying it and nothing in this file grows a second job.
 *
 * A dispute is a card chargeback -- money taken back without our consent, often
 * weeks after the applications it paid for were delivered. What happens on one
 * is detection and containment: delivery stops, the tenant is flagged, platform
 * staff are told, and no Overrun is extended. What does NOT happen is any kind
 * of reversal. No credit is returned, no ledger row is written, no settlement
 * figure moves. See `services/billing/disputes.ts`.
 *
 * ── This endpoint is unauthenticated, and that is why the signature matters ──
 *
 * Stripe cannot present a bearer token, so the request is verified by its
 * `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` -- over the RAW
 * body, which is why this plugin installs its own content type parser. An
 * unverified dispute webhook would let anybody who can reach this URL stop an
 * agency's delivery, so an unsigned or unverifiable request is refused before
 * anything is read out of it.
 *
 * ── Nothing in the payload names a tenant ────────────────────────────────────
 *
 * The agency is resolved from the payment intent Stripe names, against the rows
 * this platform wrote when it placed the debit. A webhook body cannot say which
 * agency it is about, for the same reason a browser cannot: the tenant comes
 * from data we recorded, never from the wire.
 */

import type { FastifyInstance } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { paymentGateway } from '../services/billing/ach.js';
import { recordDispute, resolveDisputedPayment } from '../services/billing/disputes.js';

/** The three events this endpoint acts on. Everything else is acknowledged. */
const DISPUTE_EVENTS = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);

/**
 * The shape read out of a verified Stripe dispute object.
 *
 * Narrow on purpose: only the fields below are read, and each is checked rather
 * than cast, so a payload shaped differently from expectation produces a
 * refusal rather than a row of nulls.
 */
interface StripeDisputeObject {
  id?: unknown;
  charge?: unknown;
  payment_intent?: unknown;
  amount?: unknown;
  reason?: unknown;
  status?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerStripeWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /*
   * The raw body, kept as a Buffer.
   *
   * Fastify's default JSON parser would hand the handler a parsed object, and a
   * re-serialised object does not produce the same bytes Stripe signed. This
   * parser is registered inside this plugin, so it applies to the routes below
   * and to nothing else on the server.
   */
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    }
  );

  /**
   * POST /api/v1/webhooks/stripe
   *
   * Verified by signature. Returns 200 for anything it successfully processed
   * or deliberately ignored, so Stripe stops retrying; 400 for a request it
   * could not verify.
   */
  fastify.post('/api/v1/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (typeof signature !== 'string' || signature.length === 0) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Missing Stripe signature' } });
    }

    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Expected a raw request body' } });
    }

    const event = paymentGateway().constructWebhookEvent(rawBody, signature);

    if (!event) {
      /*
       * One answer for "the signature did not verify" and for "no webhook
       * secret is configured". Telling an unauthenticated caller which of the
       * two it is tells them which half of a guess was right.
       */
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Signature verification failed' } });
    }

    if (!DISPUTE_EVENTS.has(event.type)) {
      // Acknowledged and ignored. A 200 stops Stripe retrying an event this
      // platform has deliberately not implemented.
      return reply.send({ data: { received: true, handled: false, type: event.type } });
    }

    const dispute = (event.data.object ?? {}) as StripeDisputeObject;

    const stripeDisputeId = asString(dispute.id);
    if (!stripeDisputeId) {
      return reply
        .code(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Dispute carries no id' } });
    }

    const paymentIntentId = asString(dispute.payment_intent);

    const owner = await resolveDisputedPayment(prisma, paymentIntentId);

    if (!owner) {
      /*
       * A dispute against a payment this platform did not place, or one whose
       * payment intent we never recorded. Acknowledged so Stripe stops
       * retrying, and logged loudly: a chargeback we cannot attribute is
       * something a human needs to look at, and inventing a tenant to attach it
       * to would be worse than saying we could not.
       */
      logger.error({
        msg: 'Stripe dispute could not be attributed to any agency',
        type: event.type,
        stripeDisputeId,
        paymentIntentId,
      });
      return reply.send({
        data: { received: true, handled: false, reason: 'no matching payment' },
      });
    }

    const amountCents = typeof dispute.amount === 'number' ? dispute.amount : 0;

    const result = await recordDispute({
      prisma,
      tenantId: owner.tenantId,
      settlementId: owner.settlementId,
      facts: {
        stripeDisputeId,
        stripeChargeId: asString(dispute.charge),
        stripePaymentIntentId: paymentIntentId,
        // Stripe reports cents. Converted once, here, and stored in dollars
        // like every other amount in this system.
        amount: Number((amountCents / 100).toFixed(2)),
        reason: asString(dispute.reason),
        stripeStatus: asString(dispute.status),
        closed: event.type === 'charge.dispute.closed',
      },
    });

    logger.warn({
      msg: 'Stripe dispute recorded',
      type: event.type,
      tenantId: owner.tenantId,
      settlementId: owner.settlementId,
      stripeDisputeId,
      status: result.status,
      deliverySuspended: result.deliverySuspended,
    });

    return reply.send({
      data: {
        received: true,
        handled: true,
        disputeId: result.disputeId,
        status: result.status,
        deliverySuspended: result.deliverySuspended,
        /*
         * Stated in the response because it is the property that matters most
         * about this endpoint: a chargeback contains, it does not reverse.
         */
        creditsReturned: 0,
        ledgerRowsWritten: 0,
        settlementFiguresChanged: 0,
      },
    });
  });
}
