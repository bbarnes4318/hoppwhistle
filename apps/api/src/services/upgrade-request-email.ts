/**
 * An agency asking for a paid upgrade, emailed to whoever can turn it on.
 *
 * ── Who ──────────────────────────────────────────────────────────────────────
 *
 * A downline agency (`parentTenantId` set) buys its upgrades from the
 * white-label agency above it, so the request goes to the PARENT's OWNER
 * users, in the parent's brand, linking to that child's page under
 * /network/agencies. Every other agency buys from NetEnroll, so it goes to
 * every platform admin, in NetEnroll's look, linking to Admin -> Agencies.
 *
 * ── Best-effort ──────────────────────────────────────────────────────────────
 *
 * The request row is the record; this is only the nudge. Same transport and
 * letterhead as `buyer-top-up-request.ts`, and like it this never throws: it
 * answers how many people the message went to, zero when there was nobody to
 * send to, SMTP is not configured, or the send failed.
 */

import { createTransport } from 'nodemailer';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { tenantOwnerEmails } from './buyer-top-up-request.js';
import { appUrl, emailBrandForTenant, netEnrollEmailBrand } from './email-brand.js';
import { escapeHtml, renderEmail } from './publisher-email.js';

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

/** Every active platform admin's address: NetEnroll staff. */
export async function platformAdminEmails(): Promise<string[]> {
  const admins = await getPrismaClient().platformAdmin.findMany({
    where: { user: { status: 'ACTIVE' } },
    select: { user: { select: { email: true } } },
  });
  return admins.map(a => a.user.email).filter(Boolean);
}

function dollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** "$99.00/month and $250.00 setup", or null when neither price is set. */
export function priceLine(monthlyCents: number | null, setupCents: number | null): string | null {
  const parts: string[] = [];
  if (monthlyCents !== null) parts.push(`${dollars(monthlyCents)}/month`);
  if (setupCents !== null) parts.push(`${dollars(setupCents)} setup`);
  return parts.length > 0 ? parts.join(' and ') : null;
}

export async function sendUpgradeRequestEmail(params: {
  tenantId: string;
  tenantName: string;
  parentTenantId: string | null;
  upgradeKey: string;
  upgradeName: string;
  requestedBy: string | null;
  monthlyCents: number | null;
  setupCents: number | null;
}): Promise<number> {
  try {
    const toParent = params.parentTenantId !== null;
    const recipients = toParent
      ? await tenantOwnerEmails(params.parentTenantId as string)
      : await platformAdminEmails();
    if (recipients.length === 0) {
      logger.warn({ msg: 'Upgrade request not emailed: nobody to send it to', ...params });
      return 0;
    }

    const transport = transporter();
    if (!transport) {
      logger.info({ msg: 'Upgrade request not emailed: SMTP is not configured', ...params });
      return 0;
    }

    const brand = toParent
      ? await emailBrandForTenant(params.parentTenantId)
      : netEnrollEmailBrand();
    const link = toParent
      ? `${brand.linkBase}/network/agencies/${params.tenantId}`
      : `${appUrl()}/admin/agencies`;
    const where = toParent ? 'their page under Agencies' : 'Admin -> Agencies';
    const who = params.requestedBy ? ` (${params.requestedBy})` : '';
    const price = priceLine(params.monthlyCents, params.setupCents);

    const text = `${params.tenantName}${who} has asked for ${params.upgradeName}.
${price ? `\nPrice: ${price}.\n` : ''}
Turn it on from ${where} in ${brand.productName}:
${link}

Kind regards,
${brand.signOff}`;

    const html = renderEmail({
      brand,
      title: `Upgrade requested: ${params.upgradeName}`,
      body: `<p><strong>${escapeHtml(params.tenantName)}</strong>${escapeHtml(who)} has asked for <strong>${escapeHtml(params.upgradeName)}</strong>.</p>
${price ? `<p style="color:#55524b;">Price: ${escapeHtml(price)}.</p>` : ''}
<p style="margin:20px 0;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Turn it on</a>
</p>`,
    });

    await transport.sendMail({
      from: brand.from,
      to: recipients.join(', '),
      subject: `Upgrade requested: ${params.upgradeName} — ${params.tenantName}`,
      text,
      html,
    });
    return recipients.length;
  } catch (error) {
    logger.error({
      msg: 'Upgrade request email could not be sent',
      tenantId: params.tenantId,
      upgradeKey: params.upgradeKey,
      err: error,
    });
    return 0;
  }
}
