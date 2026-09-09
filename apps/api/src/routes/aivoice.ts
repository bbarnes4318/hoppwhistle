import { FastifyInstance, FastifyRequest } from 'fastify';

import { signDograhToken } from '../lib/aivoice-jwt.js';

/**
 * AI Voice (embedded Dograh) single sign-on.
 *
 * The AI Voice app at AIVOICE_URL authenticates via a `dograh_auth_token` cookie
 * (a JWT signed with Dograh's OSS_JWT_SECRET). This route mints that token for the
 * currently-logged-in Hopwhistle user and drops it on the parent domain
 * (`.hopwhistle.com`) so the iframe embedded in the /voice-agents page is already
 * signed in — no second login. See apps/web .../voice-agents/page.tsx.
 */

// Deliberately still on hopwhistle.com after the portal moved to
// agents.netenroll.com. These two are not branding: AIVOICE_URL is where the
// Dograh app is actually deployed, and AIVOICE_COOKIE_DOMAIN has to be a parent
// of that host or the app never sees the token.
//
// KNOWN CONSEQUENCE: /voice-agents is NOT single-signed-on from
// agents.netenroll.com, and it cannot be made so from inside this repository.
// The iframe loads, Dograh shows its own login, and nothing errors. Two
// independent browser rules block it, and neither is a cookie-domain string:
//
//   1. A response served from agents.netenroll.com may only set a cookie whose
//      Domain is that host or a parent of it (RFC 6265 domain-match).
//      `.hopwhistle.com` is neither, so the browser drops both Set-Cookie
//      headers silently. Deriving the domain from the request instead does not
//      help: it yields `.netenroll.com`, and the frame's requests go to
//      aivoice.hopwhistle.com, which such a cookie is never sent to. The token
//      has to be set on the registrable domain Dograh is served from.
//
//   2. Even correctly scoped, the frame is now cross-site: the parent page is
//      netenroll.com and the frame is hopwhistle.com. `SameSite=Lax` cookies
//      are not sent on cross-site frame requests at all, so the handoff would
//      still fail. `SameSite=None; Secure` makes it a third-party cookie --
//      blocked outright by Safari and Firefox, partitioned by Chrome.
//
// Today it works only because hopwhistle.com and aivoice.hopwhistle.com share
// one registrable domain, which makes the frame same-site and `.hopwhistle.com`
// cover both. The fix is to restore that property on the new domain, and every
// step of it is outside this repo:
//
//   * DNS: point aivoice.netenroll.com at the box that serves Dograh.
//   * TLS: issue a certificate for that name.
//   * nginx on that box: an aivoice.netenroll.com server block proxying to the
//     Dograh app, whose framing headers permit https://agents.netenroll.com as
//     a frame-ancestor. That vhost lives beside /opt/dograh, not in infra/nginx
//     here -- see docs/saas/VOICE_AI_INTEGRATION_AUDIT.md.
//   * Dograh's own config: its public URL and allowed origins.
//
// Only after that does anything change here, and it is just the two values
// below: AIVOICE_URL=https://aivoice.netenroll.com and
// AIVOICE_COOKIE_DOMAIN=.netenroll.com, set together. They must always name the
// same registrable domain. The route needs no other change -- the cookie will
// then be set by a response from netenroll.com onto .netenroll.com, and the
// frame will be same-site again.
//
// A redirect-based handoff is not an in-repo alternative: it still has to land
// on an endpoint served by the Dograh origin that accepts the token and sets
// the cookie itself, and Dograh has no such endpoint -- adding one is a change
// to that app. Proxying Dograh under a path on agents.netenroll.com is the
// other option, and needs Dograh to support a base path.
//
// Until one of those lands, agents reach AI Voice at https://hopwhistle.com
// /voice-agents, which still serves the app in full.
const AIVOICE_URL = process.env.AIVOICE_URL || 'https://aivoice.hopwhistle.com';
const AIVOICE_JWT_SECRET = process.env.AIVOICE_JWT_SECRET || '';
const AIVOICE_COOKIE_DOMAIN = process.env.AIVOICE_COOKIE_DOMAIN || '.hopwhistle.com';
const TOKEN_TTL_HOURS = Number(process.env.AIVOICE_TOKEN_TTL_HOURS || '24');

// Phase 2 ships a single shared AI Voice workspace (Dograh user id from env,
// default 1). Phase 3 replaces resolveWorkspace() with per-user provisioning:
// map each Hopwhistle userId → its own Dograh org+user, auto-created from a
// template (BYOK keys + telephony + caller-ID pool + starter agent) on first use.
const DEFAULT_DOGRAH_USER_ID = process.env.AIVOICE_DEFAULT_USER_ID || '1';

interface HopwhistleUser {
  userId?: string;
  tenantId?: string;
  email?: string;
}

function resolveWorkspace(user: HopwhistleUser): Promise<{ dograhUserId: string; email: string }> {
  // TODO(phase-3): look up / provision a per-user Dograh workspace keyed on
  // user.userId and return that workspace's Dograh user id instead of the shared one.
  // Returns a Promise so phase 3 can make this a real (async) DB/provisioning call
  // without changing callers.
  return Promise.resolve({
    dograhUserId: DEFAULT_DOGRAH_USER_ID,
    email: user.email || 'user@hopwhistle.com',
  });
}

export async function registerAiVoiceRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/aivoice/session', async (request: FastifyRequest, reply) => {
    const user = (request.user || {}) as HopwhistleUser;

    if (!user.userId && !user.tenantId) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    if (!AIVOICE_JWT_SECRET) {
      request.log.error('AIVOICE_JWT_SECRET is not set — cannot mint AI Voice SSO token');
      return reply
        .code(503)
        .send({ error: { code: 'AIVOICE_NOT_CONFIGURED', message: 'AI Voice is not configured' } });
    }

    const { dograhUserId, email } = await resolveWorkspace(user);
    const token = signDograhToken(
      { userId: dograhUserId, email },
      AIVOICE_JWT_SECRET,
      TOKEN_TTL_HOURS
    );
    const userCookie = JSON.stringify({
      id: String(dograhUserId),
      name: email,
      email,
      provider: 'local',
    });

    const cookieOptions = {
      domain: AIVOICE_COOKIE_DOMAIN,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      maxAge: TOKEN_TTL_HOURS * 3600,
    };

    // dograh_auth_token: read by the AI Voice middleware + /api/auth/oss (server-side).
    // dograh_auth_user: read by /api/auth/oss to render the user; JSON payload.
    void reply.setCookie('dograh_auth_token', token, cookieOptions);
    void reply.setCookie('dograh_auth_user', userCookie, cookieOptions);

    return reply.send({ url: AIVOICE_URL });
  });
}
