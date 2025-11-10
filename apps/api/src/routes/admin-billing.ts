import { Decimal } from 'decimal.js';
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

// Inline services to avoid path issues
import puppeteer from 'puppeteer';

// Simplified inline implementations
class InvoiceGeneratorService {
  private pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async generateInvoice(
    billingAccountId: string,
    periodDate: Date,
    dueDate: Date,
    publisherId?: string,
    buyerId?: string
  ): Promise<string> {
    // Implementation from worker service
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get accruals
      let sql = `
        SELECT id, type, amount, description, call_id
        FROM accrual_ledger
        WHERE billing_account_id = $1 AND period_date = $2 AND closed = false
      `;
      const params: any[] = [billingAccountId, periodDate];
      if (publisherId) {
        sql += ' AND publisher_id = $' + (params.length + 1);
        params.push(publisherId);
      }
      if (buyerId) {
        sql += ' AND buyer_id = $' + (params.length + 1);
        params.push(buyerId);
      }
      sql += ' ORDER BY created_at ASC';
      
      const accrualsResult = await client.query(sql, params);
      if (accrualsResult.rows.length === 0) {
        throw new Error('No accruals found for period');
      }

      const accountResult = await client.query(
        'SELECT tenant_id, currency FROM billing_accounts WHERE id = $1',
        [billingAccountId]
      );
      const { tenant_id, currency } = accountResult.rows[0];

      const lines = accrualsResult.rows.map((accrual) => ({
        description: accrual.description,
        quantity: new Decimal(1),
        unitPrice: new Decimal(accrual.amount),
        total: new Decimal(accrual.amount),
      }));

      const subtotal = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
      const tax = new Decimal(0);
      const total = subtotal.plus(tax);

      const invoiceNumber = await this.generateInvoiceNumber(billingAccountId);
      const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const periodStart = new Date(periodDate);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodDate);
      periodEnd.setHours(23, 59, 59, 999);

      await client.query(
        `INSERT INTO invoices (
          id, billing_account_id, invoice_number, status, period_start, period_end,
          subtotal, tax, total, due_date, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          invoiceId, billingAccountId, invoiceNumber, 'DRAFT',
          periodStart, periodEnd, subtotal.toFixed(2), tax.toFixed(2),
          total.toFixed(2), dueDate,
        ]
      );

      for (const line of lines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, invoice_id, description, quantity, unit_price, total, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            `line_${invoiceId}_${Math.random().toString(36).substr(2, 9)}`,
            invoiceId, line.description, line.quantity.toFixed(2),
            line.unitPrice.toFixed(4), line.total.toFixed(2),
          ]
        );
      }

      // Close accruals
      let closeSql = `
        UPDATE accrual_ledger
        SET closed = true, closed_at = NOW(), invoice_id = $1, updated_at = NOW()
        WHERE billing_account_id = $2 AND period_date = $3 AND closed = false
      `;
      const closeParams: any[] = [invoiceId, billingAccountId, periodDate];
      if (publisherId) {
        closeSql += ' AND publisher_id = $' + (closeParams.length + 1);
        closeParams.push(publisherId);
      }
      if (buyerId) {
        closeSql += ' AND buyer_id = $' + (closeParams.length + 1);
        closeParams.push(buyerId);
      }
      await client.query(closeSql, closeParams);

      await client.query('COMMIT');
      return invoiceId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async generatePDF(invoiceId: string): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      const invoiceResult = await client.query(
        `SELECT i.*, ba.name as account_name, ba.currency, t.name as tenant_name
         FROM invoices i
         JOIN billing_accounts ba ON ba.id = i.billing_account_id
         JOIN tenants t ON t.id = ba.tenant_id
         WHERE i.id = $1`,
        [invoiceId]
      );
      if (invoiceResult.rows.length === 0) throw new Error('Invoice not found');
      const invoice = invoiceResult.rows[0];
      const linesResult = await client.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at',
        [invoiceId]
      );
      const html = this.generateInvoiceHTML(invoice, linesResult.rows);
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
        printBackground: true,
      });
      await browser.close();
      return Buffer.from(pdf);
    } finally {
      client.release();
    }
  }

  private generateInvoiceHTML(invoice: any, lines: any[]): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#333;margin:0;padding:20px}
      .header{display:flex;justify-content:space-between;margin-bottom:30px;border-bottom:2px solid #333;padding-bottom:20px}
      .invoice-info{text-align:right}
      .invoice-number{font-size:24px;font-weight:bold;margin-bottom:10px}
      table{width:100%;border-collapse:collapse;margin-bottom:30px}
      th{background-color:#f0f0f0;padding:10px;text-align:left;border-bottom:2px solid #333}
      td{padding:10px;border-bottom:1px solid #ddd}
      .text-right{text-align:right}
      .totals{margin-left:auto;width:300px}
      .totals-row{display:flex;justify-content:space-between;padding:5px 0}
      .totals-row.total{font-weight:bold;font-size:16px;border-top:2px solid #333;padding-top:10px;margin-top:10px}
    </style></head><body>
      <div class="header">
        <div><h1>${invoice.tenant_name || 'Hopwhistle'}</h1><div>Billing Account: ${invoice.account_name}</div></div>
        <div class="invoice-info"><div class="invoice-number">Invoice ${invoice.invoice_number}</div><div>Status: ${invoice.status}</div></div>
      </div>
      <div><div>Period: ${new Date(invoice.period_start).toLocaleDateString()} - ${new Date(invoice.period_end).toLocaleDateString()}</div>
      <div>Due Date: ${new Date(invoice.due_date).toLocaleDateString()}</div><div>Currency: ${invoice.currency}</div></div>
      <table><thead><tr><th>Description</th><th class="text-right">Quantity</th><th class="text-right">Unit Price</th><th class="text-right">Total</th></tr></thead><tbody>
      ${lines.map((l: any) => `<tr><td>${l.description}</td><td class="text-right">${parseFloat(l.quantity).toFixed(2)}</td><td class="text-right">${parseFloat(l.unit_price).toFixed(4)}</td><td class="text-right">${parseFloat(l.total).toFixed(2)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totals">
        <div class="totals-row"><span>Subtotal:</span><span>${parseFloat(invoice.subtotal).toFixed(2)} ${invoice.currency}</span></div>
        <div class="totals-row"><span>Tax:</span><span>${parseFloat(invoice.tax).toFixed(2)} ${invoice.currency}</span></div>
        <div class="totals-row total"><span>Total:</span><span>${parseFloat(invoice.total).toFixed(2)} ${invoice.currency}</span></div>
      </div>
    </body></html>`;
  }

  private async generateInvoiceNumber(billingAccountId: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM invoices WHERE billing_account_id = $1 AND EXTRACT(YEAR FROM created_at) = $2 AND EXTRACT(MONTH FROM created_at) = $3`,
      [billingAccountId, year, month]
    );
    const count = parseInt(result.rows[0].count, 10) + 1;
    return `INV-${year}${month}-${String(count).padStart(4, '0')}`;
  }
}

class AccrualLedgerService {
  private pool: Pool;
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL required');
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async getPeriodSummary(
    billingAccountId: string,
    periodDate: Date,
    publisherId?: string,
    buyerId?: string
  ): Promise<{ total: Decimal; byType: Record<string, Decimal>; count: number }> {
    let sql = `SELECT type, SUM(amount::numeric) as total_amount, COUNT(*) as count FROM accrual_ledger WHERE billing_account_id = $1 AND period_date = $2 AND closed = false`;
    const params: any[] = [billingAccountId, periodDate];
    if (publisherId) {
      sql += ' AND publisher_id = $' + (params.length + 1);
      params.push(publisherId);
    }
    if (buyerId) {
      sql += ' AND buyer_id = $' + (params.length + 1);
      params.push(buyerId);
    }
    sql += ' GROUP BY type';
    const result = await this.pool.query(sql, params);
    const byType: Record<string, Decimal> = {};
    let total = new Decimal(0);
    let count = 0;
    for (const row of result.rows) {
      const amount = new Decimal(row.total_amount);
      byType[row.type] = amount;
      total = total.plus(amount);
      count += parseInt(row.count, 10);
    }
    return { total, byType, count };
  }
}

const invoiceGenerator = new InvoiceGeneratorService();
const accrualLedger = new AccrualLedgerService();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function registerAdminBillingRoutes(fastify: FastifyInstance) {
  // Create/Update Rate Card
  fastify.post<{
    Body: {
      billingAccountId: string;
      name: string;
      rates: {
        inbound?: { perMinute?: number; connectionFee?: number };
        outbound?: { perMinute?: number; connectionFee?: number };
        recording?: { perMinute?: number; perCall?: number };
        cpa?: { amount?: number; triggerEvent?: string };
      };
      effectiveFrom: string;
      effectiveTo?: string;
    };
  }>('/api/v1/admin/billing/rate-cards', async (request, reply) => {
    try {
      const { billingAccountId, name, rates, effectiveFrom, effectiveTo } = request.body;

      const result = await pool.query(
        `INSERT INTO rate_cards (
          id, billing_account_id, name, rates, effective_from, effective_to, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', NOW())
        RETURNING *`,
        [
          `rc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          billingAccountId,
          name,
          JSON.stringify(rates),
          new Date(effectiveFrom),
          effectiveTo ? new Date(effectiveTo) : null,
        ]
      );

      return {
        success: true,
        data: result.rows[0],
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'RATE_CARD_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create rate card',
        },
      };
    }
  });

  // List Rate Cards
  fastify.get('/api/v1/admin/billing/rate-cards', async (request, reply) => {
    const { billingAccountId } = request.query as { billingAccountId?: string };

    let sql = 'SELECT * FROM rate_cards WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (billingAccountId) {
      sql += ` AND billing_account_id = $${paramIndex}`;
      params.push(billingAccountId);
      paramIndex++;
    }

    sql += ' ORDER BY effective_from DESC';

    const result = await pool.query(sql, params);
    return {
      data: result.rows,
    };
  });

  // Close Period and Generate Invoice
  fastify.post<{
    Body: {
      billingAccountId: string;
      periodDate: string;
      dueDate: string;
      publisherId?: string;
      buyerId?: string;
    };
  }>('/api/v1/admin/billing/close-period', async (request, reply) => {
    try {
      const { billingAccountId, periodDate, dueDate, publisherId, buyerId } = request.body;

      const period = new Date(periodDate);
      const due = new Date(dueDate);

      const invoiceId = await invoiceGenerator.generateInvoice(
        billingAccountId,
        period,
        due,
        publisherId,
        buyerId
      );

      return {
        success: true,
        invoiceId,
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'CLOSE_PERIOD_ERROR',
          message: error instanceof Error ? error.message : 'Failed to close period',
        },
      };
    }
  });

  // Get Period Summary
  fastify.get('/api/v1/admin/billing/period-summary', async (request, reply) => {
    const { billingAccountId, periodDate, publisherId, buyerId } = request.query as {
      billingAccountId: string;
      periodDate: string;
      publisherId?: string;
      buyerId?: string;
    };

    if (!billingAccountId || !periodDate) {
      reply.code(400);
      return {
        error: {
          code: 'MISSING_PARAMS',
          message: 'billingAccountId and periodDate are required',
        },
      };
    }

    const period = new Date(periodDate);
    const summary = await accrualLedger.getPeriodSummary(
      billingAccountId,
      period,
      publisherId,
      buyerId
    );

    return {
      periodDate: period.toISOString(),
      total: summary.total.toFixed(4),
      byType: Object.fromEntries(
        Object.entries(summary.byType).map(([k, v]) => [k, v.toFixed(4)])
      ),
      count: summary.count,
    };
  });

  // Generate Invoice PDF
  fastify.get<{ Params: { invoiceId: string } }>(
    '/api/v1/admin/billing/invoices/:invoiceId/pdf',
    async (request, reply) => {
      try {
        const pdf = await invoiceGenerator.generatePDF(request.params.invoiceId);

        reply.type('application/pdf');
        reply.header('Content-Disposition', `attachment; filename="invoice-${request.params.invoiceId}.pdf"`);
        return pdf;
      } catch (error) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'Invoice not found',
          },
        };
      }
    }
  );

  // Create Stripe payout (Connect)
  fastify.post<{
    Body: {
      billingAccountId: string;
      amount: number;
      currency?: string;
    };
  }>('/api/v1/admin/billing/payouts', async (request, reply) => {
    try {
      const { billingAccountId, amount, currency = 'USD' } = request.body;

      // Import StripeService dynamically
      const { StripeService } = await import('../../../worker/src/services/stripe-service.js');
      const stripeService = new StripeService();

      if (!stripeService.isEnabled()) {
        reply.code(400);
        return {
          error: {
            code: 'STRIPE_DISABLED',
            message: 'Stripe integration is not enabled',
          },
        };
      }

      const transferId = await stripeService.createPayout(billingAccountId, amount, currency);

      if (!transferId) {
        reply.code(400);
        return {
          error: {
            code: 'PAYOUT_FAILED',
            message: 'Failed to create payout',
          },
        };
      }

      // Create payout record
      const payoutId = `payout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO payouts (
          id, billing_account_id, amount, currency, status, method, reference, created_at
        ) VALUES ($1, $2, $3, $4, 'PROCESSING', 'stripe_connect', $5, NOW())`,
        [payoutId, billingAccountId, amount.toFixed(2), currency, transferId]
      );

      return {
        success: true,
        payoutId,
        transferId,
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'PAYOUT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create payout',
        },
      };
    }
  });
}

