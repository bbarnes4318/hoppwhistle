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
