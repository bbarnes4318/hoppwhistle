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

  const portalUrl = process.env.API_PUBLIC_URL || 'https://agents.netenroll.com';

  const subject = 'Your NetEnroll publisher account is ready';
  const text = `Hello ${publisherName},

Your NetEnroll publisher account has been created. You can sign in at
${portalUrl}/login.

Account details:
  - Publisher ID: ${publisherId}
  - Access to recordings: ${accessToRecordings ? 'Enabled' : 'Disabled'}

Your Publisher ID identifies the calls you send. Use it when you ping and post,
and the portal will report every call back against it, along with what each one
earned.

If anything looks wrong, please reply to this message and we will look into it.

Kind regards,
The NetEnroll team`;

  const html = `<p>Hello <strong>${publisherName}</strong>,</p>
<p>Your NetEnroll publisher account has been created. You can sign in at
<a href="${portalUrl}/login">${portalUrl}/login</a>.</p>
<p><strong>Account details:</strong></p>
<ul>
  <li><strong>Publisher ID:</strong> <code>${publisherId}</code></li>
  <li><strong>Access to recordings:</strong> ${accessToRecordings ? 'Enabled' : 'Disabled'}</li>
</ul>
<p>Your Publisher ID identifies the calls you send. Use it when you ping and post,
and the portal will report every call back against it, along with what each one
earned.</p>
<p>If anything looks wrong, please reply to this message and we will look into it.</p>
<br>
<p>Kind regards,<br>The NetEnroll team</p>`;

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
