/**
 * One DID, several agencies: round-robin across every member campaign's agents.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 * A DID whose route names a `SharedRoutingGroup` is not routed to one
 * campaign. Each ACTIVE member is either one agency's own campaign (all its
 * agents) or a single agent of any agency, added individually whether or not
 * they are on a campaign. For every call this module:
 *
 *   1. asks each member for its eligible agents, through the same
 *      `getEligibleEndpoints` a normal campaign call uses -- so the licence
 *      gate (caller's state), availability toggle, working hours, softphone
 *      registration and concurrency all apply exactly as they do there, and
 *      the member agency's own delivery gate is checked first;
 *   2. pools the agents from every member and puts them in round-robin order:
 *      whoever was offered (or answered) a call on this group least recently
 *      goes first;
 *   3. rings them ONE AT A TIME in that order, each for its own campaign's
 *      agent ring time, until someone answers.
 *
 * Two agencies licensed in a state therefore take turns on that state's
 * callers, and a state only one agency covers goes to that agency alone.
 *
 * ── Whose call it is ────────────────────────────────────────────────────────
 *
 * The answering agent's. `resolveSharedAnswerer` maps the answered leg's
 * `agent:<userId>` back to the member whose tenant that agent belongs to, and
 * the CDR handler records the call under that tenant and campaign: call log,
 * recording, disposition, billing and leaderboard all land with the agency
 * whose agent took it. A call nobody answered stays with the DID's owner.
 *
 * ── Only agents ─────────────────────────────────────────────────────────────
 *
 * Buyer endpoints on a member campaign are not offered. A shared DID exists to
 * share calls between agencies' agents, and a buyer leg would be credited to a
 * buyer of one tenant on a call that might be recorded under another.
 */

import { cellKey } from '../lib/agent-cell-forward.js';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { DEFAULT_AGENT_RING_SECONDS } from '../lib/route-destination.js';

import { isDeliveryAllowed } from './billing/delivery-gate.js';
import { getRedisClient } from './redis.js';
import {
  ringSeconds,
  routingService,
  taggedLeg,
  type CallData,
  type EligibleEndpoint,
} from './routing.js';

/** Redis sorted set: member = agent userId, score = last offered/answered (ms). */
export function rotationKey(groupId: string): string {
  return `shared-rr:${groupId}`;
}

/** Thirty days: a group nobody has called in a month starts its rotation over. */
const ROTATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Round-robin order: least recently offered first. An agent never offered has
 * a score of 0 and so goes ahead of everyone who has been. Ties keep the
 * caller's order, which is sorted by user id so it is stable call to call.
 */
export function orderByLeastRecent(
  candidates: string[],
  lastOffered: Map<string, number>
): string[] {
  return candidates
    .map((id, index) => ({ id, index, score: lastOffered.get(id) ?? 0 }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(entry => entry.id);
}

/*
 * Read the scores, order the candidates and mark the first one offered, in one
 * atomic step. Two calls arriving together must not both start with the same
 * agent: the second one sees the first agent's fresh score and starts with the
 * next.
 */
const ROTATE_SCRIPT = `
local scored = {}
for i = 2, #ARGV do
  local s = redis.call('ZSCORE', KEYS[1], ARGV[i])
  scored[#scored + 1] = { id = ARGV[i], idx = i, score = tonumber(s) or 0 }
end
table.sort(scored, function(a, b)
  if a.score ~= b.score then return a.score < b.score end
  return a.idx < b.idx
end)
local ordered = {}
for i = 1, #scored do ordered[i] = scored[i].id end
if #ordered > 0 then
  redis.call('ZADD', KEYS[1], ARGV[1], ordered[1])
  redis.call('EXPIRE', KEYS[1], ${ROTATION_TTL_SECONDS})
end
return ordered
`;

/* Used only when Redis cannot be reached, so calls still rotate per process. */
const localRotation = new Map<string, Map<string, number>>();

function localScores(groupId: string): Map<string, number> {
  let scores = localRotation.get(groupId);
  if (!scores) {
    scores = new Map();
    localRotation.set(groupId, scores);
  }
  return scores;
}

/** Put `candidates` in round-robin order and mark the first as offered now. */
export async function rotate(groupId: string, candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const now = Date.now();
  try {
    const result = (await getRedisClient().eval(
      ROTATE_SCRIPT,
      1,
      rotationKey(groupId),
      String(now),
      ...candidates
    )) as string[];
    if (Array.isArray(result) && result.length === candidates.length) return result;
  } catch (error) {
    logger.warn({
      msg: 'Shared routing: rotation state unavailable in Redis; rotating in-process',
      groupId,
      error: (error as Error).message,
    });
  }
  const scores = localScores(groupId);
  const ordered = orderByLeastRecent(candidates, scores);
  scores.set(ordered[0], now);
  return ordered;
}

/**
 * Move an agent to the back of the line: they just answered a call on this
 * group. Without this, an agent who answered after the first-offered agent
 * missed it would be first again on the very next call.
 */
export async function markAnswered(groupId: string, userId: string): Promise<void> {
  const now = Date.now();
  localScores(groupId).set(userId, now);
  try {
    const redis = getRedisClient();
    await redis.zadd(rotationKey(groupId), now, userId);
    await redis.expire(rotationKey(groupId), ROTATION_TTL_SECONDS);
  } catch (error) {
    logger.warn({
      msg: 'Shared routing: could not record the answering agent in the rotation',
      groupId,
      userId,
      error: (error as Error).message,
    });
  }
}

export interface SharedMember {
  tenantId: string;
  /** Null when the answering agent's calls are recorded under the agency alone. */
  campaignId: string | null;
}

export interface SharedRoutePlan {
  /** Steps of one agent each, `|`-separated, untagged. */
  endpoint: string;
  /** The same plan with every leg tagged with the agent it rings. */
  dialString: string;
  /** Ten-digit keys of legs that are agents' cells. */
  agentCellKeys: string[];
  /** Agent user ids in the order they will be rung. */
  order: string[];
}

interface AgentLeg {
  userId: string;
  endpoint: EligibleEndpoint;
  ringSeconds: number;
}

type GetEligible = (
  tenantId: string,
  campaignId: string | null,
  callData: CallData,
  options?: { onlyAgentUserIds?: string[] }
) => Promise<EligibleEndpoint[]>;

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Build the round-robin plan for one call to a shared group, or null when no
 * agent in any member agency can take it.
 *
 * A member is a whole campaign (its ACTIVE agents) or a single agent. Both
 * are gated the same way; an agent member just skips the campaign's agent
 * list, so they ring whether or not they are on any campaign.
 */
export async function selectSharedRoundRobin(
  groupId: string,
  callData: CallData,
  deps: {
    getEligibleEndpoints?: GetEligible;
    deliveryAllowed?: (tenantId: string) => Promise<{ allowed: boolean }>;
    rotate?: (groupId: string, candidates: string[]) => Promise<string[]>;
  } = {}
): Promise<SharedRoutePlan | null> {
  const prisma = getPrismaClient();
  const getEligible: GetEligible =
    deps.getEligibleEndpoints ??
    ((tenantId, campaignId, data, options) =>
      routingService.getEligibleEndpoints(tenantId, campaignId, data, options));
  const deliveryAllowedFn =
    deps.deliveryAllowed ?? ((tenantId: string) => isDeliveryAllowed(tenantId));
  const rotateFn = deps.rotate ?? rotate;

  // One gate read per agency per call, however many members it has.
  const gates = new Map<string, Promise<{ allowed: boolean }>>();
  const deliveryAllowed = (tenantId: string) => {
    let gate = gates.get(tenantId);
    if (!gate) {
      gate = deliveryAllowedFn(tenantId);
      gates.set(tenantId, gate);
    }
    return gate;
  };

  const group = await prisma.sharedRoutingGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      status: true,
      members: {
        where: { status: 'ACTIVE' },
        select: {
          tenantId: true,
          campaignId: true,
          userId: true,
          campaign: { select: { status: true, metadata: true, tenantId: true } },
          user: { select: { tenantId: true } },
        },
      },
    },
  });
  if (!group || group.status !== 'ACTIVE') {
    logger.warn({ msg: 'Shared routing: group missing or paused', groupId });
    return null;
  }

  // Every member at once: one slow agency must not hold up the others' legs.
  const perMember = await Promise.all(
    group.members.map(async member => {
      // A member always names its own agency's campaign and agent; a mismatch
      // means one of them moved, and is not this member's to offer.
      if (member.campaign && member.campaign.tenantId !== member.tenantId) return [];
      if (member.userId) {
        if (member.user?.tenantId !== member.tenantId) return [];
      } else if (!member.campaign || member.campaign.status !== 'ACTIVE') {
        return [];
      }

      const gate = await deliveryAllowed(member.tenantId);
      if (!gate.allowed) {
        logger.info({
          msg: 'Shared routing: member agency delivery held; skipping its agents',
          groupId,
          tenantId: member.tenantId,
        });
        return [];
      }

      const meta = metadataOf(member.campaign?.metadata);
      const seconds = ringSeconds(meta.agentRingSeconds, DEFAULT_AGENT_RING_SECONDS);

      try {
        const endpoints = member.userId
          ? await getEligible(member.tenantId, null, callData, {
              onlyAgentUserIds: [member.userId],
            })
          : await getEligible(member.tenantId, member.campaignId, callData);
        const legs: AgentLeg[] = [];
        for (const endpoint of endpoints) {
          const userId = endpoint.answeringUserId ?? endpoint.agentUserId;
          if (!userId) continue;
          legs.push({ userId, endpoint, ringSeconds: seconds });
        }
        return legs;
      } catch (error) {
        // One member's failure loses its agents, not the whole call.
        logger.error({
          msg: 'Shared routing: could not read a member; skipping it',
          groupId,
          tenantId: member.tenantId,
          campaignId: member.campaignId,
          userId: member.userId,
          error: (error as Error).message,
        });
        return [];
      }
    })
  );

  // One leg per agent. An agent reached twice (on a member campaign and as an
  // agent member, or by softphone and assigned DID) keeps the first.
  const byAgent = new Map<string, AgentLeg>();
  for (const leg of perMember.flat()) {
    if (!leg.endpoint.destination.trim()) continue;
    if (!byAgent.has(leg.userId)) byAgent.set(leg.userId, leg);
  }
  if (byAgent.size === 0) return null;

  const candidates = [...byAgent.keys()].sort();
  const order = await rotateFn(groupId, candidates);

  const legs = order.map(userId => byAgent.get(userId)).filter((l): l is AgentLeg => !!l);
  const plan: SharedRoutePlan = {
    endpoint: legs.map(leg => leg.endpoint.destination.trim()).join('|'),
    dialString: legs.map(leg => taggedLeg(leg.endpoint, leg.ringSeconds)).join('|'),
    agentCellKeys: [
      ...new Set(
        legs.filter(leg => leg.endpoint.agentCell).map(leg => cellKey(leg.endpoint.destination))
      ),
    ],
    order: legs.map(leg => leg.userId),
  };

  logger.info({
    msg: 'Shared routing: round-robin plan',
    groupId,
    callerId: callData.callerId,
    order: plan.order,
  });
  return plan;
}

/**
 * Where a call answered by `userId` is recorded: that agent's own agency, and
 * the campaign it goes under there --
 *
 *   - the agent's own member's campaign, when they were added individually
 *     and given one;
 *   - otherwise the agency's campaign member in the group, if it has one;
 *   - otherwise no campaign: the call is the agency's and the agent's alone.
 *
 * Null when the agent's agency is not in the group at all, either way -- the
 * call then stays with the DID's owner.
 */
export async function resolveSharedAnswerer(
  groupId: string,
  userId: string
): Promise<SharedMember | null> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });
  if (!user?.tenantId) return null;

  const members = await prisma.sharedRoutingGroupMember.findMany({
    where: { groupId, tenantId: user.tenantId },
    select: { tenantId: true, campaignId: true, userId: true },
  });
  const own = members.find(m => m.userId === userId);
  const campaignMember = members.find(m => !m.userId && m.campaignId);
  if (!own && !campaignMember) return null;

  return {
    tenantId: user.tenantId,
    campaignId: own?.campaignId ?? campaignMember?.campaignId ?? null,
  };
}
