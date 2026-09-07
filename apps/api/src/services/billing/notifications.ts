/**
 * Telling the agency, and telling NetEnroll.
 *
 * ── The row is the notification ──────────────────────────────────────────────
 *
 * Every notice below is written to `billing_notifications` first and only then
 * handed to a transport. Email and Slack are best-effort on top of the row, so
 * "the agency and platform admins were notified that their settlement failed"
 * is answerable from the database on a night when SMTP was down. `sentVia`
 * records which transports actually accepted it; an empty array is still a
 * record that the notice exists, and the portal renders it either way.
 *
 * ── Once per event, not once per attempt ─────────────────────────────────────
 *
 * `(tenantId, kind, subjectKey)` is unique. The subject key names the thing
 * that happened -- a Delivery Day, a settlement id -- so a delivery gate
 * consulted four hundred times in an afternoon sends one "at the ceiling"
 * notice, and a settlement retried three times does not send three "failed"
 * notices for the same failure. The insert either wins and sends, or loses and
 * returns quietly.
 *
 * ── Who gets it ──────────────────────────────────────────────────────────────
 *
 * The agency's OWNER and ADMIN users, and every holder of the platform
 * capability. Platform recipients come from `platform_admins` joined to their
 * user rows, which is the same capability every cross-agency surface is gated
 * on -- not a hardcoded address list that goes stale the day somebody leaves.
 */

import type { PrismaClient } from '@prisma/client';
import { BillingNotificationKind, Prisma } from '@prisma/client';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';

export interface BillingNotice {
  tenantId: string;
  kind: BillingNotificationKind;
  /** What this is about: a Delivery Day, a settlement id. One notice per key. */
  subjectKey: string;
  subject: string;
  body: string;
  toAgency: boolean;
  toPlatform: boolean;
  detail?: Prisma.InputJsonValue;
}

export interface NotifyResult {
  /** False when a notice for this exact event already existed. */
  written: boolean;
  notificationId: string | null;
  sentVia: string[];
  agencyRecipients: number;
  platformRecipients: number;
}

function transporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  return createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/** The agency's own administrators. */
async function agencyRecipients(prisma: PrismaClient, tenantId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      roles: { some: { role: { name: { in: ['OWNER', 'ADMIN'] } } } },
    },
    select: { email: true },
  });
  return users.map(u => u.email).filter(Boolean);
}

/**
 * NetEnroll staff: every holder of the platform capability.
 *
 * Not an environment variable holding a list of addresses. The capability is
 * already the answer to "who acts for the platform", and a second list would be
 * a second answer that drifts the first time somebody is granted or revoked.
 */
async function platformRecipients(prisma: PrismaClient): Promise<string[]> {
  const admins = await prisma.platformAdmin.findMany({ select: { userId: true } });
  if (admins.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: admins.map(a => a.userId) } },
    select: { email: true },
  });
  return users.map(u => u.email).filter(Boolean);
}

async function sendEmail(to: string[], subject: string, body: string): Promise<boolean> {
  if (to.length === 0) return false;
  const transport = transporter();
  if (!transport) {
    logger.info({ msg: 'Billing notice (no SMTP configured, row written)', to, subject });
    return false;
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || 'noreply@netenroll.com',
    to: to.join(', '),
    subject,
    text: body,
  });
  return true;
}

async function sendSlack(subject: string, body: string): Promise<boolean> {
  const webhook = process.env.BILLING_ALERT_SLACK_WEBHOOK;
  if (!webhook) return false;
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `*${subject}*\n${body}` }),
  });
  return response.ok;
}

/**
 * Record and send one notice.
 *
 * Never throws. A settlement must not fail because a mail server did, and the
 * row -- which is the part that matters -- is written before any transport is
 * touched.
 */
export async function notify(
  notice: BillingNotice,
  options: { prisma?: PrismaClient } = {}
): Promise<NotifyResult> {
  const prisma = options.prisma ?? getPrismaClient();

  const empty: NotifyResult = {
    written: false,
    notificationId: null,
    sentVia: [],
    agencyRecipients: 0,
    platformRecipients: 0,
  };

  let notificationId: string;
  try {
    const row = await prisma.billingNotification.create({
      data: {
        tenantId: notice.tenantId,
        kind: notice.kind,
        subjectKey: notice.subjectKey,
        subject: notice.subject,
        body: notice.body,
        toAgency: notice.toAgency,
        toPlatform: notice.toPlatform,
        detail: notice.detail,
        sentVia: [],
      },
      select: { id: true },
    });
    notificationId = row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Already told them about this exact event.
      return empty;
    }
    logger.error({ msg: 'Failed to record billing notification', error, notice: notice.kind });
    return empty;
  }

  const [agency, platform] = await Promise.all([
    notice.toAgency ? agencyRecipients(prisma, notice.tenantId) : Promise.resolve([]),
    notice.toPlatform ? platformRecipients(prisma) : Promise.resolve([]),
  ]);

  const sentVia: string[] = [];

  try {
    if (await sendEmail([...agency, ...platform], notice.subject, notice.body)) {
      sentVia.push('email');
    }
  } catch (error) {
    logger.error({ msg: 'Billing notification email failed', error, notificationId });
  }

  try {
    if (notice.toPlatform && (await sendSlack(notice.subject, notice.body))) {
      sentVia.push('slack');
    }
  } catch (error) {
    logger.error({ msg: 'Billing notification Slack post failed', error, notificationId });
  }

  if (sentVia.length > 0) {
    await prisma.billingNotification
      .update({ where: { id: notificationId }, data: { sentVia } })
      .catch((error: unknown) => {
        logger.error({ msg: 'Could not record notification transports', error, notificationId });
      });
  }

  return {
    written: true,
    notificationId,
    sentVia,
    agencyRecipients: agency.length,
    platformRecipients: platform.length,
  };
}

export { BillingNotificationKind };
