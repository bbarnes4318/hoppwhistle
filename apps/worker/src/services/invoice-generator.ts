import { Decimal } from 'decimal.js';
import { Pool } from 'pg';
import { launch } from 'puppeteer';

import { logger } from '../logger.js';

import { AccrualLedgerService } from './accrual-ledger.js';
import { StripeService } from './stripe-service.js';

export interface InvoiceData {
  invoiceNumber: string;
  billingAccountId: string;
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  lines: Array<{
    description: string;
    quantity: Decimal;
    unitPrice: Decimal;
    total: Decimal;
    metadata?: Record<string, unknown>;
  }>;
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
  currency: string;
  metadata?: Record<string, unknown>;
}

interface InvoiceRow {
  tenant_name?: string;
  account_name: string;
  invoice_number: string;
  status: string;
  period_start: string | number | Date;
  period_end: string | number | Date;
  due_date: string | number | Date;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
}

interface InvoiceLineRow {
  description: string;
  quantity: string;
  unit_price: string;
  total: string;
}

export class InvoiceGeneratorService {
  private pool: Pool;
  private accrualLedger: AccrualLedgerService;
  private stripeService: StripeService;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    });

    this.accrualLedger = new AccrualLedgerService();
    this.stripeService = new StripeService();
  }

  /**
   * Generate invoice from accruals for a period
   */
  async generateInvoice(
    billingAccountId: string,
    periodDate: Date,
    dueDate: Date,
    publisherId?: string,
    buyerId?: string
  ): Promise<string> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get accruals for period
      const accruals = await this.accrualLedger.getUnclosedAccruals(
        billingAccountId,
        periodDate,
        publisherId,
        buyerId
      );

      if (accruals.length === 0) {
        throw new Error('No accruals found for period');
      }

      // Get billing account info
      const accountResult = await client.query(
        'SELECT "tenantId" AS tenant_id, currency FROM billing_accounts WHERE id = $1',
        [billingAccountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Billing account not found');
      }

      // const { tenant_id, currency } = accountResult.rows[0];

      // Calculate totals
      const lines = accruals.map((accrual) => {
        const amount = new Decimal(accrual.amount);
        return {
          description: accrual.description,
          quantity: new Decimal(1),
          unitPrice: amount,
          total: amount,
          metadata: { type: accrual.type, callId: accrual.callId },
        };
      });

      const subtotal = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
      
      // Tax placeholder (calculate based on tenant settings or metadata)
      const taxRate = new Decimal(0); // TODO: Get from tenant/billing account settings
      const tax = subtotal.mul(taxRate);
      
      const total = subtotal.plus(tax);

      // Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber(billingAccountId);

      // Create invoice
      const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const periodStart = new Date(periodDate);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodDate);
      periodEnd.setHours(23, 59, 59, 999);

      await client.query(
        `INSERT INTO invoices (
          id, "billingAccountId", "invoiceNumber", status, "periodStart", "periodEnd",
          subtotal, tax, total, "dueDate", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          invoiceId,
          billingAccountId,
          invoiceNumber,
          'DRAFT',
          periodStart,
          periodEnd,
          subtotal.toFixed(2),
          tax.toFixed(2),
          total.toFixed(2),
          dueDate,
        ]
      );

      // Create invoice lines
      for (const line of lines) {
        await client.query(
          `INSERT INTO invoice_lines (
            id, "invoiceId", description, quantity, "unitPrice", total, metadata, "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            `line_${invoiceId}_${Math.random().toString(36).substr(2, 9)}`,
            invoiceId,
            line.description,
            line.quantity.toFixed(2),
            line.unitPrice.toFixed(4),
            line.total.toFixed(2),
            line.metadata ? JSON.stringify(line.metadata) : null,
          ]
        );
      }

      // Close accruals
      await this.accrualLedger.closePeriod(
        billingAccountId,
        periodDate,
        invoiceId,
        publisherId,
        buyerId
      );

      // Create Stripe invoice if enabled
      if (this.stripeService.isEnabled()) {
        try {
          const stripeInvoiceId = await this.stripeService.createStripeInvoice(invoiceId);
          if (stripeInvoiceId) {
            logger.info(`Created Stripe invoice ${stripeInvoiceId} for invoice ${invoiceId}`);
          }
        } catch (error) {
          logger.error('Failed to create Stripe invoice (continuing anyway):', error);
        }
      }

      await client.query('COMMIT');

      logger.info(`Generated invoice ${invoiceNumber} (${invoiceId}) for period ${periodDate.toISOString()}`);
      return invoiceId;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error generating invoice:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Generate PDF for invoice
   */
  async generatePDF(invoiceId: string): Promise<Buffer> {
    const client = await this.pool.connect();

    try {
      // Get invoice data
      const invoiceResult = await client.query(
        `SELECT i.id,
                i."invoiceNumber" AS invoice_number,
                i.status,
                i."periodStart"   AS period_start,
                i."periodEnd"     AS period_end,
                i."dueDate"       AS due_date,
                i.subtotal, i.tax, i.total,
                ba.name AS account_name, ba.currency,
                t.name  AS tenant_name
         FROM invoices i
         JOIN billing_accounts ba ON ba.id = i."billingAccountId"
         JOIN tenants t ON t.id = ba."tenantId"
         WHERE i.id = $1`,
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        throw new Error('Invoice not found');
      }

      const invoice = invoiceResult.rows[0] as InvoiceRow;

      // Get invoice lines
      const linesResult = await client.query(
        'SELECT description, quantity, "unitPrice" AS unit_price, total FROM invoice_lines WHERE "invoiceId" = $1 ORDER BY "createdAt"',
        [invoiceId]
      );

      const lines = linesResult.rows as InvoiceLineRow[];

      // Generate HTML
      const html = this.generateInvoiceHTML(invoice, lines);

      // Generate PDF using Puppeteer
      const browser = await launch({
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

  /**
   * Generate invoice HTML template
   */
  private generateInvoiceHTML(invoice: InvoiceRow, lines: InvoiceLineRow[]): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 12px;
      color: #333;
      margin: 0;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
    }
    .invoice-info {
      text-align: right;
    }
    .invoice-number {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 10px;
    }
    .details {
      margin-bottom: 30px;
    }
    .details-row {
      display: flex;
      margin-bottom: 10px;
    }
    .details-label {
      font-weight: bold;
      width: 150px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th {
      background-color: #f0f0f0;
      padding: 10px;
      text-align: left;
      border-bottom: 2px solid #333;
    }
    td {
      padding: 10px;
      border-bottom: 1px solid #ddd;
    }
    .text-right {
      text-align: right;
    }
    .totals {
      margin-left: auto;
      width: 300px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
    }
    .totals-row.total {
      font-weight: bold;
      font-size: 16px;
      border-top: 2px solid #333;
      padding-top: 10px;
      margin-top: 10px;
    }
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 10px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${invoice.tenant_name || 'Hopwhistle'}</h1>
      <div>Billing Account: ${invoice.account_name}</div>
    </div>
    <div class="invoice-info">
      <div class="invoice-number">Invoice ${invoice.invoice_number}</div>
      <div>Status: ${invoice.status}</div>
    </div>
  </div>

  <div class="details">
    <div class="details-row">
      <div class="details-label">Period:</div>
      <div>${new Date(invoice.period_start).toLocaleDateString()} - ${new Date(invoice.period_end).toLocaleDateString()}</div>
    </div>
    <div class="details-row">
      <div class="details-label">Due Date:</div>
      <div>${new Date(invoice.due_date).toLocaleDateString()}</div>
    </div>
    <div class="details-row">
      <div class="details-label">Currency:</div>
      <div>${invoice.currency}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="text-right">Quantity</th>
        <th class="text-right">Unit Price</th>
        <th class="text-right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map(line => `
        <tr>
          <td>${line.description}</td>
          <td class="text-right">${parseFloat(line.quantity).toFixed(2)}</td>
          <td class="text-right">${parseFloat(line.unit_price).toFixed(4)}</td>
          <td class="text-right">${parseFloat(line.total).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <span>Subtotal:</span>
      <span>${parseFloat(invoice.subtotal).toFixed(2)} ${invoice.currency}</span>
    </div>
    <div class="totals-row">
      <span>Tax:</span>
      <span>${parseFloat(invoice.tax).toFixed(2)} ${invoice.currency}</span>
    </div>
    <div class="totals-row total">
      <span>Total:</span>
      <span>${parseFloat(invoice.total).toFixed(2)} ${invoice.currency}</span>
    </div>
  </div>

  <div class="footer">
    <p>This is an automatically generated invoice. For questions, please contact support.</p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Generate unique invoice number
   */
  private async generateInvoiceNumber(billingAccountId: string): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get count of invoices for this account this month
    const result = await this.pool.query(
      `SELECT COUNT(*) as count
       FROM invoices
       WHERE billing_account_id = $1
         AND EXTRACT(YEAR FROM created_at) = $2
         AND EXTRACT(MONTH FROM created_at) = $3`,
      [billingAccountId, year, month]
    );

    const countRow = result.rows[0] as { count: string };
    const count = parseInt(countRow.count, 10) + 1;
    return `INV-${year}${month}-${String(count).padStart(4, '0')}`;
  }
}

