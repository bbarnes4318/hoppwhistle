/**
 * The email that actually delivers an agent's invitation.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * `POST /api/v1/auth/activation-grants` minted a token and handed it back in
 * the response with the comment "Shown once. Send it to the invitee; it cannot
 * be retrieved again." Nothing sent it. An agency owner adding an agent had to
 * copy a token out of a dialog and get it to that person themselves, by text
 * or Slack or reading it down the phone -- and if they lost it before the agent
 * used it, the only recourse was issuing another.
 *
 * That is the first thing every agent experiences, on the product whose whole
 * premise is that an agency onboards its own people.
 *
 * ── Best-effort, and the grant does not depend on it ─────────────────────────
 *
 * The grant is written before this is called and stays valid whether or not the
 * message is accepted. A failed send must never fail the invitation: the token
 * is still returned to the caller, so an owner can hand-deliver exactly as they
 * do today, and the response says which happened. Silence about a failed send
 * would be worse than the manual step it replaces -- the owner would believe
 * the agent had been emailed and wait.
 *
 * That is the same posture `services/billing/notifications.ts` takes, for the
 * same reason: SMTP being down is not a reason for the underlying record to
 * fail.
 */

import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { logger } from '../lib/logger.js';

import { escapeHtml, renderEmail } from './publisher-email.js';

export interface AgentInvitation {
  /** Who it is going to. Already lower-cased by the route. */
  email: string;
  /** The agency they are joining, for the body. */
  agencyName: string | null;
  /** Shown once, and never recoverable. The whole point of the link. */
  activationToken: string;
  expiresAt: Date;
  /**
   * What they are being invited AS. Defaults to AGENT, which is what every
   * caller meant when this only had one.
   *
   * It is not decoration. The body told an agent to open the softphone and
   * wait for calls, and the platform's owner-invite route now sends through
   * here too -- an agency principal being told to sit and wait for a call that
   * is never routed to them is a worse first impression than no email at all.
   */
  role?: 'AGENT' | 'OWNER';
}

export interface InviteEmailResult {
  /** True only when a transport accepted the message. */
  sent: boolean;
  /**
   * Why it was not sent, when it was not. `not_configured` is the ordinary
   * case on an installation with no SMTP; `send_failed` is a real fault.
   */
  reason?: 'not_configured' | 'send_failed';
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
    /*
     * TLS is required, not merely preferred.
     *
     * `secure: true` means the whole session is wrapped in TLS from the first
     * byte, which is what port 465 is. Every other port -- 587 being the one
     * that matters -- starts in the clear and upgrades with STARTTLS, and
     * nodemailer will do that upgrade OPPORTUNISTICALLY: if the server does not
     * advertise STARTTLS it carries on and sends AUTH in plaintext. The
     * password crosses the network in the clear, and nothing anywhere says so.
     *
     * That was theoretical while this ran on 465. It is not any more: Hetzner
     * blocks outbound 25 and 465, so production authenticates on 587, and an
     * opportunistic upgrade is one stripped capability line away from leaking
     * the mailbox password.
     *
     * `requireTLS` makes the send FAIL instead. A failed invitation is already
     * a handled case -- the grant stands, the token is returned, the caller is
     * told -- so refusing is cheap here and leaking is not.
     */
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  });
}

/**
 * Where the portal lives, for the link in the message.
 *
 * `APP_URL` is what `cli/platform-admins.ts` already uses for the same purpose,
 * so the two agree on the address an invitation points at rather than each
 * having their own idea of it.
 */
function portalUrl(): string {
  return (process.env.APP_URL ?? 'https://agents.netenroll.com').replace(/\/+$/, '');
}

/**
 * The link the agent clicks.
 *
 * `?activation=` and `?email=` are the two parameters `app/login/page.tsx`
 * reads: the first fills the token in and switches the page to its create tab,
 * the second lets it preview whose invitation this is before the agent submits
 * anything. Renaming either one here silently produces a link that opens a
 * blank sign-in form -- which still works, but asks the agent to paste a token
 * they were never given.
 */
export function invitationLink(email: string, activationToken: string): string {
  const params = new URLSearchParams({ activation: activationToken, email });
  return `${portalUrl()}/login?${params.toString()}`;
}

/** How the expiry reads in the message: a date, in the agency's own terms. */
function expiryText(expiresAt: Date): string {
  return expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Send one agent their invitation.
 *
 * Never throws. Every failure is caught, logged and reported in the result, so
 * the caller can tell the owner to hand-deliver instead.
 */
export async function sendAgentInvitationEmail(
  invitation: AgentInvitation
): Promise<InviteEmailResult> {
  const { email, agencyName, activationToken, expiresAt } = invitation;
  const role = invitation.role ?? 'AGENT';
  const isOwner = role === 'OWNER';

  const transport = transporter();
  if (!transport) {
    logger.info({
      msg: 'Agent invitation not emailed: SMTP is not configured. The token was returned to the caller.',
      email,
    });
    return { sent: false, reason: 'not_configured' };
  }

  const link = invitationLink(email, activationToken);
  const joining = agencyName ? `${agencyName} on NetEnroll` : 'NetEnroll';
  const expires = expiryText(expiresAt);

  const subject = agencyName
    ? isOwner
      ? `Set up ${agencyName} on NetEnroll`
      : `You have been added to ${agencyName} on NetEnroll`
    : isOwner
      ? 'Set up your agency on NetEnroll'
      : 'Your NetEnroll agent invitation';

  const opening = isOwner
    ? `You have been set up as the administrator for ${joining}.`
    : `You have been added as an agent for ${joining}.`;

  /*
   * What to do once you are in, and it differs entirely by role. An agent opens
   * the softphone and waits. An owner has people to add before anyone can.
   */
  const nextStep = isOwner
    ? `Once you are in, add your people under Settings -> Team Members. An agent
can take calls once they have accepted their invitation, have their licensed
states recorded and are assigned a campaign -- that screen says which of those
is missing for each of them.`
    : `Once you are in, open the phone in the bottom-right corner of the screen. It
signs itself in; there is nothing to configure. Calls will start arriving once
an administrator has recorded the states you are licensed in.`;

  const text = `${opening}

Set up your account here:
${link}

This link is good until ${expires}. It can be used once, and it is the only
way to set up this account -- if it expires, ask whoever invited you to send
another.

${nextStep}

If you were not expecting this, you can ignore this message. Nothing is created
until the link is used.

Kind regards,
The NetEnroll team`;

  const html = renderEmail({
    title: agencyName
      ? isOwner
        ? `Set up ${agencyName} on NetEnroll`
        : `You have been added to ${agencyName}`
      : 'Your NetEnroll invitation',
    body: `<p>${escapeHtml(opening)}</p>
<p style="margin:20px 0;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Set up your account</a>
</p>
<p style="color:#55524b;">This link is good until <strong>${escapeHtml(expires)}</strong>. It can be used once, and it is the only way to set up this account — if it expires, ask whoever invited you to send another.</p>
<p>${
      isOwner
        ? 'Once you are in, add your people under <strong>Settings &rarr; Team Members</strong>. An agent can take calls once they have accepted their invitation, have their licensed states recorded and are assigned a campaign — that screen says which of those is missing for each of them.'
        : 'Once you are in, open the phone in the bottom-right corner of the screen. It signs itself in; there is nothing to configure. Calls will start arriving once an administrator has recorded the states you are licensed in.'
    }</p>
<p style="color:#8a867c;font-size:13px;">If you were not expecting this, you can ignore this message. Nothing is created until the link is used.</p>`,
  });

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@netenroll.com',
      to: email,
      subject,
      text,
      html,
    });
    logger.info({ msg: 'Invitation emailed', email, role });
    return { sent: true };
  } catch (error) {
    /*
     * Logged, not thrown. The grant is already written and the token is on its
     * way back to the caller, so the invitation is usable; what failed is the
     * convenience of delivering it. Throwing here would turn a working
     * invitation into a 500 and leave a valid grant nobody knows about.
     */
    logger.error({
      msg: 'Agent invitation could not be emailed. The token was returned to the caller instead.',
      email,
      err: error,
    });
    return { sent: false, reason: 'send_failed' };
  }
}
