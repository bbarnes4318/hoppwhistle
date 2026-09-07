import { Pool } from 'pg';
import Stripe from 'stripe';

import { logger } from '../logger.js';

interface StripeInvoiceRow {
  stripe_customer_id: string | null;
  billing_account_id: string;
  currency: string;
  due_date: string | number | Date;
  invoice_number: string;
}

interface StripeInvoiceLineRow {
  id: string;
  total: string;
  description: string;
}

export class StripeService {
  private stripe: Stripe | null = null;
  private poolInstance: Pool | null = null;
  private enabled: boolean;

  constructor() {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    this.enabled = process.env.STRIPE_ENABLED === 'true' && !!stripeKey;

    if (this.enabled && stripeKey) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2023-10-16',
      });
    }

  }

  /**
   * The invoice and payout methods below read the marketplace billing tables
   * directly, so they need a pool. The ACH methods added for NetEnroll
   * settlement do not -- they are handed every value they use, because the
   * caller is `apps/api`, which reads those rows through Prisma.
   *
   * So the pool is built on first use rather than in the constructor. Without
   * that, importing this class from `apps/api` to place an off-session debit
   * would open a second connection pool against the same database for no
   * reason, and would throw at import time in any process that has no
   * DATABASE_URL.
   */
  private get pool(): Pool {
    if (!this.poolInstance) {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
      }
      this.poolInstance = new Pool({ connectionString: databaseUrl, max: 10 });
    }
    return this.poolInstance;
  }

  /**
   * Create invoice in Stripe
   */
  async createStripeInvoice(invoiceId: string): Promise<string | null> {
    if (!this.enabled || !this.stripe) {
      logger.info('Stripe integration disabled, skipping');
      return null;
    }

    const client = await this.pool.connect();

    try {
      // Get invoice data
      const invoiceResult = await client.query(
        `SELECT i.*, ba.stripe_customer_id, ba.currency
         FROM invoices i
         JOIN billing_accounts ba ON ba.id = i.billing_account_id
         WHERE i.id = $1`,
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        throw new Error('Invoice not found');
      }

      const invoice = invoiceResult.rows[0] as StripeInvoiceRow;

      if (!invoice.stripe_customer_id) {
        logger.warn(`No Stripe customer ID for billing account ${invoice.billing_account_id}`);
        return null;
      }

      // Get invoice lines
      const linesResult = await client.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = $1',
        [invoiceId]
      );

      // Create Stripe invoice items
      await Promise.all(
        (linesResult.rows as StripeInvoiceLineRow[]).map(async (line) => {
          return await this.stripe!.invoiceItems.create({
            customer: invoice.stripe_customer_id!,
            amount: Math.round(parseFloat(line.total) * 100), // Convert to cents
            currency: invoice.currency.toLowerCase(),
            description: line.description,
            metadata: {
              invoiceId,
              invoiceLineId: line.id,
            },
          });
        })
      );

      // Create Stripe invoice
      const stripeInvoice = await this.stripe.invoices.create({
        customer: invoice.stripe_customer_id,
        auto_advance: false,
        collection_method: 'send_invoice',
        days_until_due: Math.ceil(
          (new Date(invoice.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        ),
        metadata: {
          invoiceId,
          invoiceNumber: invoice.invoice_number,
        },
      });

      // Finalize invoice
      await this.stripe.invoices.finalizeInvoice(stripeInvoice.id);

      // Update database
      await client.query(
        `UPDATE invoices
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({ stripeInvoiceId: stripeInvoice.id }),
          invoiceId,
        ]
      );

      logger.info(`Created Stripe invoice ${stripeInvoice.id} for invoice ${invoiceId}`);
      return stripeInvoice.id;
    } catch (error) {
      logger.error('Error creating Stripe invoice:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create payout via Stripe Connect
   */
  async createPayout(
    billingAccountId: string,
    amount: number,
    currency: string = 'USD'
  ): Promise<string | null> {
    if (!this.enabled || !this.stripe) {
      logger.info('Stripe integration disabled, skipping');
      return null;
    }

    const client = await this.pool.connect();

    try {
      // Get Stripe Connect account ID
      const accountResult = await client.query(
        `SELECT stripe_connect_account_id
         FROM billing_accounts
         WHERE id = $1`,
        [billingAccountId]
      );

      interface ConnectAccountRow {
        stripe_connect_account_id: string | null;
      }

      const accountRow = accountResult.rows[0] as ConnectAccountRow;
      if (accountResult.rows.length === 0 || !accountRow?.stripe_connect_account_id) {
        logger.warn(`No Stripe Connect account for billing account ${billingAccountId}`);
        return null;
      }

      const connectAccountId = accountRow.stripe_connect_account_id;

      // Create transfer to Connect account
      const transfer = await this.stripe.transfers.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        destination: connectAccountId,
        metadata: {
          billingAccountId,
        },
      });

      logger.info(`Created Stripe transfer ${transfer.id} for billing account ${billingAccountId}`);
      return transfer.id;
    } catch (error) {
      logger.error('Error creating Stripe payout:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================================================
  // NetEnroll daily settlement: ACH, off-session, against a saved mandate
  //
  // Added here rather than in a new module because there is one Stripe
  // integration on this platform and this file is it. The caller is
  // `apps/api/src/services/billing/settlement.ts`, which reaches this class
  // through the `@hopwhistle/worker/stripe-service` workspace export.
  //
  // Three properties these methods are written around:
  //
  //   ACH ONLY, FOR SETTLEMENT. `chargeAchOffSession` sets
  //   payment_method_types to us_bank_account and nothing else. At roughly
  //   $8,978 a day on one account, card fees would run about $87,000 a year, so
  //   card is permitted for an agency's OPENING purchase and never for a daily
  //   settlement. `chargeCardOnSession` exists for that one case and is named
  //   so it cannot be reached for the other by accident.
  //
  //   IDEMPOTENT AT STRIPE TOO. Every charge carries an idempotency key derived
  //   from the settlement it belongs to. The unique index on
  //   (tenantId, deliveryDay) already stops a second settlement row existing;
  //   this stops a retry of the SAME row from becoming a second payment intent
  //   if the process dies between Stripe accepting the charge and us recording
  //   it.
  //
  //   NO AMOUNT FROM A BROWSER. Every method here takes a number of CENTS,
  //   computed server-side from the ledger and the rating engine. Nothing in
  //   this file reads a request.
  // ==========================================================================

  /**
   * Place one off-session ACH debit against a saved mandate.
   *
   * `off_session: true` and `confirm: true` together are what tell Stripe this
   * is a merchant-initiated debit under a mandate the customer already
   * authorised: there is nobody at a browser to complete an authentication step
   * at 00:05, and a payment intent that waits for one would sit in
   * requires_action until somebody noticed.
   *
   * Never throws. A settlement that cannot be charged must still be recorded as
   * a settlement that could not be charged, so failures come back as data.
   */
  async chargeAchOffSession(params: {
    customerId: string;
    paymentMethodId: string;
    /** Whole cents. Derived server-side; never accepted from a request. */
    amountCents: number;
    currency?: string;
    description: string;
    /**
     * Stable across retries of the same settlement. Two calls with the same key
     * and the same amount return the same payment intent rather than two
     * debits.
     */
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AchChargeResult> {
    if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
      return {
        ok: false,
        paymentIntentId: null,
        status: null,
        failureCode: 'invalid_amount',
        failureMessage: `An ACH debit must be a positive whole number of cents, got ${params.amountCents}`,
      };
    }

    if (!this.enabled || !this.stripe) {
      // Not an error and not a success. The settlement records this as a
      // failure rather than pretending money moved, which is the only safe
      // reading of "we are not configured to charge anyone".
      logger.warn('Stripe integration disabled; ACH settlement debit not placed');
      return {
        ok: false,
        paymentIntentId: null,
        status: null,
        failureCode: 'stripe_disabled',
        failureMessage: 'Stripe is not enabled in this environment, so no debit was placed.',
      };
    }

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: params.amountCents,
          currency: (params.currency ?? 'usd').toLowerCase(),
          customer: params.customerId,
          payment_method: params.paymentMethodId,
          // ACH only. A card here would be a five-figure annual fee nobody
          // agreed to; see the note above this block.
          payment_method_types: ['us_bank_account'],
          confirm: true,
          off_session: true,
          description: params.description,
          metadata: params.metadata,
        },
        { idempotencyKey: params.idempotencyKey }
      );

      // `processing` is the normal ACH answer: the debit was accepted and will
      // settle over the next few days. It is a success for our purposes --
      // Stripe took the instruction -- and a later webhook or reconciliation
      // moves it to succeeded or failed.
      const accepted = intent.status === 'succeeded' || intent.status === 'processing';

      return {
        ok: accepted,
        paymentIntentId: intent.id,
        status: intent.status,
        failureCode: accepted ? null : intent.last_payment_error?.code ?? intent.status,
        failureMessage: accepted
          ? null
          : intent.last_payment_error?.message ?? `Payment intent status ${intent.status}`,
      };
    } catch (error) {
      const stripeError = error as Stripe.errors.StripeError;
      logger.error('ACH settlement debit failed:', error);
      return {
        ok: false,
        paymentIntentId: stripeError?.payment_intent?.id ?? null,
        status: stripeError?.payment_intent?.status ?? null,
        failureCode: stripeError?.code ?? stripeError?.type ?? 'stripe_error',
        failureMessage: stripeError?.message ?? String(error),
      };
    }
  }

  /**
   * A card charge, on-session, for an agency's OPENING purchase only.
   *
   * Deliberately a separate method with a name that says what it is for.
   * Settlement calls `chargeAchOffSession`; nothing calls this on a schedule.
   */
  async chargeCardOnSession(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency?: string;
    description: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<AchChargeResult> {
    if (!this.enabled || !this.stripe) {
      return {
        ok: false,
        paymentIntentId: null,
        status: null,
        failureCode: 'stripe_disabled',
        failureMessage: 'Stripe is not enabled in this environment, so no charge was placed.',
      };
    }

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: params.amountCents,
          currency: (params.currency ?? 'usd').toLowerCase(),
          customer: params.customerId,
          payment_method: params.paymentMethodId,
          payment_method_types: ['card'],
          confirm: true,
          description: params.description,
          metadata: params.metadata,
        },
        { idempotencyKey: params.idempotencyKey }
      );

      const accepted = intent.status === 'succeeded' || intent.status === 'processing';
      return {
        ok: accepted,
        paymentIntentId: intent.id,
        status: intent.status,
        failureCode: accepted ? null : intent.last_payment_error?.code ?? intent.status,
        failureMessage: accepted
          ? null
          : intent.last_payment_error?.message ?? `Payment intent status ${intent.status}`,
      };
    } catch (error) {
      const stripeError = error as Stripe.errors.StripeError;
      logger.error('Opening purchase card charge failed:', error);
      return {
        ok: false,
        paymentIntentId: stripeError?.payment_intent?.id ?? null,
        status: stripeError?.payment_intent?.status ?? null,
        failureCode: stripeError?.code ?? stripeError?.type ?? 'stripe_error',
        failureMessage: stripeError?.message ?? String(error),
      };
    }
  }

  /** Find or create the Stripe customer an agency's mandate hangs off. */
  async ensureCustomer(params: {
    existingCustomerId: string | null;
    name: string;
    email?: string | null;
    metadata?: Record<string, string>;
  }): Promise<string | null> {
    if (!this.enabled || !this.stripe) return null;

    if (params.existingCustomerId) {
      try {
        const existing = await this.stripe.customers.retrieve(params.existingCustomerId);
        if (!existing.deleted) return existing.id;
      } catch (error) {
        logger.warn(`Stripe customer ${params.existingCustomerId} could not be retrieved:`, error);
      }
    }

    const created = await this.stripe.customers.create({
      name: params.name,
      email: params.email ?? undefined,
      metadata: params.metadata,
    });
    return created.id;
  }

  /**
   * Begin collecting an ACH mandate.
   *
   * Returns the SetupIntent's client secret for the agency's browser to
   * complete. The client secret authorises attaching a bank account to this
   * customer and nothing else: it cannot move money, and no amount is named
   * here or accepted from the caller.
   */
  async createAchSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string } | null> {
    if (!this.enabled || !this.stripe) return null;

    const intent = await this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['us_bank_account'],
      usage: 'off_session',
    });

    return intent.client_secret ? { id: intent.id, clientSecret: intent.client_secret } : null;
  }

  /**
   * Read back what a SetupIntent actually produced.
   *
   * The mandate is recorded from THIS, never from what the browser reports.
   * A browser saying "I attached bank account X" is a browser asserting which
   * account a five-figure debit will come out of.
   */
  async describeAchMandate(setupIntentId: string): Promise<AchMandateFacts | null> {
    if (!this.enabled || !this.stripe) return null;

    const intent = await this.stripe.setupIntents.retrieve(setupIntentId, {
      expand: ['payment_method'],
    });

    const paymentMethod =
      typeof intent.payment_method === 'string' ? null : intent.payment_method ?? null;

    if (!paymentMethod) {
      return {
        setupIntentStatus: intent.status,
        paymentMethodId: null,
        usable: false,
        bankName: null,
        last4: null,
        customerId: typeof intent.customer === 'string' ? intent.customer : null,
      };
    }

    const bank = paymentMethod.us_bank_account ?? null;

    return {
      setupIntentStatus: intent.status,
      paymentMethodId: paymentMethod.id,
      // Only a succeeded SetupIntent has a mandate that can be debited
      // off-session. Anything else -- requires_action, processing, a
      // micro-deposit still awaiting confirmation -- is not a mandate yet, and
      // treating it as one would mean delivering calls against a bank account
      // that may refuse the first debit.
      usable: intent.status === 'succeeded' && !!bank,
      bankName: bank?.bank_name ?? null,
      last4: bank?.last4 ?? null,
      customerId: typeof intent.customer === 'string' ? intent.customer : null,
    };
  }

  /**
   * Check if Stripe is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/** What one attempt at a debit produced. Failures are data, never exceptions. */
export interface AchChargeResult {
  /** Stripe accepted the instruction. For ACH that includes `processing`. */
  ok: boolean;
  paymentIntentId: string | null;
  status: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

/** What a completed SetupIntent says about an agency's bank mandate. */
export interface AchMandateFacts {
  setupIntentStatus: string;
  paymentMethodId: string | null;
  /** True only when this can actually be debited off-session. */
  usable: boolean;
  bankName: string | null;
  last4: string | null;
  customerId: string | null;
}

