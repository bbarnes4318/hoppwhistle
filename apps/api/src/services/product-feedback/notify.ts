/**
 * Telling people what happened to the thing they asked for.
 *
 * ── What is sent, and to whom ────────────────────────────────────────────────
 *
 * The submitter hears about every step the product team takes in public: a
 * status that means something to them (planned, started, released, a question
 * for them, a decision not to build it), a public update, and a merge. People
 * who said "I want this too" hear only when it ships -- one email for the
 * thing they wanted, not a stream.
 *
 * Each recipient gets their own agency's letterhead (`emailBrandForTenant`), so
 * a Life Leads Plus agent reads a Life Leads Plus email that says "the product
 * team" and links to their own portal. Nothing names the platform underneath.
 *
 * ── Best-effort ──────────────────────────────────────────────────────────────
 *
 * The request and its thread are the record; this is the nudge. It never
 * throws and answers how many people it reached, zero when SMTP is not
 * configured. The same transport and letterhead as `upgrade-request-email.ts`.
 * Inside Feedback & Roadmap the "New update" marker is the in-app signal and
 * does not depend on any of this.
 */

import { FEEDBACK_STATUS_LABELS, type FeedbackStatus } from '@hopwhistle/shared';
import { createTransport } from 'nodemailer';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { emailBrandForTenant } from '../email-brand.js';
import { escapeHtml, renderEmail } from '../publisher-email.js';

function transporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  return createTransport({
    host,
    port,
    // TLS is required, not opportunistic. See services/agent-invite-email.ts.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  });
}

/** The statuses whose arrival the submitter is emailed about. */
export const NOTIFY_STATUSES: readonly FeedbackStatus[] = [
  'NEEDS_INFO',
  'PLANNED',
  'IN_PROGRESS',
  'SHIPPED',
  'NOT_PLANNED',
];

const STATUS_SENTENCE: Partial<Record<FeedbackStatus, string>> = {
  NEEDS_INFO: 'The product team has a question about your feedback.',
  PLANNED: 'Your feedback is now planned.',
  IN_PROGRESS: 'Development has started on your feedback.',
  SHIPPED: 'Something you asked for has been released.',
  NOT_PLANNED: 'The product team has made a decision about your feedback.',
};

/** Most people a single ship email goes to: a backstop, not a policy. */
const MAX_RECIPIENTS = 500;

export type FeedbackNotice =
  | { kind: 'STATUS'; status: FeedbackStatus; message?: string | null }
  | { kind: 'UPDATE'; headline?: string | null; body: string }
  | { kind: 'MERGED'; intoTitle: string };

/**
 * Email the submitter (and, when it ships, everybody interested) about one
 * request. Answers how many people were emailed.
 */
export async function notifyFeedbackFollowers(
  feedbackId: string,
  notice: FeedbackNotice
): Promise<number> {
  try {
    const transport = transporter();
    if (!transport) return 0;

    const prisma = getPrismaClient();
    const item = await prisma.productFeedback.findUnique({
      where: { id: feedbackId },
      select: {
        id: true,
        title: true,
        publicTitle: true,
        submittedBy: { select: { id: true, email: true, status: true, tenantId: true } },
      },
    });
    if (!item) return 0;

    const recipients = new Map<string, { email: string; tenantId: string | null }>();
    const submitter = item.submittedBy;
    if (submitter && submitter.status === 'ACTIVE' && submitter.tenantId) {
      recipients.set(submitter.id, { email: submitter.email, tenantId: submitter.tenantId });
    }
    if (notice.kind === 'STATUS' && notice.status === 'SHIPPED') {
      const votes = await prisma.productFeedbackVote.findMany({
        where: { feedbackId, user: { status: 'ACTIVE' } },
        select: { user: { select: { id: true, email: true, tenantId: true } } },
        take: MAX_RECIPIENTS,
      });
      for (const { user } of votes) {
        if (user.tenantId) recipients.set(user.id, { email: user.email, tenantId: user.tenantId });
      }
    }
    if (recipients.size === 0) return 0;

    const title = item.publicTitle ?? item.title;
    const byTenant = new Map<string, string[]>();
    for (const { email, tenantId } of recipients.values()) {
      const key = tenantId ?? '';
      byTenant.set(key, [...(byTenant.get(key) ?? []), email]);
    }

    let sent = 0;
    for (const [tenantId, emails] of byTenant) {
      const brand = await emailBrandForTenant(tenantId || null);
      const link = `${brand.linkBase}/feedback?item=${encodeURIComponent(item.id)}`;
      const { subject, lead, detail } = wording(notice, title);
      const text = `${lead}\n\n"${title}"\n${detail ? `\n${detail}\n` : ''}\nFollow it in Feedback & Roadmap:\n${link}\n\nKind regards,\n${brand.signOff}`;
      const html = renderEmail({
        brand,
        title: subject,
        body: `<p>${escapeHtml(lead)}</p>
<p style="margin:12px 0;padding:12px 14px;background:#f6f5f2;border-radius:6px;font-weight:600;">${escapeHtml(title)}</p>
${detail ? `<p style="white-space:pre-line;color:#3b3934;">${escapeHtml(detail)}</p>` : ''}
<p style="margin:20px 0;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#171614;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">View in Feedback &amp; Roadmap</a>
</p>`,
      });
      // One message per recipient: a voter's address is nobody else's business.
      for (const to of emails) {
        await transport.sendMail({ from: brand.from, to, subject, text, html });
        sent++;
      }
    }
    return sent;
  } catch (error) {
    logger.error({ msg: 'Feedback notification could not be sent', feedbackId, error });
    return 0;
  }
}

function wording(
  notice: FeedbackNotice,
  title: string
): { subject: string; lead: string; detail: string | null } {
  if (notice.kind === 'UPDATE') {
    return {
      subject: `Product team update: ${title}`,
      lead: 'The product team posted an update on your feedback.',
      detail: [notice.headline, notice.body].filter(Boolean).join('\n\n'),
    };
  }
  if (notice.kind === 'MERGED') {
    return {
      subject: `Your feedback was combined: ${title}`,
      lead: `Your feedback was combined with a similar request, "${notice.intoTitle}". You will follow that one from now on.`,
      detail: null,
    };
  }
  return {
    subject: `${FEEDBACK_STATUS_LABELS[notice.status]}: ${title}`,
    lead:
      STATUS_SENTENCE[notice.status] ??
      `Your feedback is now ${FEEDBACK_STATUS_LABELS[notice.status]}.`,
    detail: notice.message ?? null,
  };
}
