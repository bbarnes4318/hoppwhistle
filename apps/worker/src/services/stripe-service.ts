import { Pool } from 'pg';
import Stripe from 'stripe';

import { logger } from '../logger.js';

export class StripeService {
  private stripe: Stripe | null = null;
  private pool: Pool;
  private enabled: boolean;

  constructor() {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    this.enabled = process.env.STRIPE_ENABLED === 'true' && !!stripeKey;

    if (this.enabled && stripeKey) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2024-11-20.acacia',
      });
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });
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

      const invoice = invoiceResult.rows[0];

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
      const invoiceItems = await Promise.all(
        linesResult.rows.map(async (line) => {
          return await this.stripe!.invoiceItems.create({
            customer: invoice.stripe_customer_id,
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

      if (accountResult.rows.length === 0 || !accountResult.rows[0].stripe_connect_account_id) {
        logger.warn(`No Stripe Connect account for billing account ${billingAccountId}`);
        return null;
      }

      const connectAccountId = accountResult.rows[0].stripe_connect_account_id;

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

  /**
   * Check if Stripe is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

