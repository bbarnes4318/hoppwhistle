import { getPrismaClient } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { BudgetAlertType } from '@prisma/client';

interface AlertData {
  threshold: number;
  actual: number;
  current: number;
  limit: number;
}

/**
 * Budget Alert Service
 * 
 * Sends budget alerts via email and Slack webhooks when thresholds are exceeded.
 */
export class BudgetAlertService {
  /**
   * Send budget alert
   */
  async sendAlert(
    tenantId: string,
    budgetId: string,
    type: BudgetAlertType,
    data: AlertData
  ): Promise<void> {
    const prisma = getPrismaClient();

    const budget = await prisma.tenantBudget.findUnique({
      where: { id: budgetId },
      include: { tenant: true },
    });

    if (!budget) {
      return;
    }

    const sentVia: string[] = [];

    // Send email alerts
    if (budget.alertEmails && budget.alertEmails.length > 0) {
      try {
        await this.sendEmailAlert(budget.alertEmails, tenantId, type, data, budget.tenant.name);
        sentVia.push('email');
      } catch (error) {
        logger.error({ msg: 'Failed to send email alert', error, tenantId });
      }
    }

    // Send Slack alert
    if (budget.alertSlackWebhook) {
      try {
        await this.sendSlackAlert(budget.alertSlackWebhook, tenantId, type, data, budget.tenant.name);
        sentVia.push('slack');
      } catch (error) {
        logger.error({ msg: 'Failed to send Slack alert', error, tenantId });
      }
    }

    // Record alert in database
    await prisma.budgetAlert.create({
      data: {
        tenantId,
        budgetId,
        type,
        threshold: data.threshold,
        actual: data.actual,
        sentVia,
        metadata: {
          current: data.current,
          limit: data.limit,
        },
      },
    });

    // Update budget last alert time
    await prisma.tenantBudget.update({
      where: { id: budgetId },
      data: {
        lastAlertSentAt: new Date(),
        lastAlertType: type,
      },
    });

    logger.info({
      msg: 'Budget alert sent',
      tenantId,
      type,
      sentVia,
      threshold: data.threshold,
      actual: data.actual,
    });
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(
    emails: string[],
    tenantId: string,
    type: BudgetAlertType,
    data: AlertData,
    tenantName: string
  ): Promise<void> {
    // In production, integrate with email service (SendGrid, SES, etc.)
    // For now, log the email content
    const subject = this.getAlertSubject(type, data);
    const body = this.getAlertBody(tenantName, type, data);

    logger.info({
      msg: 'Email alert (simulated)',
      to: emails,
      subject,
      body,
    });

    // TODO: Integrate with actual email service
    // await emailService.send({
    //   to: emails,
    //   subject,
    //   html: body,
    // });
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(
    webhookUrl: string,
    tenantId: string,
    type: BudgetAlertType,
    data: AlertData,
    tenantName: string
  ): Promise<void> {
    const color = data.actual >= 100 ? 'danger' : data.actual >= 90 ? 'warning' : 'good';
    const emoji = data.actual >= 100 ? '🚨' : data.actual >= 90 ? '⚠️' : '💡';

    const payload = {
      text: `${emoji} Budget Alert: ${tenantName}`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Alert Type',
              value: this.getAlertTypeLabel(type),
              short: true,
            },
            {
              title: 'Current Spend',
              value: `$${data.current.toFixed(2)}`,
              short: true,
            },
            {
              title: 'Budget Limit',
              value: `$${data.limit.toFixed(2)}`,
              short: true,
            },
            {
              title: 'Percentage',
              value: `${data.actual.toFixed(1)}%`,
              short: true,
            },
            {
              title: 'Tenant ID',
              value: tenantId,
              short: false,
            },
          ],
          footer: 'Hopwhistle Budget Alert',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.statusText}`);
      }
    } catch (error) {
      logger.error({ msg: 'Slack webhook error', error, webhookUrl });
      throw error;
    }
  }

  private getAlertSubject(type: BudgetAlertType, data: AlertData): string {
    const prefix = data.actual >= 100 ? '🚨 URGENT: ' : '⚠️ ';
    return `${prefix}Budget ${this.getAlertTypeLabel(type)} - ${data.actual.toFixed(1)}%`;
  }

  private getAlertBody(tenantName: string, type: BudgetAlertType, data: AlertData): string {
    return `
      <h2>Budget Alert: ${tenantName}</h2>
      <p><strong>Alert Type:</strong> ${this.getAlertTypeLabel(type)}</p>
      <p><strong>Current Spend:</strong> $${data.current.toFixed(2)}</p>
      <p><strong>Budget Limit:</strong> $${data.limit.toFixed(2)}</p>
      <p><strong>Percentage:</strong> ${data.actual.toFixed(1)}%</p>
      ${data.actual >= 100 ? '<p><strong style="color: red;">Budget exceeded! Service may be restricted.</strong></p>' : ''}
    `;
  }

  private getAlertTypeLabel(type: BudgetAlertType): string {
    switch (type) {
      case 'DAILY_THRESHOLD':
        return 'Daily Budget Threshold';
      case 'DAILY_EXCEEDED':
        return 'Daily Budget Exceeded';
      case 'MONTHLY_THRESHOLD':
        return 'Monthly Budget Threshold';
      case 'MONTHLY_EXCEEDED':
        return 'Monthly Budget Exceeded';
      default:
        return 'Budget Alert';
    }
  }
}

export const budgetAlertService = new BudgetAlertService();

