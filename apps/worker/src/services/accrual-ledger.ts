import { Decimal } from 'decimal.js';
import { Pool } from 'pg';

import { logger } from '../logger.js';

export interface AccrualEntry {
  tenantId: string;
  billingAccountId: string;
  publisherId?: string;
  buyerId?: string;
  callId?: string;
  type: 'CALL_MINUTE_INBOUND' | 'CALL_MINUTE_OUTBOUND' | 'CONNECTION_FEE' | 'RECORDING_FEE' | 'CPA_CONVERSION' | 'TAX' | 'ADJUSTMENT';
  amount: Decimal;
  currency: string;
  description: string;
  periodDate: Date;
  metadata?: Record<string, unknown>;
}

export class AccrualLedgerService {
  private pool: Pool;

  constructor() {
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
   * Create an accrual entry
   */
  async createEntry(entry: AccrualEntry): Promise<string> {
    const client = await this.pool.connect();
    const entryId = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      await client.query(
        `INSERT INTO accrual_ledger (
          id, tenant_id, billing_account_id, publisher_id, buyer_id, call_id,
          type, amount, currency, description, period_date, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [
          entryId,
          entry.tenantId,
          entry.billingAccountId,
          entry.publisherId || null,
          entry.buyerId || null,
          entry.callId || null,
          entry.type,
          entry.amount.toFixed(4),
          entry.currency,
          entry.description,
          entry.periodDate,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ]
      );

      logger.info(`Created accrual entry ${entryId} for ${entry.type}: ${entry.amount}`);
      return entryId;
    } catch (error) {
      logger.error('Error creating accrual entry:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get unclosed accruals for a period
   */
  async getUnclosedAccruals(
    billingAccountId: string,
    periodDate: Date,
    publisherId?: string,
    buyerId?: string
  ): Promise<Array<{
    id: string;
    type: string;
    amount: string;
    description: string;
    callId?: string;
  }>> {
    let sql = `
      SELECT id, type, amount, description, call_id
      FROM accrual_ledger
      WHERE billing_account_id = $1
        AND period_date = $2
        AND closed = false
    `;

    const params: any[] = [billingAccountId, periodDate];
    let paramIndex = 3;

    if (publisherId) {
      sql += ` AND publisher_id = $${paramIndex}`;
      params.push(publisherId);
      paramIndex++;
    }

    if (buyerId) {
      sql += ` AND buyer_id = $${paramIndex}`;
      params.push(buyerId);
      paramIndex++;
    }

    sql += ` ORDER BY created_at ASC`;

    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Close accruals for a period (mark as closed and assign to invoice)
   */
  async closePeriod(
    billingAccountId: string,
    periodDate: Date,
    invoiceId: string,
    publisherId?: string,
    buyerId?: string
  ): Promise<number> {
    let sql = `
      UPDATE accrual_ledger
      SET closed = true, closed_at = NOW(), invoice_id = $1, updated_at = NOW()
      WHERE billing_account_id = $2
        AND period_date = $3
        AND closed = false
    `;

    const params: any[] = [invoiceId, billingAccountId, periodDate];
    let paramIndex = 4;

    if (publisherId) {
      sql += ` AND publisher_id = $${paramIndex}`;
      params.push(publisherId);
      paramIndex++;
    }

    if (buyerId) {
      sql += ` AND buyer_id = $${paramIndex}`;
      params.push(buyerId);
      paramIndex++;
    }

    const result = await this.pool.query(sql, params);
    logger.info(`Closed ${result.rowCount} accrual entries for period ${periodDate.toISOString()}`);
    return result.rowCount || 0;
  }

  /**
   * Get summary totals for a period
   */
  async getPeriodSummary(
    billingAccountId: string,
    periodDate: Date,
    publisherId?: string,
    buyerId?: string
  ): Promise<{
    total: Decimal;
    byType: Record<string, Decimal>;
    count: number;
  }> {
    let sql = `
      SELECT type, SUM(amount::numeric) as total_amount, COUNT(*) as count
      FROM accrual_ledger
      WHERE billing_account_id = $1
        AND period_date = $2
        AND closed = false
    `;

    const params: any[] = [billingAccountId, periodDate];
    let paramIndex = 3;

    if (publisherId) {
      sql += ` AND publisher_id = $${paramIndex}`;
      params.push(publisherId);
      paramIndex++;
    }

    if (buyerId) {
      sql += ` AND buyer_id = $${paramIndex}`;
      params.push(buyerId);
      paramIndex++;
    }

    sql += ` GROUP BY type`;

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

