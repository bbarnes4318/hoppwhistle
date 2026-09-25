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

const sendMail = vi.fn<[message: unknown], Promise<{ accepted: string[] }>>();
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
    else process.env[key] = saved[key];
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

/**
 * The same email, to two entirely different people.
 *
 * The platform's owner-invite route sends through this service now. An agency
 * PRINCIPAL told to "open the phone in the bottom-right corner and wait for
 * calls" would be waiting for a call that is never routed to them -- a worse
 * first impression than the hand-delivered token it replaced. The role decides
 * the instruction, and these assert the two do not blur back together.
 */
/**
 * How the transport is built.
 *
 * Production authenticates on 587, because Hetzner blocks outbound 25 and 465.
 * That port starts in the clear and upgrades with STARTTLS, and nodemailer's
 * default is to do that upgrade only IF the server offers it -- so a server
 * that does not advertise STARTTLS, or a stripped capability line, puts the
 * mailbox password on the wire in plaintext with nothing reporting it.
 */
describe('the connection it opens', () => {
  it('demands STARTTLS on a port that is not implicitly TLS', async () => {
    configureSmtp();
    process.env.SMTP_PORT = '587';
    await sendAgentInvitationEmail(invitation());

    const options = createTransport.mock.calls[0][0] as {
      port: number;
      secure: boolean;
      requireTLS: boolean;
    };
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
  });

  it('wraps the whole session in TLS on 465 instead', async () => {
    configureSmtp();
    process.env.SMTP_PORT = '465';
    await sendAgentInvitationEmail(invitation());

    const options = createTransport.mock.calls[0][0] as {
      secure: boolean;
      requireTLS: boolean;
    };
    expect(options.secure).toBe(true);
    // Already encrypted from the first byte; there is nothing to upgrade.
    expect(options.requireTLS).toBe(false);
  });
});

describe('who it is addressed to', () => {
  it('tells an agent to open the softphone', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation());

    const message = sendMail.mock.calls[0][0] as { subject: string; text: string; html: string };
    expect(message.text).toContain('as an agent');
    expect(message.text).toContain('phone in the bottom-right');
    expect(message.text).not.toContain('Team Members');
  });

  it('tells an owner to add their people instead', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation({ role: 'OWNER' }));

    const message = sendMail.mock.calls[0][0] as { subject: string; text: string; html: string };
    expect(message.text).toContain('administrator for');
    expect(message.text).toContain('Team Members');
    // The instruction an owner must NOT be given.
    expect(message.text).not.toContain('phone in the bottom-right');
    expect(message.html).not.toContain('phone in the bottom-right');
  });

  it('subjects an owner with setting the agency up, not with being added to it', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation({ role: 'OWNER' }));

    const message = sendMail.mock.calls[0][0] as { subject: string };
    expect(message.subject).toBe('Set up Bedrock Insurance on NetEnroll');
  });

  /**
   * Every caller that predates the role wrote an agent's invitation and passed
   * no role at all. Defaulting to OWNER -- or to anything else -- would rewrite
   * what those callers send without touching them.
   */
  it('is an agent invitation when no role is named', async () => {
    configureSmtp();
    await sendAgentInvitationEmail(invitation());

    const message = sendMail.mock.calls[0][0] as { subject: string; text: string };
    expect(message.subject).toBe('You have been added to Bedrock Insurance on NetEnroll');
    expect(message.text).toContain('as an agent');
  });
});

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
