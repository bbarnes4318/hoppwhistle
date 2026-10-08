import { createTransport } from 'nodemailer';

import { logger } from '../lib/logger.js';

import { emailBrandForTenant, netEnrollEmailBrand, type EmailBrand } from './email-brand.js';

/**
 * Publisher Email Service
 * Handles sending welcome and notification emails to publishers
 */

interface WelcomeEmailPayload {
  email: string;
  publisherName: string;
  publisherId: string;
  accessToRecordings: boolean;
  /** The agency the publisher was added to. Decides the brand. */
  tenantId?: string | null;
  /** Its display name, for the body. */
  agencyName?: string | null;
}

// Create a transporter using environment variables if set
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (host && user && pass) {
    return createTransport({
      host,
      port,
      // TLS is required, not opportunistic. See services/agent-invite-email.ts.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: {
        user,
        pass,
      },
    });
  }
  return null;
}

/**
 * Tells a publisher they have been added to an agency's call network.
 *
 * It does NOT give them a login. A publisher record is the party that sends
 * calls; a person signing in to see them is a separate act -- a portal-access
 * invitation, which sends its own activation link. So this says "you have been
 * added", never "sign in".
 *
 * Branded as the agency (`services/email-brand.ts`). Throws on an SMTP failure;
 * the caller decides whether that matters (publisher creation does not).
 */
export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void> {
  const { email, publisherName, publisherId, accessToRecordings } = payload;
  const brand = payload.tenantId
    ? await emailBrandForTenant(payload.tenantId)
    : netEnrollEmailBrand();
  const agency = payload.agencyName?.trim() || brand.productName;

  const subject = `You've been added as a publisher with ${agency}`;
  const text = `Hello ${publisherName},

You've been added as a publisher with ${agency} on ${brand.productName}.

Account details:
  - Publisher ID: ${publisherId}
  - Access to recordings: ${accessToRecordings ? 'Enabled' : 'Disabled'}

Your Publisher ID identifies the calls you send. Use it when you ping and post,
and every call will be reported back against it, along with what each one
earned. If you are given access to the publisher portal, you will receive a
separate invitation to set up your sign-in.

If anything looks wrong, please reply to this message and we will look into it.

Kind regards,
${brand.signOff}`;

  const html = renderEmail({
    brand,
    title: "You've been added as a publisher",
    body: `<p>Hello <strong>${escapeHtml(publisherName)}</strong>,</p>
<p>You've been added as a publisher with <strong>${escapeHtml(agency)}</strong> on ${escapeHtml(brand.productName)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 16px 6px 0;color:#55524b;">Publisher ID</td><td style="padding:6px 0;font-family:'IBM Plex Mono',SFMono-Regular,Menlo,monospace;color:#171614;">${escapeHtml(publisherId)}</td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#55524b;">Access to recordings</td><td style="padding:6px 0;color:#171614;">${accessToRecordings ? 'Enabled' : 'Disabled'}</td></tr>
</table>
<p>Your Publisher ID identifies the calls you send. Use it when you ping and post,
and every call will be reported back against it, along with what each one
earned. If you are given access to the publisher portal, you will receive a
separate invitation to set up your sign-in.</p>
<p>If anything looks wrong, please reply to this message and we will look into it.</p>`,
  });

  const transporter = getTransporter();

  if (transporter) {
    await transporter.sendMail({
      from: brand.from,
      to: email,
      subject,
      text,
      html,
    });
    logger.info({ msg: 'Publisher welcome email sent', email, publisherId });
  } else {
    logger.info({
      msg: 'Publisher welcome email not sent: SMTP is not configured',
      email,
      publisherId,
    });
  }
}

interface CampaignAssignmentEmailPayload {
  email: string;
  publisherName: string;
  /** The publisher's code -- the ID they send calls under. */
  publisherId: string;
  campaignName: string;
  /** What they earn on this campaign, already formatted ("$12.00 per billable call"). */
  payout?: string | null;
  /** The agency the campaign belongs to. Decides the brand. */
  tenantId?: string | null;
  agencyName?: string | null;
}

/**
 * Tells a publisher they have been added to a campaign.
 *
 * Assigning a publisher to a campaign used to write the row and tell nobody:
 * the agency believed it had invited the publisher, and the publisher never
 * heard. Like `sendWelcomeEmail`, this is not a login -- that is a portal-access
 * invitation -- and it throws on an SMTP failure for the caller to handle.
 *
 * Returns whether a transport accepted the message.
 */
export async function sendCampaignAssignmentEmail(
  payload: CampaignAssignmentEmailPayload
): Promise<boolean> {
  const { email, publisherName, publisherId, campaignName, payout } = payload;
  const brand = payload.tenantId
    ? await emailBrandForTenant(payload.tenantId)
    : netEnrollEmailBrand();
  const agency = payload.agencyName?.trim() || brand.productName;

  const subject = `You've been added to the ${campaignName} campaign with ${agency}`;
  const text = `Hello ${publisherName},

${agency} has added you as a publisher on the ${campaignName} campaign.

Campaign details:
  - Campaign: ${campaignName}
  - Publisher ID: ${publisherId}${payout ? `\n  - Payout: ${payout}` : ''}

Send calls for this campaign under your Publisher ID, and every call will be
reported back against it, along with what each one earned.

If anything looks wrong, please reply to this message and we will look into it.

Kind regards,
${brand.signOff}`;

  const row = (label: string, value: string, mono = false) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#55524b;">${label}</td><td style="padding:6px 0;${mono ? "font-family:'IBM Plex Mono',SFMono-Regular,Menlo,monospace;" : ''}color:#171614;">${escapeHtml(value)}</td></tr>`;

  const html = renderEmail({
    brand,
    title: "You've been added to a campaign",
    body: `<p>Hello <strong>${escapeHtml(publisherName)}</strong>,</p>
<p><strong>${escapeHtml(agency)}</strong> has added you as a publisher on the <strong>${escapeHtml(campaignName)}</strong> campaign.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
  ${row('Campaign', campaignName)}
  ${row('Publisher ID', publisherId, true)}
  ${payout ? row('Payout', payout) : ''}
</table>
<p>Send calls for this campaign under your Publisher ID, and every call will be
reported back against it, along with what each one earned.</p>
<p>If anything looks wrong, please reply to this message and we will look into it.</p>`,
  });

  const transporter = getTransporter();
  if (!transporter) {
    logger.info({
      msg: 'Publisher campaign email not sent: SMTP is not configured',
      email,
      publisherId,
    });
    return false;
  }

  await transporter.sendMail({ from: brand.from, to: email, subject, text, html });
  logger.info({ msg: 'Publisher campaign email sent', email, publisherId, campaignName });
  return true;
}

/**
 * Exported because the email shell below is shared. `agent-invite-email.ts`
 * renders into the same shell and needs the same escaping; a second copy is a
 * second place for an unescaped agency name to become broken markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The email shell: light, one column, the wordmark at the top.
 *
 * Inline styles and a table, because email clients render nothing else
 * reliably. The colours are the product's light tokens (--paper, --surface,
 * --ink, --ink-2, --rule).
 *
 * Unbranded, the wordmark is set as text — "net" in black, "Enroll" in brand
 * green — so it renders with images blocked. Branded (see
 * `services/email-brand.ts`), the header is the agency's logo with its name as
 * the alt text, and the title, sign-off and footer carry the agency's name:
 * a branded email says "NetEnroll" nowhere.
 */
export function renderEmail({
  title,
  body,
  brand,
}: {
  title: string;
  body: string;
  brand?: EmailBrand;
}): string {
  const b = brand ?? netEnrollEmailBrand();
  const header =
    b.branded && b.logoUrl
      ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.productName)}" height="40" style="display:block;height:40px;width:auto;border:0;">`
      : b.branded
        ? // A branded sender with no logo is named in text -- never drawn as NetEnroll.
          `<span style="color:#171614;">${escapeHtml(b.productName)}</span>`
        : '<span style="color:#000000;">net</span><span style="color:#10b981;">Enroll</span>';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · ${escapeHtml(b.productName)}</title></head>
<body style="margin:0;padding:0;background:#fbfaf8;color:#171614;font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fbfaf8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;width:100%;">
        <tr><td style="padding:0 0 20px 0;font-size:22px;font-weight:600;letter-spacing:-0.02em;">
          ${header}
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e4e0d8;border-radius:6px;padding:24px;">
          <h1 style="margin:0 0 12px 0;font-size:18px;font-weight:600;color:#171614;">${escapeHtml(title)}</h1>
          ${body}
          <p style="margin:20px 0 0 0;">Best regards,<br>${escapeHtml(b.signOff)}</p>
        </td></tr>
        <tr><td style="padding:16px 0 0 0;font-size:12px;color:#8a867c;">
          This message was sent by ${escapeHtml(b.productName)}. If you were not expecting it, you can ignore it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Generates a professional 32-character hexadecimal publisher code
 * Similar to Ringba's publisher ID format
 */
export function generatePublisherCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
