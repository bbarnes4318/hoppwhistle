/**
 * Delivering an agent's invitation, instead of making the owner deliver it.
 *
 * ── What this is about ───────────────────────────────────────────────────────
 *
 * `POST /api/v1/auth/activation-grants` minted a token, returned it, and said
 * in a comment: "Shown once. Send it to the invitee; it cannot be retrieved
 * again." Nothing sent it. Adding an agent meant copying a token out of a
 * dialog into a text message, on the product whose premise is that an agency
 * onboards its own people.
 *
 * ── The properties that matter ───────────────────────────────────────────────
 *
 *   1. The LINK is right. `app/login/page.tsx` reads `?activation=` and
 *      `?email=`; any other spelling produces a link that opens a blank form
 *      and asks the agent to paste a token nobody gave them. The link is the
 *      entire deliverable, so it is asserted exactly.
 *   2. It NEVER throws. The grant is written before this runs and is valid
 *      whether or not SMTP is. A send failure that propagated would turn a
 *      working invitation into a 500 and strand a valid grant nobody knows
 *      about.
 *   3. It reports honestly. An owner who is told nothing will assume the agent
 *      was emailed and wait. `sent` is false with a reason whenever a transport
 *      did not accept the message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...(args as [])),
  default: { createTransport: (...args: unknown[]) => createTransport(...(args as [])) },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invitationLink, sendAgentInvitationEmail } from '../services/agent-invite-email.js';

const EXPIRES = new Date('2026-10-01T12:00:00Z');

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    email: 'agent@example.test',
    agencyName: 'Bedrock Insurance',
    activationToken: 'GRANT-TOKEN-123',
    expiresAt: EXPIRES,
    ...overrides,
  };
}

/** SMTP configured, so a transport exists. */
function configureSmtp(): void {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_USER = 'user';
  process.env.SMTP_PASSWORD = 'pass';
}

const ENV_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  sendMail.mockReset().mockResolvedValue({ accepted: ['agent@example.test'] });
  createTransport.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
});

/* ── The link ──────────────────────────────────────────────────────────────── */

describe('the invitation link', () => {
  it('uses the two parameters the login page actually reads', () => {
    process.env.APP_URL = 'https://agents.example.test';

    const link = invitationLink('agent@example.test', 'GRANT-TOKEN-123');

    // `app/login/page.tsx` reads `activation` and `email`. Rename either and
    // the agent lands on a blank sign-in form.
    expect(link).toBe(
      'https://agents.example.test/login?activation=GRANT-TOKEN-123&email=agent%40example.test'
    );
  });

  it('url-encodes a token and an address that need it', () => {
    process.env.APP_URL = 'https://agents.example.test';

    const link = invitationLink('first+last@example.test', 'a/b+c=d');

    expect(link).toContain('activation=a%2Fb%2Bc%3Dd');
    expect(link).toContain('email=first%2Blast%40example.test');
  });

  it('does not double the slash when APP_URL has a trailing one', () => {
    process.env.APP_URL = 'https://agents.example.test/';
    expect(invitationLink('a@b.test', 't')).toContain('https://agents.example.test/login?');
  });
});

/* ── Sending ───────────────────────────────────────────────────────────────── */

describe('sending', () => {
  it('sends the link to the invited address', async () => {
    configureSmtp();
    process.env.APP_URL = 'https://agents.example.test';

    const result = await sendAgentInvitationEmail(invitation());

    expect(result).toEqual({ sent: true });
    expect(sendMail).toHaveBeenCalledTimes(1);

    const message = sendMail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(message.to).toBe('agent@example.test');
    expect(message.subject).toContain('Bedrock Insurance');

    const link =
      'https://agents.example.test/login?activation=GRANT-TOKEN-123&email=agent%40example.test';
    expect(message.text).toContain(link);

    /*
     * The HTML carries the same link with `&` written as `&amp;`, which is what
     * a valid href requires and what every client unescapes back to the plain
     * URL. Asserting the raw `&` here would be asserting invalid markup.
     */
    expect(message.html).toContain(link.replace(/&/g, '&amp;'));
    expect(message.html).toContain('<a href=');
  });

  it('names the agency the agent is joining', async () => {
    configureSmtp();
    const message = await sendAgentInvitationEmail(invitation()).then(
      () => sendMail.mock.calls[0][0] as { text: string; html: string }
    );

    expect(message.text).toContain('Bedrock Insurance');
    expect(message.html).toContain('Bedrock Insurance');
  });

  it('still reads correctly when the agency has no name', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation({ agencyName: null }));

    const message = sendMail.mock.calls[0][0] as { subject: string; text: string };
    // Not "added to null on NetEnroll".
    expect(message.subject).not.toMatch(/null|undefined/);
    expect(message.text).not.toMatch(/null|undefined/);
  });

  it('escapes an agency name that would otherwise break the markup', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation({ agencyName: 'Smith & Sons <Insurance>' }));

    const message = sendMail.mock.calls[0][0] as { html: string };
    expect(message.html).toContain('Smith &amp; Sons &lt;Insurance&gt;');
    expect(message.html).not.toContain('<Insurance>');
  });

  it('tells the agent when the link stops working', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation());

    // A one-use link with no stated expiry is a support ticket waiting to
    // happen.
    const message = sendMail.mock.calls[0][0] as { text: string };
    expect(message.text).toMatch(/October 1, 2026/);
  });
});

/* ── Failing without failing the invitation ────────────────────────────────── */

describe('when it cannot send', () => {
  it('reports not_configured rather than throwing, with no SMTP', async () => {
    const result = await sendAgentInvitationEmail(invitation());

    expect(result).toEqual({ sent: false, reason: 'not_configured' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('swallows a transport failure and reports it', async () => {
    configureSmtp();
    sendMail.mockRejectedValue(new Error('550 mailbox unavailable'));

    /*
     * The property this exists for. The grant is already written and the token
     * is on its way back to the caller, so the invitation WORKS; what failed is
     * the convenience of delivering it. Throwing would turn that into a 500 and
     * leave a valid grant nobody knows about.
     */
    const result = await sendAgentInvitationEmail(invitation());

    expect(result).toEqual({ sent: false, reason: 'send_failed' });
  });

  it('does not build a transport when SMTP is half-configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    // No user, no password.

    const result = await sendAgentInvitationEmail(invitation());

    expect(result.sent).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
