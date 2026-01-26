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

/**
 * Sends a welcome email to a newly created publisher.
 * Currently logs to console - replace with actual email service (SendGrid, etc.) in production.
 */
export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void> {
  const { email, publisherName, publisherId, accessToRecordings } = payload;

  // Mock email service - logs to server console
  console.log('========================================');
  console.log('📧 PUBLISHER WELCOME EMAIL');
  console.log('========================================');
  console.log(`To: ${email}`);
  console.log(`Subject: Welcome to Hopwhistle - Your Publisher Account is Ready`);
  console.log('');
  console.log('Email Body:');
  console.log(`Hello ${publisherName},`);
  console.log('');
  console.log('Welcome to Hopwhistle! Your publisher account has been created successfully.');
  console.log('');
  console.log('Account Details:');
  console.log(`  - Publisher ID: ${publisherId}`);
  console.log(`  - Access to Recordings: ${accessToRecordings ? 'Enabled' : 'Disabled'}`);
  console.log('');
  console.log(
    'You can use your Publisher ID to track your traffic and view reports in the dashboard.'
  );
  console.log('');
  console.log('Best regards,');
  console.log('The Hopwhistle Team');
  console.log('========================================');
  console.log('');

  // In production, this would call an actual email service:
  // await sendGridClient.send({ to: email, subject: '...', html: '...' });
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
