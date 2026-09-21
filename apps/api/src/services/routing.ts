import { extractAreaCode, getStateFromAreaCode, isCallerStateAccepted } from '../lib/geo.js';
import { normalizeLicensedStates } from '../lib/licensed-states.js';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { agencyClock, isWithinSchedule } from './telephony/agent-schedule.js';
import type { LocalClock } from './telephony/agent-schedule.js';

const INTERNAL_EXTENSION_RE = /^\d{4}$/;
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInternalAgentDestination(destination: string): boolean {
  const normalized = destination.trim();
  return INTERNAL_EXTENSION_RE.test(normalized) || USER_ID_RE.test(normalized);
}

/**
 * Call data context for routing decisions.
 * Includes caller identification and geo data.
 */
export interface CallData {
  /** Caller's phone number (ANI) in E.164 or 10-digit format */
  callerId?: string | null;
  /** Pre-resolved caller area code (3 digits) */
  callerAreaCode?: string | null;
  /** Pre-resolved caller state (2-letter code) */
  callerState?: string | null;
  /** Caller's ZIP code if available */
  callerZipCode?: string | null;
}

/**
 * Eligible buyer endpoint with geo-routing and weight metadata.
 */
export interface EligibleEndpoint {
  buyerId: string;
  buyerName: string;
  endpointId: string | null;
  destination: string;
  priority: number;
  weight: number;
  acceptedStates: string[];
  /** Whether this is a "National" endpoint (no state restrictions) */
  isNational: boolean;
  /**
   * When a campaign destination was an agent-assigned DID that we translated to
   * the agent's softphone extension, this preserves the original external DID.
   * It is only dialed as a final failover step when the campaign explicitly
   * enables external fallback (campaign.metadata.allowAgentDidExternalFallback).
   */
  externalFallbackDestination?: string | null;
}

/** Normalize phone-number-ish strings to their last 10 digits for comparison. */
function normalizeDidKey(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export class RoutingService {
  private prisma = getPrismaClient();

  /**
   * Resolve caller's state from available call data.
   * Uses pre-resolved state if available, otherwise extracts from callerId.
   */
  resolveCallerState(callData: CallData): string | null {
    if (callData.callerState) {
      return callData.callerState.toUpperCase().trim();
    }

    if (callData.callerAreaCode) {
      const state = getStateFromAreaCode(callData.callerAreaCode);
      if (state) return state;
    }

    if (callData.callerId) {
      const areaCode = extractAreaCode(callData.callerId);
      if (areaCode) {
        return getStateFromAreaCode(areaCode);
      }
    }

    return null;
  }

  /**
   * Get all eligible buyer endpoints for a campaign, filtered by geo-routing,
   * concurrency, and agent availability rules.
   */
  async getEligibleEndpoints(
    tenantId: string,
    campaignId: string,
    callData: CallData
  ): Promise<EligibleEndpoint[]> {
    const callerState = this.resolveCallerState(callData);

    logger.info({
      msg: 'Geo-routing: Resolving caller state',
      callerId: callData.callerId,
      callerAreaCode: callData.callerAreaCode,
      resolvedState: callerState,
    });

    const campaignBuyers = await this.prisma.campaignBuyer.findMany({
      where: {
        campaignId,
        status: 'ACTIVE',
        tenantId,
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        buyerEndpoint: {
          select: {
            id: true,
            name: true,
            status: true,
            maxConcurrency: true,
            acceptedStates: true,
            weight: true,
          },
        },
      },
    });

    const allEndpoints: EligibleEndpoint[] = [];

    for (const assignment of campaignBuyers) {
      if (assignment.buyer.status !== 'ACTIVE') {
        continue;
      }

      if (assignment.buyerEndpoint && assignment.buyerEndpoint.status !== 'ACTIVE') {
        continue;
      }

      const ep = assignment.buyerEndpoint;
      const acceptedStates = ep?.acceptedStates || [];

      allEndpoints.push({
        buyerId: assignment.buyerId,
        buyerName: assignment.buyer.name,
        endpointId: assignment.buyerEndpointId,
        destination: assignment.destinationNumber,
        priority: assignment.priority,
        weight: assignment.weight,
        acceptedStates,
        isNational: acceptedStates.length === 0,
      });
    }

    /*
     * The agency's own agents, from `campaign_agents`.
     *
     * ── Why this exists ──────────────────────────────────────────────────────
     *
     * Until now the ONLY way an agent could be rung was for somebody to build
     * them a `BuyerEndpoint` and attach it to the campaign -- a screen an
     * agency principal cannot reach (`lib/staff-only-routes.ts` holds
     * `/buyers` and `/campaigns`). So "the agency adds its agents and sets them
     * up to receive calls" required NetEnroll staff for every agent, and
     * `CampaignAgent` sat in the schema, documented as the dialer's hot read,
     * with nothing reading or writing it.
     *
     * An assignment made on the agency's own roster screen now produces a
     * destination here.
     *
     * ── It is a source of destinations, not a second routing system ──────────
     *
     * These rows join `allEndpoints` BEFORE every gate below, so an agent
     * assigned this way is held to exactly the same rules as one reached
     * through a buyer endpoint: the accepted-state filter, the licence gate,
     * and the concurrency limit, in that order. Nothing here grants anything.
     *
     * ── The destination is the extension, resolved here ──────────────────────
     *
     * A buyer endpoint stores a destination string that the translation pass
     * below has to map back to an agent. A `CampaignAgent` row names the agent
     * directly, so the extension is read straight from their credential and no
     * translation is needed or attempted. An agent with no ACTIVE credential
     * has no softphone to ring and is skipped -- they appear on the roster
     * screen with "Has not opened the softphone yet", which is the actionable
     * form of the same fact.
     *
     * `acceptedStates` is empty: an agent's geography is their LICENCE, which
     * the gate below reads from `metadata.licensedStates`. Copying it into a
     * second field here would be a second copy to disagree with the first.
     */
    try {
      const agentAssignments = await this.prisma.campaignAgent.findMany({
        where: { tenantId, campaignId, status: 'ACTIVE' },
        select: {
          userId: true,
          priority: true,
          user: {
            select: {
              id: true,
              status: true,
              firstName: true,
              lastName: true,
              email: true,
              sipCredential: {
                select: { extension: true, status: true, passwordEncrypted: true },
              },
            },
          },
        },
      });

      for (const assignment of agentAssignments) {
        const agent = assignment.user;
        if (agent.status !== 'ACTIVE') continue;

        const credential = agent.sipCredential;
        // A reservation (null password) cannot authenticate, so its extension
        // cannot register and ringing it is a call into nothing.
        if (!credential || credential.status !== 'ACTIVE' || !credential.passwordEncrypted) {
          logger.info({
            msg: 'Agent-routing: campaign agent has no usable SIP credential; not a destination',
            userId: agent.id,
            campaignId,
          });
          continue;
        }

        allEndpoints.push({
          /*
           * `buyerId` is the AGENT's id, and `endpointId` is null. This is not
           * a buyer: the field carries the routed party's identity through the
           * pipeline below, which logs it and matches on it, and putting the
           * agent's id there is what makes the concurrency gate and the licence
           * gate resolve the same agent the destination belongs to.
           */
          buyerId: agent.id,
          buyerName:
            [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email || agent.id,
          endpointId: null,
          destination: credential.extension,
          priority: assignment.priority ?? 0,
          weight: 100,
          acceptedStates: [],
          isNational: true,
        });
      }
    } catch (agentErr) {
      /*
       * Its own try/catch, so a failure here cannot take the buyer-endpoint
       * destinations down with it. Losing the agency's agents is bad; losing
       * every destination on the campaign is an outage.
       */
      logger.error({
        msg: 'Agent-routing: could not read campaign agent assignments',
        campaignId,
        error: (agentErr as Error).message,
      });
    }

    let eligibleEndpoints = allEndpoints.filter(ep => {
      const isAccepted = isCallerStateAccepted(callerState, ep.acceptedStates);

      if (!isAccepted) {
        logger.info({
          msg: 'Geo-routing: Endpoint EXCLUDED (state not accepted)',
          buyerId: ep.buyerId,
          buyerName: ep.buyerName,
          endpointId: ep.endpointId,
          callerState,
          acceptedStates: ep.acceptedStates,
        });
      }

      return isAccepted;
    });

    const activeTargetIds = eligibleEndpoints
      .map(ep => ep.endpointId)
      .filter((id): id is string => id !== null);

    if (activeTargetIds.length > 0) {
      try {
        const { liveStatusService } = await import('./buyer-live-status-service.js');
        const liveStatusMap = await liveStatusService.getTargetsLiveStatus(activeTargetIds);

        eligibleEndpoints = eligibleEndpoints.filter(ep => {
          if (!ep.endpointId) return true;

          const dbAssignment = campaignBuyers.find(cb => cb.buyerEndpointId === ep.endpointId);
          const maxConcurrency = dbAssignment?.buyerEndpoint?.maxConcurrency ?? 10;
          const liveCalls = liveStatusMap.get(ep.endpointId) || 0;
          const isFull = maxConcurrency > 0 && liveCalls >= maxConcurrency;

          if (isFull) {
            logger.info({
              msg: 'Concurrency-routing: Endpoint EXCLUDED (at capacity)',
              buyerId: ep.buyerId,
              buyerName: ep.buyerName,
              endpointId: ep.endpointId,
              liveCalls,
              maxConcurrency,
            });
          }

          return !isFull;
        });
      } catch (err) {
        logger.error('Error checking concurrency (fail-open):', err);
      }
    }

    // Internal softphones register with a four-digit extension. Older campaign
    // assignments may still contain the user's UUID, so translate those legacy
    // destinations before returning the route to FreeSWITCH.
    try {
      // Per-agent call-concurrency limit (users.metadata.maxConcurrentCalls,
      // default 1, global default via env AGENT_DEFAULT_MAX_CONCURRENT_CALLS).
      // Ported from the live-deployed concurrency fix (also in PR #3) — an agent
      // endpoint is excluded only when the agent is actually AT their limit,
      // never merely for a stale offline/DND availability flag.
      const DEFAULT_MAX_CONCURRENT = Math.max(
        1,
        parseInt(process.env.AGENT_DEFAULT_MAX_CONCURRENT_CALLS || '1', 10) || 1
      );

      const users = await this.prisma.user.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, metadata: true, availableForCalls: true },
      });

      /*
       * Which agents have declared themselves OFF the queue.
       *
       * A set of the unavailable rather than the available, so that an agent
       * missing from this map -- a row that failed to load, a user the query
       * did not return -- reads as AVAILABLE. Inverting it would turn any gap
       * in this read into an agent silently taken off the queue.
       */
      const unavailableUsers = new Set(
        users.filter(user => user.availableForCalls === false).map(user => user.id)
      );

      /*
       * Each agent's SIP extension, from `agent_sip_credentials`.
       *
       * This is the authoritative map. `users.metadata.extension` is still read
       * below and still populates these maps, but only for an agent who has no
       * credential row yet -- and a credential row always wins over metadata
       * for an agent who has both.
       *
       * The two can legitimately disagree. The migration claimed each agent's
       * pre-existing extension where it was free, and where two agencies held
       * the SAME extension -- which the old per-agency allocator guaranteed for
       * every agency past the first -- only the oldest agent kept it. Everyone
       * else is allocated a fresh extension on their next credential fetch,
       * while their stale `metadata.extension` still names the number that now
       * belongs to somebody in another agency. Preferring metadata there would
       * route this agency's call to that other agency's agent, which is the
       * exact defect the credential table exists to close.
       *
       * REVOKED credentials are excluded: a revoked identity keeps its
       * extension reserved so it is not reissued, but nothing should be rung
       * on it.
       */
      const extensionToUserMap = new Map<string, string>();
      const userIdToExtensionMap = new Map<string, string>();

      /*
       * Its OWN try/catch, and not the enclosing one, deliberately.
       *
       * The enclosing block fails open: a throw anywhere in it is logged and
       * skips the WHOLE agent filter -- the licence gate and the concurrency
       * gate with it. That is a defensible default for a status lookup, and a
       * dangerous one for this read, because this read can fail for a reason
       * the others cannot: code deployed ahead of the migration, where
       * `agent_sip_credentials` does not exist yet. Letting that bubble would
       * take the LICENCE GATE down platform-wide -- an agent rung for a state
       * they cannot write -- as a side effect of a table being absent.
       *
       * So a failure here degrades to exactly one thing: no credential-backed
       * mappings, and `metadata.extension` below supplies them instead, which
       * is precisely the behaviour before this table existed.
       */
      try {
        const credentials = await this.prisma.agentSipCredential.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { userId: true, extension: true },
        });

        for (const credential of credentials) {
          extensionToUserMap.set(credential.extension, credential.userId);
          userIdToExtensionMap.set(credential.userId, credential.extension);
        }
      } catch (credentialErr) {
        logger.warn({
          msg: 'Agent-routing: could not read SIP credentials; falling back to users.metadata.extension',
          tenantId,
          error: (credentialErr as Error).message,
        });
      }

      /*
       * Each agent's working hours, and what time it is for this agency.
       *
       * ── Why this exists ──────────────────────────────────────────────────
       *
       * `AgencyProfile` carries delivery days and hours for the WHOLE agency,
       * and routing knew nothing about hours at all. An agency running two
       * shifts could not express it, so an agent who finished at 2pm kept
       * being rung at 7pm: the call reached a phone nobody was sitting at and
       * was not offered to the agent who was.
       *
       * ── Read once, applied to everybody ──────────────────────────────────
       *
       * One query for the agency's schedules and one `Intl` resolution of its
       * clock, shared by every candidate below. Asking per agent would resolve
       * the same timezone N times and, worse, could land two agents in one
       * agency on different days if the read straddled midnight.
       *
       * ── Empty is not a constraint ────────────────────────────────────────
       *
       * An agent with no row is NOT restricted -- every agent starts without
       * one, and the gate below is written so that an empty map excludes
       * nobody. A failure here leaves the map empty and the clock null, which
       * is exactly the "enforce nothing" state.
       */
      const schedulesByUser = new Map<
        string,
        { days: string[]; startTime: string; endTime: string }
      >();
      let agencyLocalClock: LocalClock | null = null;

      try {
        const [scheduleRows, profile] = await Promise.all([
          this.prisma.agentSchedule.findMany({
            where: { tenantId },
            select: { userId: true, days: true, startTime: true, endTime: true },
          }),
          this.prisma.agencyProfile.findUnique({
            where: { tenantId },
            select: { deliveryTimeZone: true },
          }),
        ]);

        for (const row of scheduleRows) {
          schedulesByUser.set(row.userId, {
            days: row.days,
            startTime: row.startTime,
            endTime: row.endTime,
          });
        }

        /*
         * Only resolve the clock if somebody actually has a schedule. An
         * agency with none needs no clock, and skipping it keeps the common
         * case free.
         */
        if (schedulesByUser.size > 0) {
          agencyLocalClock = agencyClock(profile?.deliveryTimeZone ?? 'America/New_York');
        }
      } catch (scheduleErr) {
        logger.warn({
          msg: 'Agent-schedule: could not read working hours; not enforcing them',
          tenantId,
          error: (scheduleErr as Error).message,
        });
      }
      const agentMaxConcurrent = new Map<string, number>();
      /**
       * Each agent's licensed jurisdictions, from the same `metadata` this loop
       * is already reading -- so the licence gate below costs no extra query.
       *
       * An agent with no entry, or an empty one, is UNCONFIGURED, and the gate
       * treats that differently from "licensed nowhere". See the gate itself.
       */
      const agentLicensedStates = new Map<string, Set<string>>();

      for (const user of users) {
        if (!user.metadata || typeof user.metadata !== 'object' || Array.isArray(user.metadata)) {
          continue;
        }

        const meta = user.metadata as Record<string, unknown>;
        const rawMax = meta.maxConcurrentCalls;
        const parsedMax = typeof rawMax === 'number' ? rawMax : parseInt(String(rawMax), 10);
        agentMaxConcurrent.set(
          user.id,
          Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_CONCURRENT
        );

        // Normalised through the same helper the CRM gate uses, so a row that
        // stores a lower-case or unrecognised code is read identically by both.
        const licensed = normalizeLicensedStates(meta.licensedStates);
        if (licensed.length > 0) agentLicensedStates.set(user.id, new Set(licensed));

        /*
         * The legacy source, kept as a FALLBACK for an agent who has not yet
         * been provisioned a credential -- an agent who has never opened the
         * softphone since this shipped still has to be reachable.
         *
         * Skipped entirely for an agent who HAS a credential: see the note on
         * the credential read above for why metadata must not win there.
         */
        if (userIdToExtensionMap.has(user.id)) continue;

        const extension = meta.extension;
        if (typeof extension !== 'string' && typeof extension !== 'number') continue;

        const normalizedExtension = extension.toString().trim();
        if (!normalizedExtension) continue;

        /*
         * And never let a metadata value claim an extension that a credential
         * has already mapped to a different agent. That is the stale-collision
         * case above; the credential holder owns the number.
         */
        if (extensionToUserMap.has(normalizedExtension)) continue;

        extensionToUserMap.set(normalizedExtension, user.id);
        userIdToExtensionMap.set(user.id, normalizedExtension);
      }

      // Agent-assigned DIDs. Campaign buyer rows frequently store an agent's
      // external DID (e.g. +18656000039) rather than their extension; dialing
      // that DID out via a PSTN gateway rings nothing when the number simply
      // forwards back to us — the agent's registered softphone is the real
      // destination. Map DID → owning user so those legs ring the extension,
      // and userId → DIDs so live calls landing on a DID count toward the
      // agent's concurrency limit.
      const didToUserMap = new Map<string, string>();
      const userToDids = new Map<string, string[]>();
      const agentDids = await this.prisma.phoneNumber.findMany({
        where: { tenantId, userId: { not: null } },
        select: { number: true, userId: true },
      });
      for (const row of agentDids) {
        if (!row.number || !row.userId) continue;
        didToUserMap.set(normalizeDidKey(row.number), row.userId);
        const arr = userToDids.get(row.userId) || [];
        arr.push(row.number);
        userToDids.set(row.userId, arr);
      }

      if (extensionToUserMap.size > 0 || userIdToExtensionMap.size > 0 || didToUserMap.size > 0) {
        const { getRedisClient } = await import('./redis.js');
        const redis = getRedisClient();

        /*
         * Once per routing decision, not once per candidate. The service
         * caches the parsed table for a few seconds, so a burst of calls
         * shares one ESL lookup rather than one per agent per call.
         */
        const { getRegisteredExtensions } = await import('./telephony/sip-registrations.js');
        const registeredExtensions = await getRegisteredExtensions();

        const statuses = await Promise.all(
          eligibleEndpoints.map(async ep => {
            const originalDestination = ep.destination.trim();
            const legacyExtension = userIdToExtensionMap.get(originalDestination);
            let normalizedEndpoint = legacyExtension ? { ...ep, destination: legacyExtension } : ep;
            let userId = legacyExtension
              ? originalDestination
              : extensionToUserMap.get(originalDestination);

            if (legacyExtension) {
              logger.info({
                msg: 'Agent-routing: Translated legacy user UUID to SIP extension',
                userId: originalDestination,
                extension: legacyExtension,
                campaignId,
              });
            }

            // Agent DID → softphone extension translation.
            if (!userId) {
              const didUserId = didToUserMap.get(normalizeDidKey(originalDestination));
              const didExtension = didUserId ? userIdToExtensionMap.get(didUserId) : undefined;
              if (didUserId && didExtension) {
                normalizedEndpoint = {
                  ...ep,
                  destination: didExtension,
                  externalFallbackDestination: originalDestination,
                };
                userId = didUserId;
                logger.info({
                  msg: 'Agent-routing: Translated agent-assigned DID to SIP extension',
                  did: originalDestination,
                  extension: didExtension,
                  userId: didUserId,
                  campaignId,
                });
              }
            }

            if (!userId) {
              return { ep: normalizedEndpoint, eligible: true };
            }

            /*
             * Licence gate: an agent is not rung for a state they cannot write.
             *
             * `metadata.licensedStates` already decides which CRM leads an
             * agent may open (`lib/licensed-states.ts`). Until this existed it
             * decided nothing about calls, so the same agent the CRM refused to
             * show a Tennessee lead would be rung by a Tennessee caller and
             * would sell to them on the phone. The two gates now read the one
             * list.
             *
             * ── Unconfigured is not "licensed nowhere" ───────────────────────
             *
             * This is the whole reason the rule here is not the CRM's.
             * `docs/AGENT_LICENSED_STATES_ROLLOUT.md` records that there is no
             * licence data to back-fill from and that every agent therefore
             * starts with nothing. The CRM can default to deny on that and cost
             * an agent a lead list. Routing cannot: deny-by-default on a
             * database that has never recorded a licence excludes EVERY agent
             * from EVERY state-identified call, which is not a compliance
             * posture, it is the phones not ringing.
             *
             * So an agent with no licence recorded is not filtered here, and an
             * agent WITH one is held to it exactly. Enforce what you have been
             * told; do not invent a constraint from the absence of data. The
             * users screen marks every unconfigured agent so the gap is visible
             * rather than inferred from a quiet call centre.
             *
             * ── And a call with no state is not a call in the wrong state ────
             *
             * `callerState` is null when the ANI is withheld or its area code
             * resolves to nothing. Excluding licensed agents from those calls
             * would drop traffic on a fact nobody established, so a stateless
             * call passes every licence.
             */
            const licensed = agentLicensedStates.get(userId);
            if (callerState && licensed && !licensed.has(callerState)) {
              logger.info({
                msg: 'Agent-licence: Endpoint EXCLUDED (agent not licensed in caller state)',
                buyerId: normalizedEndpoint.buyerId,
                buyerName: normalizedEndpoint.buyerName,
                destination: normalizedEndpoint.destination,
                userId,
                callerState,
                licensedStates: [...licensed].sort(),
                campaignId,
              });
              return { ep: normalizedEndpoint, eligible: false };
            }

            /*
             * The agent's own switch: they said they are not taking calls.
             *
             * Checked first because it costs nothing -- the flag came back on
             * the user query this loop already ran -- and because it is the
             * most direct statement there is. An agent at lunch is not
             * off-shift, is still registered, and is under their concurrency
             * limit; every other gate would pass them.
             *
             * This is NOT the Redis presence key. That one is written by the
             * browser on every SIP lifecycle event -- including an
             * unconditional 'available' on reconnect, which silently undid an
             * agent's own choice -- and the concurrency comment below records
             * why it is ignored. This flag is a deliberate, durable
             * declaration that nothing automatic writes, which is precisely
             * what makes it safe to obey.
             */
            if (unavailableUsers.has(userId)) {
              logger.info({
                msg: 'Agent-availability: Endpoint EXCLUDED (agent has turned their phone off)',
                userId,
                destination: normalizedEndpoint.destination,
                campaignId,
              });
              return { ep: normalizedEndpoint, eligible: false };
            }

            /*
             * Working-hours gate: do not ring an agent who is off shift.
             *
             * Checked before registration because it is the cheaper question
             * and the more common exclusion -- an off-shift agent has usually
             * closed the tab, so this saves asking about a registration that
             * is not there either.
             *
             * `isWithinSchedule` answers TRUE for an agent with no schedule and
             * true when the clock could not be resolved, so an agency that has
             * configured nothing is unaffected and a timezone failure enforces
             * nothing. Only a schedule that positively excludes this moment
             * excludes an agent.
             */
            if (!isWithinSchedule(schedulesByUser.get(userId), agencyLocalClock)) {
              logger.info({
                msg: 'Agent-schedule: Endpoint EXCLUDED (agent is outside their working hours)',
                userId,
                destination: normalizedEndpoint.destination,
                campaignId,
              });
              return { ep: normalizedEndpoint, eligible: false };
            }

            /*
             * Registration gate: do not ring a softphone that is not there.
             *
             * This is NOT the availability flag, and the distinction is the
             * whole point. That flag is written by the browser, goes stale when
             * a tab closes or a laptop sleeps, and the comment below records
             * why it is deliberately ignored. This is FreeSWITCH's own
             * registration table -- the same fact the dialplan consults with
             * `sofia_contact` before it bridges -- and it cannot go stale in
             * the direction that matters, because an expired registration is
             * removed rather than left behind.
             *
             * The failure it closes is recorded in `routes/agent-phone.ts`: an
             * agent on a network that blocks 7443 fetched credentials fine,
             * never opened the WebSocket, never sent a REGISTER, "and every
             * call to them died with USER_NOT_REGISTERED while the dashboard
             * still showed them available". Those calls were delivered to
             * nobody and were not offered to an agent who could have taken
             * them.
             *
             * `registeredExtensions` is null when the registrar could not be
             * read, and null means DO NOT FILTER -- see the service for why
             * "cannot tell" must never collapse into "nobody is registered".
             */
            if (registeredExtensions && !registeredExtensions.has(normalizedEndpoint.destination)) {
              logger.info({
                msg: 'Agent-registration: Endpoint EXCLUDED (softphone is not registered)',
                userId,
                destination: normalizedEndpoint.destination,
                campaignId,
              });
              return { ep: normalizedEndpoint, eligible: false };
            }

            // Concurrency gate. We deliberately do NOT exclude an agent merely
            // for being offline or DND — that availability flag is often stale
            // and over-blocks transfers; the registration gate above is the
            // reliable form of the same question. The agent is excluded here
            // only when their live active-call count is at their limit. The
            // Redis "on a call" flag (currentCallId) is a floor so a
            // just-started call that hasn't landed in the Call table yet still
            // counts.
            const maxConcurrent = agentMaxConcurrent.get(userId) ?? DEFAULT_MAX_CONCURRENT;

            let onCallFloor = 0;
            try {
              const data = await redis.get(`agent:status:${userId}`);
              if (data) {
                const statusData = JSON.parse(data) as { currentCallId?: string | null };
                if (statusData?.currentCallId) onCallFloor = 1;
              }
            } catch (redisErr) {
              logger.warn({
                msg: 'Agent-status: Redis lookup error (ignored; using DB count)',
                userId,
                error: (redisErr as Error).message,
              });
            }

            let activeCalls = 0;
            try {
              const dids = userToDids.get(userId) || [];
              const orConds: Array<Record<string, unknown>> = [{ createdById: userId }];
              if (dids.length) {
                orConds.push({ toNumber: { in: dids } });
                orConds.push({ targetNumber: { in: dids } });
              }
              // Only count PLAUSIBLY-live calls. Call rows whose CDR never
              // arrived (e.g. a FreeSWITCH restart mid-call) stay open forever
              // and would permanently exclude the agent. A ring can't outlive
              // ~15 minutes; an answered call is capped at 4 hours here.
              const now = Date.now();
              const ringingSince = new Date(now - 15 * 60 * 1000);
              const answeredSince = new Date(now - 4 * 60 * 60 * 1000);
              activeCalls = await this.prisma.call.count({
                where: {
                  tenantId,
                  OR: orConds,
                  AND: [
                    {
                      OR: [
                        {
                          status: { in: ['INITIATED', 'RINGING'] },
                          createdAt: { gte: ringingSince },
                        },
                        { status: 'ANSWERED', createdAt: { gte: answeredSince } },
                      ],
                    },
                  ],
                },
              });
            } catch (countErr) {
              logger.warn({
                msg: 'Agent-concurrency: count error (fail-open)',
                userId,
                error: (countErr as Error).message,
              });
              return { ep: normalizedEndpoint, eligible: true };
            }

            const effectiveActive = Math.max(activeCalls, onCallFloor);
            if (effectiveActive >= maxConcurrent) {
              logger.info({
                msg: 'Agent-concurrency: Endpoint EXCLUDED (agent at call limit)',
                buyerId: normalizedEndpoint.buyerId,
                buyerName: normalizedEndpoint.buyerName,
                destination: normalizedEndpoint.destination,
                userId,
                activeCalls: effectiveActive,
                maxConcurrent,
              });
              return { ep: normalizedEndpoint, eligible: false };
            }

            return { ep: normalizedEndpoint, eligible: true };
          })
        );

        eligibleEndpoints = statuses.filter(status => status.eligible).map(status => status.ep);
      }
    } catch (err) {
      logger.error('Error applying agent status filter:', err);
    }

    logger.info({
      msg: 'Geo/Concurrency-routing: Filtering complete',
      campaignId,
      callerState,
      totalEndpoints: allEndpoints.length,
      eligibleEndpoints: eligibleEndpoints.length,
      excludedCount: allEndpoints.length - eligibleEndpoints.length,
    });

    return eligibleEndpoints;
  }

  /**
   * Select the best destination for a campaign. Internal softphone-only campaigns
   * behave as ring groups: every available agent at the same priority rings in
   * parallel, with lower-priority groups used as sequential failover steps.
   * External buyer campaigns retain weighted selection behavior.
   */
  async selectBestBuyer(
    tenantId: string,
    campaignId: string,
    callData: CallData = {}
  ): Promise<{
    buyerId: string;
    endpoint: string;
    targetId?: string | null;
    callerState?: string | null;
  } | null> {
    try {
      const eligibleEndpoints = await this.getEligibleEndpoints(tenantId, campaignId, callData);

      if (eligibleEndpoints.length === 0) {
        const callerState = this.resolveCallerState(callData);
        logger.warn({
          msg: 'No eligible buyers after dynamic filtering',
          campaignId,
          callerState,
          callerId: callData.callerId,
        });
        return null;
      }

      const priorityGroups = new Map<number, EligibleEndpoint[]>();
      for (const endpoint of eligibleEndpoints) {
        const priority = endpoint.priority;
        if (!priorityGroups.has(priority)) {
          priorityGroups.set(priority, []);
        }
        priorityGroups.get(priority)!.push(endpoint);
      }

      const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => a - b);
      // Build one sequential failover step per priority. Every eligible internal
      // Hopwhistle extension at that priority rings in parallel. When external
      // buyers/cell phones share the priority, choose exactly one external leg by
      // weight and ring it alongside the internal users. Pure external campaigns
      // therefore retain their original weighted single-buyer behavior.
      const pickWeighted = (group: EligibleEndpoint[]): EligibleEndpoint => {
        let totalWeight = 0;
        for (const endpoint of group) {
          totalWeight += Math.max(1, endpoint.weight);
        }

        const randomValue = Math.random() * totalWeight;
        let currentSum = 0;
        let selectedEndpoint = group[0];
        for (const endpoint of group) {
          currentSum += Math.max(1, endpoint.weight);
          if (randomValue <= currentSum) {
            selectedEndpoint = endpoint;
            break;
          }
        }
        return selectedEndpoint;
      };

      // Ring EVERY external buyer in a step instead of one chosen by weight.
      //
      // Opt-in per campaign (`metadata.ringAllExternalBuyers`), because the
      // weighted pick is what distributes calls across competing buyers
      // everywhere else — switching it on globally would blast every call to
      // every buyer on the campaign. Clearing the flag is the rollback.
      //
      // Only read when a step actually holds more than one external, so the
      // usual routing decision does not gain a query.
      const hasStepWithMultipleExternals = sortedPriorities.some(
        priority =>
          priorityGroups
            .get(priority)!
            .filter(endpoint => !isInternalAgentDestination(endpoint.destination)).length > 1
      );

      let ringAllExternalBuyers = false;
      if (hasStepWithMultipleExternals) {
        try {
          const campaign = await this.prisma.campaign.findFirst({
            where: { id: campaignId, tenantId },
            select: { metadata: true },
          });
          const meta =
            campaign?.metadata &&
            typeof campaign.metadata === 'object' &&
            !Array.isArray(campaign.metadata)
              ? (campaign.metadata as Record<string, unknown>)
              : {};
          ringAllExternalBuyers = meta.ringAllExternalBuyers === true;
        } catch (metaErr) {
          // Fail closed, to the existing behaviour.
          logger.warn({
            msg: 'Agent-routing: could not read ringAllExternalBuyers (using weighted pick)',
            campaignId,
            error: (metaErr as Error).message,
          });
        }
      }

      const ringSteps: string[] = [];
      const selectedEndpoints: EligibleEndpoint[] = [];

      for (const priority of sortedPriorities) {
        const group = priorityGroups.get(priority)!;
        const internalEndpoints = group.filter(endpoint =>
          isInternalAgentDestination(endpoint.destination)
        );
        const externalEndpoints = group.filter(
          endpoint => !isInternalAgentDestination(endpoint.destination)
        );

        const stepEndpoints: EligibleEndpoint[] = [...internalEndpoints];
        if (externalEndpoints.length > 0) {
          if (ringAllExternalBuyers) {
            stepEndpoints.push(...externalEndpoints);
          } else {
            stepEndpoints.push(pickWeighted(externalEndpoints));
          }
        }

        const seen = new Set<string>();
        const destinations = stepEndpoints
          .map(endpoint => endpoint.destination.trim())
          .filter(destination => {
            if (!destination || seen.has(destination)) return false;
            seen.add(destination);
            return true;
          });

        if (destinations.length > 0) {
          ringSteps.push(destinations.join(','));
          selectedEndpoints.push(...stepEndpoints);
        }
      }

      // Agent-assigned external DIDs are translated to their registered
      // Hopwhistle extension. Only append those DIDs as a final PSTN fallback
      // when the campaign explicitly opts in.
      const externalFallbacks = eligibleEndpoints
        .map(endpoint => endpoint.externalFallbackDestination?.trim())
        .filter((destination): destination is string => !!destination);

      if (externalFallbacks.length > 0) {
        try {
          const campaign = await this.prisma.campaign.findFirst({
            where: { id: campaignId, tenantId },
            select: { metadata: true },
          });
          const meta =
            campaign?.metadata &&
            typeof campaign.metadata === 'object' &&
            !Array.isArray(campaign.metadata)
              ? (campaign.metadata as Record<string, unknown>)
              : {};

          if (meta.allowAgentDidExternalFallback === true) {
            ringSteps.push([...new Set(externalFallbacks)].join(','));
            logger.info({
              msg: 'Agent-routing: External DID fallback step enabled by campaign metadata',
              campaignId,
              fallbackCount: new Set(externalFallbacks).size,
            });
          }
        } catch (metaErr) {
          logger.warn({
            msg: 'Agent-routing: Could not evaluate external-fallback setting (skipping fallback)',
            campaignId,
            error: (metaErr as Error).message,
          });
        }
      }

      if (ringSteps.length === 0) {
        return null;
      }

      const primaryEndpoint = selectedEndpoints[0] || eligibleEndpoints[0];
      const routePlan = ringSteps.join('|');

      logger.info({
        msg: 'Selected campaign mixed destination ring/failover plan',
        campaignId,
        buyerId: primaryEndpoint.buyerId,
        buyerName: primaryEndpoint.buyerName,
        endpointId: primaryEndpoint.endpointId,
        destination: routePlan,
        eligibleCount: eligibleEndpoints.length,
        prioritySteps: ringSteps.length,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: primaryEndpoint.buyerId,
        endpoint: routePlan,
        targetId: primaryEndpoint.endpointId,
        callerState: this.resolveCallerState(callData),
      };
    } catch (error) {
      logger.error('Error selecting best buyer:', error);
      return null;
    }
  }
}

export const routingService = new RoutingService();
