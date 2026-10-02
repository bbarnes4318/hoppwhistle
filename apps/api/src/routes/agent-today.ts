/**
 * The agent's Today.
 *
 *   GET /api/v1/agent/today?period=TODAY|YESTERDAY|LAST_7_DAYS
 *
 * The figures and the rules for them are in `services/agent/agent-today.ts`.
 * This file is the door, and the door's one job is WHOSE: the acting tenant
 * from `resolveTenant`, the person from the token. `period` is the only
 * parameter read. An `agentId` -- or anything else -- in the query string is
 * ignored rather than validated, the overwrite pattern `lib/agent-scope.ts`
 * describes: there is no value a caller can send that changes whose day comes
 * back.
 *
 * `authenticate`, not `requireAgencyPrincipal`: this is the agent's own
 * production, as `/delivery/me` is, and it loads nothing an agency is charged
 * from. An owner calling it gets their own (usually empty) day, which is
 * harmless and true.
 */

import type { FastifyInstance } from 'fastify';

import { resolveStateAuthority } from '../lib/licensed-states.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { isWhiteLabelAgent, type WhiteLabelPrincipal } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import { getAgentToday } from '../services/agent/agent-today.js';

import { isTodayPeriod, TODAY_PERIODS } from './white-label-today.js';

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerAgentTodayRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  fastify.get('/api/v1/agent/today', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const userId = getActingUserId(request);
    if (!userId) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'This view is for a signed-in agent' },
      });
    }

    const requested = (request.query as { period?: unknown } | undefined)?.period ?? 'TODAY';
    if (!isTodayPeriod(requested)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PERIOD',
          message: `period must be one of ${TODAY_PERIODS.join(', ')}`,
        },
      });
    }

    // The CRM narrows a state-restricted agent to their licensed states; the
    // follow-ups on Today are the same rows the CRM would list.
    const stateAuthority = await resolveStateAuthority(request, tenantId);

    const data = await getAgentToday(tenantId, userId, {
      prisma,
      period: requested,
      licensedStates: stateAuthority.restricted ? [...stateAuthority.licensed] : undefined,
      // A white-label agency's agents have no Leaderboard, so no rank on it either.
      withStanding: !isWhiteLabelAgent(request.user as WhiteLabelPrincipal | undefined),
    });
    return reply.send({ data });
  });
}
