import { createHash } from 'crypto';

import { FastifyInstance, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { eventBus } from '../services/event-bus.js';
import type { EventPayload, EventChannel } from '../services/event-bus.js';

/**
 * The live event feed.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * The Phase 1 audit walked Prisma queries, so it never looked at this file, and
 * this file decided who sees an agency's live calls. It authenticated like
 * this:
 *
 *     const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');
 *     if (validApiKeys.length > 0 && !validApiKeys.includes(apiKey)) return null;
 *     return { tenantId: process.env.DEFAULT_TENANT_ID || '000...0' };
 *
 * Three separate problems, and the third is the one that matters:
 *
 *   1. With `VALID_API_KEYS` unset -- which it is -- `validApiKeys` is empty
 *      and the check is skipped entirely. Any string in `?apiKey=` connected.
 *   2. Even when set, the list is an environment variable compared by string
 *      equality. It has no relationship to the `api_keys` table, so a key
 *      revoked in the product stayed valid here.
 *   3. The tenant came from an environment variable, not from the credential.
 *      Every subscriber on the platform was handed the same tenant, and the
 *      only thing between them and another agency's call events was that
 *      `DEFAULT_TENANT_ID` happened to name one agency rather than theirs.
 *
 * ── What it does now ─────────────────────────────────────────────────────────
 *
 * The credential is verified against the same stores the HTTP surface uses --
 * an `api_keys` row by SHA-256 hash, or a JWT -- and the tenant comes from the
 * credential, never from configuration and never from the wire. That is the
 * Phase 1 rule applied to a socket: the subscriber does not name an agency, the
 * agency is a property of who they proved they are.
 *
 * Subscription is authorised at subscribe time, not filtered on delivery. The
 * old code accepted any `{type:'subscribe'}` message, recorded the channels in
 * a Set it then ignored, and delivered every channel to every socket regardless
 * -- so `subscribedChannels` was decoration and the tenant comparison was the
 * only control. Now a channel outside the allowed set is refused when it is
 * asked for, and nothing is delivered on a channel the socket has not been
 * granted.
 *
 * A platform operator connects as themselves and sees exactly the agency they
 * have entered, or nothing at all: there is no cross-agency firehose here,
 * because a socket that spans agencies is a socket one bug away from showing an
 * agency another agency's callers.
 */

/** The channels a subscriber may ask for. Anything else is refused by name. */
const ALLOWED_CHANNELS: readonly EventChannel[] = ['call.*', 'billing.*', 'recording.*'];

function isAllowedChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (ALLOWED_CHANNELS as readonly string[]).includes(value);
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channels?: unknown;
}

interface SocketPrincipal {
  tenantId: string;
  /** For the log line, so a connection can be traced to a credential. */
  via: 'api_key' | 'jwt';
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Who is on the other end of this socket, and which agency they act as.
 *
 * Returns null for anything it cannot verify. There is deliberately no branch
 * that produces a tenant from an environment variable, a query parameter or a
 * header naming one.
 */
async function authenticateWebSocket(
  fastify: FastifyInstance,
  request: FastifyRequest
): Promise<SocketPrincipal | null> {
  const query = (request.query ?? {}) as Record<string, unknown>;

  // Browsers cannot set headers on a WebSocket handshake, so the token may
  // arrive as a query parameter. That is a transport limitation, not a licence
  // to trust it: the value is still a credential that is verified below, and it
  // never names a tenant.
  const apiKey =
    (typeof request.headers['x-api-key'] === 'string'
      ? (request.headers['x-api-key'] as string)
      : undefined) ?? (typeof query.apiKey === 'string' ? query.apiKey : undefined);

  if (apiKey) {
    const prisma = getPrismaClient();
    const row = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(apiKey) },
      select: {
        tenantId: true,
        status: true,
        expiresAt: true,
        tenant: { select: { status: true } },
      },
    });

    if (!row || row.status !== 'ACTIVE') return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    if (row.tenant.status !== 'ACTIVE') return null;

    return { tenantId: row.tenantId, via: 'api_key' };
  }

  const authHeader = request.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : typeof query.token === 'string'
      ? query.token
      : undefined;

  if (!bearer) return null;

  let decoded: { userId?: string; tenantId?: string | null };
  try {
    decoded = fastify.jwt.verify(bearer);
  } catch {
    return null;
  }

  if (!decoded.userId) {
    // An API-only token with no user. Its tenant is the one it was minted for.
    return typeof decoded.tenantId === 'string' && decoded.tenantId.trim().length > 0
      ? { tenantId: decoded.tenantId.trim(), via: 'jwt' }
      : null;
  }

  // For a person, the token says who is asking and the database says which
  // agency they are in -- including, for NetEnroll staff, the one they have
  // entered. A stale tenant in a long-lived token decides nothing, exactly as
  // on the HTTP surface.
  const { loadPlatformContext } = await import('../lib/platform-admin.js');
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { tenantId: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') return null;

  const platform = await loadPlatformContext(decoded.userId);
  const tenantId = platform.isPlatformAdmin ? platform.actingTenantId : user.tenantId;

  // An operator in the cross-agency view gets no socket rather than a socket
  // over every agency at once.
  if (!tenantId) return null;

  return { tenantId, via: 'jwt' };
}

export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  await fastify.register(async function (scoped) {
    await scoped.register(import('@fastify/websocket'));

    scoped.get('/ws/events', { websocket: true }, async (connection, request) => {
      const auth = await authenticateWebSocket(fastify, request);

      if (!auth) {
        connection.socket.close(1008, 'Unauthorized');
        return;
      }

      const { tenantId } = auth;

      /**
       * What this socket has actually been granted. Empty until the client
       * asks: a connection is not a subscription, and delivering events the
       * subscriber never requested is how the old code came to deliver events
       * it had no business delivering.
       */
      const grantedChannels = new Set<EventChannel>();

      const unsubscribe = await eventBus.subscribePubSub(
        [...ALLOWED_CHANNELS],
        (channel, payload: EventPayload) => {
          // Two conditions, both required. The tenant comparison is the
          // boundary; the channel grant is what the subscriber asked for.
          if (payload.tenantId !== tenantId) return;
          if (!grantedChannels.has(channel)) return;

          connection.socket.send(JSON.stringify({ type: 'event', channel, payload }));
        }
      );

      connection.socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as WebSocketMessage;
          const requested = Array.isArray(data.channels) ? data.channels : [];

          switch (data.type) {
            case 'subscribe': {
              const refused = requested.filter(ch => !isAllowedChannel(ch));
              requested.filter(isAllowedChannel).forEach(ch => grantedChannels.add(ch));

              connection.socket.send(
                JSON.stringify({
                  type: 'subscribed',
                  channels: Array.from(grantedChannels),
                  // Named rather than silently dropped, so a client asking for
                  // something it cannot have learns that rather than waiting
                  // forever for events that will never arrive.
                  refused,
                })
              );
              break;
            }

            case 'unsubscribe':
              requested.filter(isAllowedChannel).forEach(ch => grantedChannels.delete(ch));
              connection.socket.send(
                JSON.stringify({
                  type: 'unsubscribed',
                  channels: Array.from(grantedChannels),
                })
              );
              break;

            case 'ping':
              connection.socket.send(
                JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() })
              );
              break;
          }
        } catch {
          connection.socket.send(
            JSON.stringify({ type: 'error', message: 'Invalid message format' })
          );
        }
      });

      connection.socket.on('close', () => {
        void unsubscribe();
      });

      connection.socket.on('error', (err: Error) => {
        console.error('WebSocket error:', err.message);
      });

      connection.socket.send(
        JSON.stringify({
          type: 'connected',
          // Deliberately not the tenant id: the client does not need it, and a
          // welcome frame is not the place to hand out an identifier the socket
          // never supplied.
          channels: [],
          timestamp: new Date().toISOString(),
        })
      );
    });
  });
}
