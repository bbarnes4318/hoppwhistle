/**
 * A prepaid buyer asking its agency for credit.
 *
 * There is no self-serve payment on this platform: a buyer's wallet is credited
 * by the agency (`POST /api/v1/buyers/:buyerId/credits`). The billing page used
 * to leave the asking to the buyer -- it composed a sentence and offered to copy
 * it -- so the request went wherever the buyer happened to paste it, if
 * anywhere. This sends it to the people who can act on it: the agency's OWNER
 * users, by email, in the agency's brand.
 *
 * The transport is the one every other message here uses (nodemailer over the
 * SMTP_* settings, as `password-reset.ts` and `agent-invite-email.ts` build it),
 * and the letterhead is `emailBrandForTenant`, so a white-label agency's owner
 * reads its own product's name.
 */

import { createTransport } from 'nodemailer';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { emailBrandForTenant } from './email-brand.js';
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

/** The agency's owners: the people who credit a buyer's wallet. */
export async function tenantOwnerEmails(tenantId: string): Promise<string[]> {
  const owners = await getPrismaClient().user.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      roles: { some: { role: { name: 'OWNER' } } },
    },
    select: { email: true },
  });
  return owners.map(o => o.email).filter(Boolean);
}

function dollars(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/**
 * Email the agency's owners that a buyer wants its wallet topped up.
 *
 * Returns how many owners the message went to: zero when SMTP is not
 * configured, the agency has no active owner, or the send failed. Never throws;
 * the caller decides what zero means to the buyer.
 */
export async function sendTopUpRequestEmail(params: {
  tenantId: string;
  buyerId: string;
  buyerName: string;
  amount: number;
  walletBalance: number;
  requestedBy: string | null;
}): Promise<number> {
  const recipients = await tenantOwnerEmails(params.tenantId);
  if (recipients.length === 0) {
    logger.warn({ msg: 'Top-up request not emailed: agency has no owner', ...params });
    return 0;
  }

  const transport = transporter();
  if (!transport) {
    logger.info({ msg: 'Top-up request not emailed: SMTP is not configured', ...params });
    return 0;
  }

  const brand = await emailBrandForTenant(params.tenantId);
  const amount = dollars(params.amount);
  const balance = dollars(params.walletBalance);
  const who = params.requestedBy ? ` (${params.requestedBy})` : '';
  const link = `${brand.linkBase}/billing`;

  const text = `${params.buyerName}${who} has asked for ${amount} to be added to their prepaid balance.

Their balance is ${balance} right now.

Credit their wallet from Billing in ${brand.productName}:
${link}

Kind regards,
${brand.signOff}`;

  const html = renderEmail({
    brand,
    title: `Top-up requested: ${params.buyerName}`,
    body: `<p><strong>${escapeHtml(params.buyerName)}</strong>${escapeHtml(who)} has asked for <strong>${escapeHtml(amount)}</strong> to be added to their prepaid balance.</p>
<p style="color:#55524b;">Their balance is ${escapeHtml(balance)} right now.</p>
<p style="margin:20px 0;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Open Billing</a>
</p>`,
  });

  try {
    await transport.sendMail({
      from: brand.from,
      to: recipients.join(', '),
      subject: `${params.buyerName} requested a ${amount} top-up`,
      text,
      html,
    });
    return recipients.length;
  } catch (error) {
    logger.error({
      msg: 'Top-up request email could not be sent',
      tenantId: params.tenantId,
      buyerId: params.buyerId,
      err: error,
    });
    return 0;
  }
}
