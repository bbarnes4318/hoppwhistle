/**
 * Caller-ID pool state inventory (authenticated, tenant-scoped).
 *
 *   GET /api/v1/caller-id-pools/state-inventory[?pool=<name>]
 *
 * Operator visibility for state-matched outbound caller-ID pools (Dograh):
 * totals, per-state counts, states with zero inventory, and numbers missing
 * state metadata. Never exposes carrier credentials or SIP secrets — only
 * number inventory the tenant already owns.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getStateFromPhoneNumber, isValidStateCode } from '../lib/geo.js';
import { getPrismaClient } from '../lib/prisma.js';
import { DOGRAH_CALLER_ID_POOL_NAME } from '../services/dograh-caller-id-import.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerCallerIdInventoryRoutes(server: FastifyInstance) {
  const prisma = getPrismaClient();

  server.get(
    '/api/v1/caller-id-pools/state-inventory',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { tenantId?: string } | undefined;
      const tenantId = user?.tenantId;
      if (!tenantId) {
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const query = request.query as { pool?: string };
      const poolName = query.pool || DOGRAH_CALLER_ID_POOL_NAME;

      const pool = await prisma.callerIdPool.findFirst({
        where: { tenantId, name: poolName },
        select: { id: true, name: true, status: true },
      });
      if (!pool) {
        return reply.code(404).send({ error: 'pool_not_found', pool: poolName });
      }

      const members = await prisma.callerIdPoolPhoneNumber.findMany({
        where: { callerIdPoolId: pool.id, phoneNumber: { tenantId } },
        select: {
          phoneNumber: {
            select: {
              number: true,
              status: true,
              provider: true,
              metadata: true,
              lastAssignedAt: true,
            },
          },
        },
      });

      const byState: Record<
        string,
        { total: number; active: number; lastAssignedAt: string | null }
      > = {};
      const missingStateMetadata: string[] = [];
      let activeTotal = 0;

      for (const m of members) {
        const pn = m.phoneNumber;
        const meta =
          pn.metadata && typeof pn.metadata === 'object' && !Array.isArray(pn.metadata)
            ? (pn.metadata as Record<string, unknown>)
            : {};
        const metaState = typeof meta.state === 'string' ? meta.state : null;
        const state = metaState || getStateFromPhoneNumber(pn.number);
        if (!metaState) missingStateMetadata.push(pn.number);
        if (!state) continue;

        const entry = (byState[state] ||= { total: 0, active: 0, lastAssignedAt: null });
        entry.total++;
        if (pn.status === 'ACTIVE') {
          entry.active++;
          activeTotal++;
        }
        if (pn.lastAssignedAt) {
          const iso = pn.lastAssignedAt.toISOString();
          if (!entry.lastAssignedAt || iso > entry.lastAssignedAt) {
            entry.lastAssignedAt = iso;
          }
        }
      }

      const coveredStates = new Set(Object.keys(byState));
      const allStates = [
        'AL',
        'AK',
        'AZ',
        'AR',
        'CA',
        'CO',
        'CT',
        'DE',
        'FL',
        'GA',
        'HI',
        'ID',
        'IL',
        'IN',
        'IA',
        'KS',
        'KY',
        'LA',
        'ME',
        'MD',
        'MA',
        'MI',
        'MN',
        'MS',
        'MO',
        'MT',
        'NE',
        'NV',
        'NH',
        'NJ',
        'NM',
        'NY',
        'NC',
        'ND',
        'OH',
        'OK',
        'OR',
        'PA',
        'RI',
        'SC',
        'SD',
        'TN',
        'TX',
        'UT',
        'VT',
        'VA',
        'WA',
        'WV',
        'WI',
        'WY',
        'DC',
      ].filter(isValidStateCode as (s: string) => boolean);

      return reply.send({
        pool: { id: pool.id, name: pool.name, status: pool.status },
        totalNumbers: members.length,
        activeNumbers: activeTotal,
        byState: Object.fromEntries(Object.entries(byState).sort(([a], [b]) => a.localeCompare(b))),
        statesWithZeroInventory: allStates.filter(s => !coveredStates.has(s)),
        numbersMissingStateMetadata: missingStateMetadata,
      });
    }
  );
}
