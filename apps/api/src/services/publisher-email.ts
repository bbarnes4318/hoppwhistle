import nodemailer from 'nodemailer';

/**
 * Publisher Email Service
 * Handles sending welcome and notification emails to publishers
 */

interface WelcomeEmailPayload {
  email: string;
  publisherName: string;
  publisherId: string;
  accessToRecordings: boolean;
}

// Create a transporter using environment variables if set
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });
  }
  return null;
}

/**
 * Sends a welcome email to a newly created publisher.
 * Falls back to console logging if SMTP environment variables are not configured.
 */
export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void> {
  const { email, publisherName, publisherId, accessToRecordings } = payload;
  const fromAddress = process.env.SMTP_FROM || 'noreply@netenroll.com';

  const subject = 'Welcome to NetEnroll — your publisher account is ready';
  const text = `Hello ${publisherName},

Welcome to NetEnroll. Your publisher account has been created.

Account Details:
  - Publisher ID: ${publisherId}
  - Access to Recordings: ${accessToRecordings ? 'Enabled' : 'Disabled'}

You can use your Publisher ID to track your traffic and view reports in the dashboard.

Best regards,
The NetEnroll team`;

  const html = renderEmail({
    title: 'Your publisher account is ready',
    body: `<p>Hello <strong>${escapeHtml(publisherName)}</strong>,</p>
<p>Welcome to NetEnroll. Your publisher account has been created.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 16px 6px 0;color:#55524b;">Publisher ID</td><td style="padding:6px 0;font-family:'IBM Plex Mono',SFMono-Regular,Menlo,monospace;color:#171614;">${escapeHtml(publisherId)}</td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#55524b;">Access to recordings</td><td style="padding:6px 0;color:#171614;">${accessToRecordings ? 'Enabled' : 'Disabled'}</td></tr>
</table>
<p>Use your Publisher ID to track your traffic and view reports in the dashboard.</p>`,
  });

  const transporter = getTransporter();

  if (transporter) {
    console.log(`Sending real welcome email to ${email} via SMTP...`);
    await transporter.sendMail({
      from: fromAddress,
      to: email,
      subject,
      text,
      html,
    });
    console.log(`✓ Email sent to ${email}`);
  } else {
    // Mock email service - logs to server console
    console.log('========================================');
    console.log('📧 PUBLISHER WELCOME EMAIL (SIMULATED - SMTP NOT CONFIG)');
    console.log('========================================');
    console.log(`To: ${email}`);
    console.log(`Subject: ${subject}`);
    console.log('');
    console.log('Email Body:');
    console.log(text);
    console.log('========================================');
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The NetEnroll email shell: light, one column, the wordmark at the top.
 *
 * Inline styles and a table, because email clients render nothing else
 * reliably. The colours are the product's light tokens (--paper, --surface,
 * --ink, --ink-2, --rule) and the wordmark is set as text — "net" in black,
 * "Enroll" in brand green — so it renders with images blocked. Brand green
 * appears nowhere else: the mark is the accent, and a second green would
 * compete with it.
 */
export function renderEmail({ title, body }: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · NetEnroll</title></head>
<body style="margin:0;padding:0;background:#fbfaf8;color:#171614;font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fbfaf8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;width:100%;">
        <tr><td style="padding:0 0 20px 0;font-size:22px;font-weight:600;letter-spacing:-0.02em;">
          <span style="color:#000000;">net</span><span style="color:#10b981;">Enroll</span>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e4e0d8;border-radius:6px;padding:24px;">
          <h1 style="margin:0 0 12px 0;font-size:18px;font-weight:600;color:#171614;">${escapeHtml(title)}</h1>
          ${body}
          <p style="margin:20px 0 0 0;">Best regards,<br>The NetEnroll team</p>
        </td></tr>
        <tr><td style="padding:16px 0 0 0;font-size:12px;color:#8a867c;">
          This message was sent by NetEnroll. If you were not expecting it, you can ignore it.
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
