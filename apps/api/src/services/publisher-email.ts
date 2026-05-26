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
  const fromAddress = process.env.SMTP_FROM || 'noreply@hopwhistle.com';

  const subject = 'Welcome to Hopwhistle - Your Publisher Account is Ready';
  const text = `Hello ${publisherName},

Welcome to Hopwhistle! Your publisher account has been created successfully.

Account Details:
  - Publisher ID: ${publisherId}
  - Access to Recordings: ${accessToRecordings ? 'Enabled' : 'Disabled'}

You can use your Publisher ID to track your traffic and view reports in the dashboard.

Best regards,
The Hopwhistle Team`;

  const html = `<p>Hello <strong>${publisherName}</strong>,</p>
<p>Welcome to Hopwhistle! Your publisher account has been created successfully.</p>
<p><strong>Account Details:</strong></p>
<ul>
  <li><strong>Publisher ID:</strong> <code>${publisherId}</code></li>
  <li><strong>Access to Recordings:</strong> ${accessToRecordings ? 'Enabled' : 'Disabled'}</li>
</ul>
<p>You can use your Publisher ID to track your traffic and view reports in the dashboard.</p>
<br>
<p>Best regards,<br>The Hopwhistle Team</p>`;

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
