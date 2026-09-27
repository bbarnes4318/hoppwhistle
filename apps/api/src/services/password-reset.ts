/**
 * Password reset links.
 *
 * The same token treatment as `services/tenant-activation.ts`: 32 random bytes,
 * base64url, of which only the SHA-256 is stored. A link is single-use, lasts
 * sixty minutes, and is consumed by a conditional update so two requests racing
 * on one token set the password once.
 *
 * The request side never says whether an address has an account. The route
 * answers 202 to every well-formed request; only an address that belongs to an
 * active user gets a message.
 */

import { createHash, randomBytes } from 'crypto';

import { createTransport } from 'nodemailer';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { emailBrandForTenant } from './email-brand.js';
import { escapeHtml, renderEmail } from './publisher-email.js';

/** How long a reset link works. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** The shortest password either password route accepts. */
export const MIN_PASSWORD_LENGTH = 10;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a reset token for a user. Returns the plaintext, once. */
export async function issuePasswordResetToken(
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await getPrismaClient().passwordResetToken.create({
    data: { userId, tokenHash: hashResetToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export type ResetTokenFailure = 'INVALID' | 'EXPIRED' | 'USED';

/**
 * Consume a reset token, returning the user it was for.
 *
 * Every failure is reported to the caller as one generic message; the reason is
 * for the log.
 */
export async function consumePasswordResetToken(
  token: string
): Promise<{ userId: string } | { failure: ResetTokenFailure }> {
  const prisma = getPrismaClient();
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token.trim()) },
  });

  if (!row) return { failure: 'INVALID' };
  if (row.usedAt) return { failure: 'USED' };
  if (row.expiresAt.getTime() <= Date.now()) return { failure: 'EXPIRED' };

  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { failure: 'USED' };

  return { userId: row.userId };
}

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

/**
 * Email a reset link, branded as the user's agency.
 *
 * Never throws: the route answers 202 whatever happens here, so a failure is
 * logged and nothing else.
 */
export async function sendPasswordResetEmail(params: {
  email: string;
  tenantId: string | null;
  token: string;
}): Promise<boolean> {
  const transport = transporter();
  if (!transport) {
    logger.info({ msg: 'Password reset not emailed: SMTP is not configured', email: params.email });
    return false;
  }

  const brand = await emailBrandForTenant(params.tenantId);
  const link = `${brand.linkBase}/reset-password?${new URLSearchParams({ token: params.token }).toString()}`;

  const text = `Somebody asked to reset the password for your ${brand.productName} account.

Choose a new password here:
${link}

This link works once, for the next 60 minutes. If you did not ask for this, you
can ignore this message; your password has not changed.

Kind regards,
${brand.signOff}`;

  const html = renderEmail({
    brand,
    title: 'Reset your password',
    body: `<p>Somebody asked to reset the password for your ${escapeHtml(brand.productName)} account.</p>
<p style="margin:20px 0;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Choose a new password</a>
</p>
<p style="color:#55524b;">This link works once, for the next 60 minutes. If you did not ask for this, you can ignore this message; your password has not changed.</p>`,
  });

  try {
    await transport.sendMail({
      from: brand.from,
      to: params.email,
      subject: `Reset your ${brand.productName} password`,
      text,
      html,
    });
    return true;
  } catch (error) {
    logger.error({
      msg: 'Password reset email could not be sent',
      email: params.email,
      err: error,
    });
    return false;
  }
}
