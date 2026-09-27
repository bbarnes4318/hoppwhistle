/* eslint-disable */
// Route handlers - placeholder implementations
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

import { OPEN_DISPUTE } from '../lib/dispute-status.js';
import { normalizeLicensedStates, normalizeStateCode } from '../lib/licensed-states.js';
import { isPlatformAdminRequest, requirePlatformAdmin } from '../lib/platform-context.js';
import {
  didActiveElsewhere,
  extensionsOutsideTenant,
  isPlatformPrincipal,
} from '../lib/tenant-scope-guards.js';
import {
  getActingTenantId,
  getActingUserId,
  replyTenantRefusal,
  resolveTenant,
  sendTenantRefusal,
} from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import { recordAgentApplication } from '../services/applications/agent-entry.js';
import { UnknownCallError } from '../services/applications/call-attribution.js';
import {
  ANSWER_ORDERS,
  answerOrderFromMetadata,
  isAnswerOrder,
} from '../services/campaigns/answer-order.js';
import { applyAnswerOrder } from '../services/campaigns/apply-answer-order.js';
import {
  ApplicationInputSchema,
  describeApplicationIssues,
} from '../services/applications/input-schema.js';
import type { ApplicationInput } from '../services/applications/input-schema.js';
import { deliveredCallWhere, submittedApplicationWhere } from '../services/rating/measurement.js';
import { isSoftphoneCallSid, savePendingDisposition } from '../services/pending-disposition.js';
import {
  buildBuyerCostsReport,
  buildCampaignProfitabilityReport,
  buildPublisherRevenueReport,
  buyerCostsCsv,
  campaignFilter,
  campaignProfitabilityCsv,
  publisherRevenueCsv,
  reportPeriodFromQuery,
  type ReportPeriodQuery,
} from '../services/reporting/reports.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

function buildCallWhere(params: {
  tenantId: string;
  isAdminOrOwner: boolean;
  userId?: string;
  search?: string;
  phone?: string;
  startDate?: string;
  endDate?: string;
  buyerId?: string | null;
  publisherId?: string | null;
  campaignId?: string | null;
  disputeStatus?: string | null;
  listPhoneNumbers?: string[];
  /** One agent's calls, by `answeredByUserId`. Ignored for a non-principal. */
  agentId?: string | null;
  /** One disposition, or `NONE` for the calls nobody has written up. */
  disposition?: string | null;
  /** Where the call went: `AGENTS`, `BUYERS` or `UNANSWERED`. Anything else is no filter. */
  outcome?: string | null;
  /** `true` narrows to calls with a canonical recording. Anything else is no filter. */
  hasRecording?: string | null;
  /** `true` or `false` narrows by the call's billable flag. Anything else is no filter. */
  billable?: string | null;
}) {
  const {
    tenantId,
    isAdminOrOwner,
    userId,
    search,
    phone,
    startDate,
    endDate,
    buyerId,
    publisherId,
    campaignId,
    disputeStatus,
    listPhoneNumbers,
    agentId,
    disposition,
    outcome,
    hasRecording,
    billable,
  } = params;
  const where: Record<string, any> = { tenantId };

  if (!isAdminOrOwner) {
    if (buyerId) {
      where.buyerId = buyerId;
    } else if (publisherId) {
      where.publisherId = publisherId;
    } else if (userId) {
      /*
       * "My calls" means the calls this agent answered, and nothing else.
       *
       * It used to be an OR that also matched the calls they created, the
       * numbers assigned to them, and any call whose `did` or `toNumber` was
       * one of those numbers. The DID belongs to the agency, and a number
       * shared across a team made a colleague's calls -- with their callers,
       * notes and recordings -- land in this list. `answeredByUserId` is who
       * picked the phone up; it is the one clause that is about this agent.
       */
      where.answeredByUserId = userId;
    }
  } else {
    // Admin filters
    if (buyerId) {
      where.buyerId = buyerId;
    }
    if (publisherId) {
      where.publisherId = publisherId;
    }
  }

  if (campaignId) {
    where.campaignId = campaignId;
  }

  /*
   * 'DISPUTED' is the OPEN dispute and nothing else. It used to be
   * `{ not: null }`, which was the same thing while nothing but a buyer's
   * dispute ever wrote the column; a decided return now leaves 'ACCEPTED' or
   * 'DENIED' behind, and neither is open. See `lib/dispute-status.ts`.
   *
   * 'ANY' is the old meaning, kept under its own name: every call a dispute
   * was ever filed on, open or decided -- the buyer portal's list of what it
   * has filed, which has to show how each one came out.
   */
  if (disputeStatus) {
    if (disputeStatus === 'ANY') {
      where.disputeStatus = { not: null };
    } else if (disputeStatus === OPEN_DISPUTE) {
      where.disputeStatus = OPEN_DISPUTE;
    } else if (disputeStatus === 'NONE') {
      where.disputeStatus = null;
    } else {
      where.disputeStatus = disputeStatus;
    }
  }

  /*
   * One agent's calls.
   *
   * Set for a principal picking an agent off the roster or arriving from the
   * team report. It is deliberately NOT applied for a non-principal: their own
   * `where.OR` above already limits them to their own calls, and letting an
   * `agentId` narrow further inside that set is harmless, but letting it
   * WIDEN would be a tenant-scoped agent reading a colleague's calls. The
   * callers pass it only when `isAdminOrOwner`, and it is an AND with the OR,
   * never a replacement for it.
   */
  if (agentId) {
    where.answeredByUserId = agentId;
  }

  /*
   * `NONE` is a real answer, not an absent filter. "Which calls has nobody
   * written up yet" is the question a floor lead asks at the end of a shift,
   * and it cannot be expressed by leaving the parameter off -- that means "all
   * calls". Same shape as the dispute filter above, for the same reason.
   */
  if (disposition) {
    where.disposition = disposition === 'NONE' ? null : disposition;
  }

  const andClauses: any[] = [];

  if (listPhoneNumbers !== undefined) {
    if (listPhoneNumbers.length === 0) {
      andClauses.push({ id: 'none' });
    } else {
      const formatNumberList: string[] = [];
      for (const rawPhone of listPhoneNumbers) {
        const clean = rawPhone.replace(/\D/g, '');
        const last10 = clean.length >= 10 ? clean.slice(-10) : clean;
        if (last10.length === 10) {
          formatNumberList.push(last10);
          formatNumberList.push(`+1${last10}`);
          formatNumberList.push(`1${last10}`);
        }
      }
      if (formatNumberList.length > 0) {
        andClauses.push({
          OR: [{ toNumber: { in: formatNumberList } }, { callerId: { in: formatNumberList } }],
        });
      } else {
        andClauses.push({ id: 'none' });
      }
    }
  }

  if (phone) {
    andClauses.push({
      OR: [
        { toNumber: phone },
        { callerId: phone },
        { toNumber: phone.replace(/^\+1/, '') },
        { callerId: phone.replace(/^\+1/, '') },
      ],
    });
  }

  if (startDate) {
    const parsedStart = new Date(startDate);
    if (!isNaN(parsedStart.getTime())) {
      andClauses.push({ createdAt: { gte: parsedStart } });
    }
  }
  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (!isNaN(parsedEnd.getTime())) {
      andClauses.push({ createdAt: { lte: parsedEnd } });
    }
  }

  /*
   * Where the call went, the same three ways the Sales screen splits them
   * (`services/reporting/call-sales.ts`): answered by one of the agency's own
   * agents, sent on to a buyer, or neither and not blocked. Read off the same
   * columns, so a call answered by an agent AND then sent to a buyer appears
   * under both -- as it is counted in both there.
   *
   * An AND clause rather than a key on `where`, so it narrows the buyer,
   * publisher and agent filters above instead of replacing them. An unknown
   * value is no filter, like an absent one: a stale link should show calls,
   * not a 400.
   */
  if (outcome === 'AGENTS') {
    andClauses.push({ answeredByUserId: { not: null } });
  } else if (outcome === 'BUYERS') {
    andClauses.push({ buyerId: { not: null } });
  } else if (outcome === 'UNANSWERED') {
    andClauses.push({ answeredAt: null, blocked: false });
  }

  /*
   * The Recordings item in the publisher and buyer navigation is this list with
   * `hasRecording=true`. It used to be ignored here, so "Recordings" showed
   * every call, recorded or not. `primaryRecordingId` is the canonical
   * recording the player streams; a call without one has nothing to play.
   *
   * `billable` is the same: the publisher Calls page filtered it out of the
   * twenty rows it had been handed, so page 2 of "billable" could be empty
   * while billable calls sat on page 5. The filter belongs in the query, where
   * the page count is computed.
   *
   * Only the exact strings narrow. A stale or mistyped value is no filter, like
   * `outcome` above.
   */
  if (hasRecording === 'true') {
    andClauses.push({ primaryRecordingId: { not: null } });
  }
  if (billable === 'true') {
    andClauses.push({ billable: true });
  } else if (billable === 'false') {
    andClauses.push({ billable: false });
  }

  if (search && search.trim()) {
    const searchLower = search.trim();
    andClauses.push({
      OR: [
        { id: { contains: searchLower, mode: 'insensitive' } },
        { callSid: { contains: searchLower, mode: 'insensitive' } },
        { callerId: { contains: searchLower, mode: 'insensitive' } },
        { toNumber: { contains: searchLower, mode: 'insensitive' } },
        { targetNumber: { contains: searchLower, mode: 'insensitive' } },
        { did: { contains: searchLower, mode: 'insensitive' } },
        { disposition: { contains: searchLower, mode: 'insensitive' } },
        { dispositionNotes: { contains: searchLower, mode: 'insensitive' } },
        { callSource: { contains: searchLower, mode: 'insensitive' } },
        { campaign: { name: { contains: searchLower, mode: 'insensitive' } } },
      ],
    });
  }

  if (andClauses.length > 0) {
    if (where.OR) {
      where.AND = [{ OR: where.OR }, ...andClauses];
      delete where.OR;
    } else {
      where.AND = andClauses;
    }
  }

  return where;
}

// Helper to get authenticated user profile (role, buyerId, publisherId, accessToRecordings)
/**
 * Derives the caller's effective scope — admin / publisher / buyer — from their
 * JWT and their linked records. Exported so every scoped endpoint resolves
 * access the same way; this is a security boundary and a second copy of it
 * would be a second thing to get wrong.
 */
export async function getUserProfile(request: any, prisma: any) {
  const user = request.user;
  let userRoles: string[] = [];
  let buyerId: string | null = null;
  let publisherId: string | null = null;
  let publisherAccessToRecordings = false;
  let publisherMetadata: any = null;

  if (user?.userId) {
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { roles: { include: { role: true } } },
    });
    if (userRecord) {
      userRoles = userRecord.roles.map((ur: any) => ur.role.name) || [];
      buyerId = userRecord.buyerId || null;
      publisherId = userRecord.publisherId || (userRecord.metadata as any)?.publisherId || null;
    }
  }

  if (user?.publisherId) {
    publisherId = user.publisherId;
  }

  /*
   * The principal's roles, merged onto the row's -- except under a read-only
   * role preview, where they REPLACE them.
   *
   * The merge is right for a platform operator acting inside an agency: they
   * hold no `UserRole` row there, and `ACTING_TENANT_ROLES` is what makes the
   * agency visible to them at all. It is wrong for a preview. The principal
   * already carries exactly the previewed role, and merging the row's roles back
   * in would restore whatever the operator holds in their own right -- which, for
   * the staff who use this, is ADMIN and OWNER. Every narrowing the preview
   * exists to show would be undone here, in the helper every scoped endpoint
   * resolves access through.
   */
  if (user?.isReadOnlyPreview === true && Array.isArray(user?.roles)) {
    userRoles = [...(user.roles as string[])];
  } else if (user?.roles && Array.isArray(user.roles)) {
    for (const r of user.roles) {
      if (!userRoles.includes(r)) userRoles.push(r);
    }
  }

  if (publisherId) {
    const pub = await prisma.publisher.findUnique({
      where: { id: publisherId },
      select: { accessToRecordings: true, metadata: true },
    });
    publisherAccessToRecordings = pub?.accessToRecordings ?? false;
    publisherMetadata = pub?.metadata ?? null;
  }

  // Under a preview `userRoles` IS the principal's role list, so the second
  // clause would be a second chance for the same answer and nothing more.
  const isAdminOrOwner =
    userRoles.some(role => role === 'ADMIN' || role === 'OWNER') ||
    (user?.isReadOnlyPreview !== true &&
      (user?.roles?.some((role: string) => role === 'ADMIN' || role === 'OWNER') ?? false));

  return {
    isAdminOrOwner,
    userRoles,
    buyerId: buyerId || user?.buyerId || null,
    publisherId,
    publisherAccessToRecordings,
    publisherMetadata,
  };
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function getPublicApiBaseUrl(request: FastifyRequest): string {
  const envUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
  if (envUrl) {
    return envUrl.replace(/\/api\/?$/, '');
  }
  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = request.headers.host || 'localhost:3001';
  return `${protocol}://${host}`;
}

/*
 * The stream URLs carry no credential.
 *
 * They used to end in `?token=<7-day login JWT>`, and the auth hook accepted
 * `?token=` as a full login on every /api/v1 route -- so every recording link
 * on the Calls page, and every row of the CSV export, was a working week-long
 * session for whoever it was pasted to. Playback in the app goes through the
 * authenticated `GET /api/v1/recordings/:id/url`, which mints a 15-minute token
 * good for that one stream and nothing else (see `middleware/api-v1-auth.ts`).
 */
function buildRecordingPlaybackUrls(call: any, apiBaseUrl: string) {
  const latestRecording = call.recordings?.[0] ?? null;
  const primaryId = call.primaryRecordingId || latestRecording?.id || null;

  let primaryUrl = '';
  if (primaryId) {
    primaryUrl = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${primaryId}/stream`;
  } else if (call.recordingUrl) {
    if (call.recordingUrl.startsWith('http://') || call.recordingUrl.startsWith('https://')) {
      primaryUrl = call.recordingUrl;
    } else {
      primaryUrl = `${apiBaseUrl.replace(/\/$/, '')}${call.recordingUrl}`;
    }
  }

  // All recordings
  const allUrls =
    call.recordings && call.recordings.length > 0
      ? call.recordings
          .map((rec: any) => `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${rec.id}/stream`)
          .join('; ')
      : primaryUrl;

  return { primaryUrl, allUrls };
}

/**
 * Where the web app lives, for links written into exports.
 *
 * Same variable and default as `services/agent-invite-email.ts`.
 */
function appUrl(): string {
  return (process.env.APP_URL ?? 'https://agents.netenroll.com').replace(/\/+$/, '');
}

function csvEscape(value: any): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Resolve the agent who answered each call, in one query for the page.
 *
 * ── Why a lookup and not a Prisma relation ──────────────────────────────────
 *
 * `Call.answeredByUserId` carries no foreign key. The column was backfilled
 * from a `metadata.answeredByAgentId` JSON key written by an older softphone,
 * and a backfilled id can name a user who has since been deleted -- so adding
 * the constraint is a migration that can fail on live data, for a join this
 * does in one indexed read against the primary key.
 *
 * It also buys a property the relation would not: the lookup is SCOPED TO THE
 * TENANT. A stale id from another agency resolves to nothing rather than
 * printing that agency's employee's name on this agency's call ledger.
 *
 * The result is attached as `answeredBy` so `mapCallRecord` reads it exactly as
 * it reads Prisma's own includes, and nothing downstream has to know the
 * difference.
 */
async function attachAnsweredBy<T extends { answeredByUserId?: string | null }>(
  calls: T[],
  prisma: any,
  tenantId: string
): Promise<void> {
  const ids = [
    ...new Set(calls.map(call => call.answeredByUserId).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return;

  let users: { id: string; firstName: string | null; lastName: string | null; email: string }[] =
    [];
  try {
    users = await prisma.user.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  } catch {
    /*
     * A name is a label on a row that is otherwise complete. If this read
     * fails, every call still lists with its time, number, duration and
     * disposition and the agent column reads as unattributed -- which is worse
     * than the truth but far better than a ledger that will not load.
     */
    return;
  }

  const byId = new Map(users.map(user => [user.id, user]));
  for (const call of calls) {
    (call as { answeredBy?: unknown }).answeredBy = call.answeredByUserId
      ? (byId.get(call.answeredByUserId) ?? null)
      : null;
  }
}

/**
 * Whether this principal may read one call.
 *
 * The same rule `buildCallWhere` applies to the list, for one row: OWNER and
 * ADMIN see the agency; a publisher or buyer sees their own traffic; an agent
 * sees the calls they answered. Anybody else sees nothing.
 *
 * An agent's rule used to also match calls they created and calls that touched
 * one of "their" numbers -- including the DID, which belongs to the agency -- so
 * a colleague's call could be opened, and written to, by id.
 */
function mayReadCall(
  profile: {
    isAdminOrOwner: boolean;
    userRoles?: string[];
    buyerId?: string | null;
    publisherId?: string | null;
  },
  call: { publisherId?: string | null; buyerId?: string | null; answeredByUserId?: string | null },
  userId: string | undefined
): boolean {
  if (profile.isAdminOrOwner) return true;
  if (profile.userRoles?.includes('PUBLISHER')) {
    return !!profile.publisherId && call.publisherId === profile.publisherId;
  }
  if (profile.userRoles?.includes('BUYER')) {
    return !!profile.buyerId && call.buyerId === profile.buyerId;
  }
  if (profile.userRoles?.includes('AGENT')) {
    return !!userId && call.answeredByUserId === userId;
  }
  return false;
}

function mapCallRecord(
  call: any,
  apiBaseUrl: string,
  prisma: any,
  request: any,
  skipDbUpdate = false,
  profile?: any
) {
  const latestRecording = call.recordings?.[0] ?? null;

  const effectivePrimaryRecordingId = call.primaryRecordingId || latestRecording?.id || null;

  const effectiveRecordingUrl =
    call.recordingUrl ||
    (effectivePrimaryRecordingId
      ? `/api/v1/recordings/${effectivePrimaryRecordingId}/stream`
      : null);

  const effectiveRecordingStatus =
    effectiveRecordingUrl || effectivePrimaryRecordingId ? 'READY' : call.recordingStatus;

  if (!skipDbUpdate && latestRecording && call.recordingStatus !== 'READY') {
    prisma.call
      .update({
        where: { id: call.id },
        data: {
          primaryRecordingId: latestRecording.id,
          recordingStatus: 'READY',
          recordingUrl: `/api/v1/recordings/${latestRecording.id}/stream`,
          recordingCompletedAt: latestRecording.createdAt,
          recordingError: null,
        },
      })
      .catch((err: any) => {
        request.log.error(
          { err, callId: call.id, recordingId: latestRecording.id },
          'Failed to repair stale call recording status from existing recording row'
        );
      });
  }

  const playbackUrls = buildRecordingPlaybackUrls(call, apiBaseUrl);

  // Apply financial masking based on role
  let revenue = call.revenue;
  let payout = call.payout;
  let profit = call.profit;
  let cost = call.cost;
  let absRecUrl: string | null = playbackUrls.primaryUrl;
  let recUrl: string | null = absRecUrl;
  let allRecUrls: string | string[] = playbackUrls.allUrls;
  let callerId = call.callerId;
  let targetNumber = call.targetNumber;
  let toNumber = call.toNumber;
  let buyerName = call.buyerName;
  let publisherName: string | null = call.publisherName || call.publisher?.name || null;

  let margin: number | null = null;

  if (profile) {
    const hasFinanceRole = profile.userRoles?.includes('FINANCE') ?? false;
    if (!profile.isAdminOrOwner) {
      if (profile.userRoles?.includes('PUBLISHER')) {
        revenue = null;
        cost = null;
        profit = null;
        if (!profile.publisherAccessToRecordings) {
          recUrl = null;
          absRecUrl = null;
          allRecUrls = [];
        }
        // Mask callerId: keep last 4 digits
        if (callerId && callerId.length >= 7) {
          const len = callerId.length;
          callerId = callerId.slice(0, len - 7) + '***' + callerId.slice(len - 4);
        }
        // Mask destination unless explicitly allowed
        const allowViewBuyer = profile.publisherMetadata?.allowViewBuyer ?? false;
        if (!allowViewBuyer) {
          targetNumber = null;
          toNumber = 'Masked';
          buyerName = 'Masked';
        }
      } else if (profile.userRoles?.includes('BUYER')) {
        payout = null;
        cost = null;
        profit = null;
      } else if (profile.userRoles?.includes('AGENT')) {
        /*
         * Who bought the call, who sold it, and where it was sent are the
         * agency's commercial relationships, not the agent's. An agent needs
         * the caller and the disposition; the counterparties and the
         * destination number stay with the principals.
         */
        buyerName = null;
        publisherName = null;
        targetNumber = null;
        toNumber = null;
        if (!hasFinanceRole) {
          revenue = null;
          payout = null;
          cost = null;
          profit = null;
        }
      } else {
        revenue = null;
        payout = null;
        cost = null;
        profit = null;
        recUrl = null;
        absRecUrl = null;
        allRecUrls = [];
      }
    }
  }

  // Compute margin
  if (revenue !== null && profit !== null && Number(revenue) > 0) {
    margin = (Number(profit) / Number(revenue)) * 100;
  } else if (revenue !== null && profit !== null) {
    margin = 0;
  }

  // RTB metadata resolution
  const rtbMeta = (call.metadata as any)?.rtb || {};
  const pingRequestId = rtbMeta.pingId || null;
  const buyerBidId = rtbMeta.buyerBidId || null;
  const rtbBidAmount =
    rtbMeta.bidAmount !== undefined && rtbMeta.bidAmount !== null
      ? Number(rtbMeta.bidAmount)
      : null;

  // Billable reason mapping
  const billableReason = call.billable
    ? call.billingRuleSnapshot?.thresholdSource
      ? `Billable via ${call.billingRuleSnapshot.thresholdSource}`
      : // The threshold stored on the call, never an assumed one: a call with
        // none recorded says so rather than quoting a default it was not held to.
        call.billableDurationThreshold != null
        ? `Connected duration exceeded campaign threshold of ${call.billableDurationThreshold}s`
        : 'Connected duration met the billable threshold'
    : call.noPayoutReason || 'Did not meet duration threshold';

  return {
    id: call.id,
    tenantId: call.tenantId,
    callSid: call.callSid,
    externalId: call.externalId,
    createdById: call.createdById,
    toNumber,
    direction: call.direction,
    status: call.status,
    duration: call.duration,
    connectedDuration: call.connectedDuration,
    cost: cost !== null ? Number(cost) : null,
    revenue: revenue !== null ? Number(revenue) : null,
    buyerBillableAmount: revenue !== null ? Number(revenue) : null,
    payout: payout !== null ? Number(payout) : null,
    publisherPayoutAmount: payout !== null ? Number(payout) : null,
    profit: profit !== null ? Number(profit) : null,
    margin,
    callerId,
    did: call.did,
    targetNumber,
    publisherId: call.publisherId,
    publisherName,
    buyerId: call.buyerId,
    buyerName: buyerName || null,
    campaignId: call.campaignId,
    campaignName: call.campaignName || call.campaign?.name || null,
    targetId: call.targetId,
    targetName: call.targetName,
    pingRequestId,
    buyerBidId,
    rtbBidAmount,
    billable: call.billable,
    billableDurationThreshold: call.billableDurationThreshold,
    billableReason,
    noPayoutReason: call.noPayoutReason,
    billingCalculatedAt: call.billingCalculatedAt?.toISOString() ?? null,
    converted: call.converted,
    paidOut: call.buyerChargeStatus === 'CHARGED',
    buyerChargeStatus: call.buyerChargeStatus,
    buyerChargedAt: call.buyerChargedAt?.toISOString() ?? null,
    publisherPayoutStatus: call.publisherPayoutStatus,
    publisherPayableAt: call.publisherPayableAt?.toISOString() ?? null,
    publisherPaidAt: call.publisherPaidAt?.toISOString() ?? null,
    disputeStatus: call.disputeStatus,
    missedCall: call.missedCall,
    blocked: call.blocked,
    recordingUrl: recUrl,
    absoluteRecordingUrl: absRecUrl,
    allRecordingUrls: allRecUrls,
    recordingStatus: effectiveRecordingStatus,
    recordingError: effectiveRecordingStatus === 'READY' ? null : call.recordingError,
    primaryRecordingId: effectivePrimaryRecordingId,
    recordingStartedAt: call.recordingStartedAt?.toISOString() ?? null,
    recordingCompletedAt:
      call.recordingCompletedAt?.toISOString() ??
      latestRecording?.createdAt?.toISOString?.() ??
      null,
    disposition: call.disposition,
    dispositionNotes: call.dispositionNotes,
    callSource: call.callSource,
    followUpAt: call.followUpAt?.toISOString() ?? null,
    followUpStatus: call.followUpStatus,
    campaign: call.campaign ? { id: call.campaign.id, name: call.campaign.name } : null,
    fromNumber: call.fromNumber ? { id: call.fromNumber.id, number: call.fromNumber.number } : null,
    createdBy: call.createdBy
      ? { firstName: call.createdBy.firstName, lastName: call.createdBy.lastName }
      : null,
    /*
     * The agent who took the call.
     *
     * `createdBy` above is NOT this, and reading it as this is the mistake the
     * ledger made for as long as it existed. `createdById` is whoever caused
     * the ROW to exist -- an importer, a click-to-dial, a disposition save --
     * and on an inbound call routed to an agency's floor it is usually null.
     * `answeredByUserId` is who picked the phone up, and it is what the
     * per-agent table and the closing percentage are built on.
     *
     * `agentName` is resolved here rather than in each caller so the ledger,
     * the CSV and the detail drawer cannot disagree about how a missing name
     * reads. Null means unattributed, and callers must render that as its own
     * state -- an empty cell says "nobody" to a floor lead, which is a claim
     * about the call rather than about what we recorded.
     */
    answeredByUserId: call.answeredByUserId ?? null,
    agentName: call.answeredBy
      ? [call.answeredBy.firstName, call.answeredBy.lastName].filter(Boolean).join(' ') ||
        call.answeredBy.email ||
        null
      : null,
    createdAt: call.createdAt.toISOString(),
    updatedAt: call.updatedAt.toISOString(),
    startedAt: call.startedAt?.toISOString(),
    answeredAt: call.answeredAt?.toISOString(),
    endedAt: call.endedAt?.toISOString(),
    metadata: call.metadata,
    billingRuleSnapshot: call.billingRuleSnapshot,
  };
}

// Public API - Numbers
export async function registerNumberRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/numbers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = Math.max(parseInt(request.query.page || '1') || 1, 1);
      // The page that consumes this asks for every number at once so it can
      // group them by carrier; a fixed page of 20 silently hid whole carriers
      // from an inventory that is larger than that. The cap keeps the query
      // bounded without deciding for the caller that 20 is enough.
      const limit = Math.min(Math.max(parseInt(request.query.limit || '20') || 20, 1), 500);
      const skip = (page - 1) * limit;

      let userRoles: string[] = [];
      if (user?.userId) {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          include: { roles: { include: { role: true } } },
        });
        userRoles = userRecord?.roles.map(ur => ur.role.name) || [];
      }
      const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');

      // A RELEASED number has gone back to the carrier. Its row stays for call
      // history and billing, but it is not on the agency's account any more.
      const where: Record<string, any> = { tenantId, status: { not: 'RELEASED' } };
      if (!isAdminOrOwner && user?.userId) {
        where.userId = user.userId;
      }

      const { numberUsage } = await import('../services/numbers/number-purchase.js');
      const [numbers, total, usage] = await Promise.all([
        prisma.phoneNumber.findMany({
          where,
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            carrier: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        }),
        prisma.phoneNumber.count({ where }),
        numberUsage(tenantId),
      ]);

      return {
        data: numbers.map(n => ({
          id: n.id,
          number: n.number,
          status: n.status,
          provider: n.provider,
          // Who the number is actually with. `carrier` is the linked routing
          // carrier when there is one; `provider` is the upstream the DID came
          // from and is the fallback the UI groups by for numbers imported
          // before a Carrier row existed for them.
          carrier: n.carrier
            ? { id: n.carrier.id, name: n.carrier.name, code: n.carrier.code }
            : null,
          capabilities: n.capabilities,
          poolType: n.poolType,
          poolStatus: n.poolStatus,
          campaign: n.campaign ? { id: n.campaign.id, name: n.campaign.name } : null,
          user: n.user
            ? {
                id: n.user.id,
                name: `${n.user.firstName || ''} ${n.user.lastName || ''}`.trim() || n.user.email,
              }
            : null,
          purchasedAt: n.purchasedAt?.toISOString(),
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          // "n of m numbers used": what counts against the quota, and the
          // quota (null for no limit).
          numbersUsed: usage.used,
          numbersLimit: usage.limit,
        },
      };
    }
  );

  /**
   * What buying a number costs this agency, for the purchase screen to show
   * before anybody confirms, and how much of its quota is left. A child
   * agency sees its parent's price, because the parent is who is charged.
   */
  fastify.get('/api/v1/numbers/pricing', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { numberBillingFor, proratedMonthly } = await import(
      '../services/numbers/number-charges.js'
    );
    const { numberUsage } = await import('../services/numbers/number-purchase.js');
    const [{ pricing }, usage] = await Promise.all([
      numberBillingFor(prisma, tenantId),
      numberUsage(tenantId),
    ]);

    return {
      data: {
        setup: pricing.setup,
        monthly: pricing.monthly,
        firstMonth: proratedMonthly(pricing.monthly, new Date()),
        currency: 'USD',
        numbersUsed: usage.used,
        numbersLimit: usage.limit,
      },
    };
  });

  /**
   * Add a number the platform already owns at a carrier (e.g. an Anveo DID) to
   * the acting agency, optionally pointed at one of its campaigns. Buying is
   * POST /api/v1/numbers; this is for numbers that exist already. Staff-only
   * through the `/api/v1/numbers` prefix in lib/staff-only-endpoints.ts.
   */
  fastify.post<{
    Body: { number?: string; provider?: string; campaignId?: string | null };
  }>('/api/v1/numbers/existing', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { addExistingNumber } = await import('../services/add-existing-number.js');
    const result = await addExistingNumber(prisma, tenantId, {
      number: request.body?.number ?? '',
      provider: request.body?.provider ?? '',
      campaignId: request.body?.campaignId ?? null,
    });

    if (!result.ok) {
      void reply.code(result.status);
      return { error: { code: result.code, message: result.message } };
    }

    // Creates (or repoints) the inbound DidRoute, so calls reach the campaign.
    const { didRouteService } = await import('../services/did-route-service.js');
    await didRouteService.syncDidRouteForNumber(result.id, tenantId);

    void reply.code(result.created ? 201 : 200);
    return { id: result.id, number: result.number, created: result.created };
  });

  fastify.post<{
    Body: {
      areaCode?: string;
      country?: string;
      region?: string;
      provider?:
        | 'local'
        | 'signalwire'
        | 'telnyx'
        | 'bandwidth'
        | 'anveo'
        | 'bulkvs'
        | 'fractel'
        | 'twilio'
        | 'vonage';
      features?: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    };
  }>('/api/v1/numbers', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const body = request.body;
      const provider = body.provider;

      // Check quota unless this process is a demo environment.
      //
      // This used to read `if (!demoTenantId)` -- the header. The header is now
      // stripped from every request unless ALLOW_DEMO_TENANT_AUTH is on, so the
      // condition asked a question that no longer has an answer; and reading a
      // header to decide anything about the acting tenant is the pattern this
      // change exists to remove. The switch itself says the same thing without
      // consulting the wire.
      const { isDemoTenantAuthEnabled } = await import('../lib/demo-auth.js');
      if (!isDemoTenantAuthEnabled()) {
        const { quotaService } = await import('../services/quota-service.js');
        const quotaCheck = await quotaService.checkPhoneNumberQuota(tenantId);
        if (!quotaCheck.allowed) {
          void reply.code(403);
          return {
            error: {
              code: 'QUOTA_EXCEEDED',
              message: quotaCheck.reason || 'Phone number quota exceeded',
              current: quotaCheck.current,
              limit: quotaCheck.limit,
            },
          };
        }
      }

      // Purchase number using provisioning service
      const { provisioningService } = await import(
        '../services/provisioning/provisioning-service.js'
      );
      const provisioned = await provisioningService.purchaseNumber(
        provider,
        {
          areaCode: body.areaCode,
          country: body.country || 'US',
          region: body.region,
          features: body.features || { voice: true },
        },
        {
          tenantId,
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      // Get the created number from database
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const dbNumber = await prisma.phoneNumber.findUnique({
        where: { id: provisioned.id },
      });

      if (!dbNumber) {
        void reply.code(500);
        return {
          error: { code: 'NOT_FOUND', message: 'Number was purchased but not found in database' },
        };
      }

      // Automatically sync/create inbound DidRoute pointing to user's extension
      const { didRouteService } = await import('../services/did-route-service.js');
      await didRouteService.syncDidRouteForNumber(dbNumber.id, tenantId);

      void reply.code(201);
      return {
        id: dbNumber.id,
        tenantId: dbNumber.tenantId,
        number: dbNumber.number,
        status: dbNumber.status,
        provider: dbNumber.provider,
        capabilities: dbNumber.capabilities,
        createdAt: dbNumber.createdAt.toISOString(),
        updatedAt: dbNumber.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'PURCHASE_FAILED',
          message: (error as Error).message || 'Failed to purchase number',
        },
      };
    }
  });

  fastify.get<{ Params: { numberId: string } }>(
    '/api/v1/numbers/:numberId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      // Scoped to the acting tenant: another agency's number is not found.
      const n = await prisma.phoneNumber.findFirst({
        where: { id: request.params.numberId, tenantId },
        include: { campaign: { select: { id: true, name: true } } },
      });
      if (!n) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Phone number not found' } };
      }

      return {
        id: n.id,
        tenantId: n.tenantId,
        number: n.number,
        status: n.status,
        provider: n.provider,
        capabilities: n.capabilities,
        campaign: n.campaign ? { id: n.campaign.id, name: n.campaign.name } : null,
        purchasedAt: n.purchasedAt?.toISOString(),
        releasedAt: n.releasedAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      };
    }
  );

  /**
   * Release a number: back to the carrier, its DID routes removed, RELEASED,
   * its monthly charge ended, audited. It stops working immediately and cannot
   * be recovered. See `services/numbers/number-purchase.ts`.
   */
  fastify.delete<{ Params: { numberId: string } }>(
    '/api/v1/numbers/:numberId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { NumberPurchaseError, releaseNumberForTenant } = await import(
        '../services/numbers/number-purchase.js'
      );
      try {
        const released = await releaseNumberForTenant({
          tenantId,
          numberId: request.params.numberId,
          actor: {
            userId: (request as AuthRequest).user?.userId,
            ipAddress: request.ip,
            requestId: request.id,
          },
        });
        return { data: released };
      } catch (error) {
        if (error instanceof NumberPurchaseError) {
          void reply.code(error.status);
          return { error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    }
  );

  fastify.patch<{
    Params: { numberId: string };
    Body: {
      status?: 'ACTIVE' | 'SUSPENDED';
      campaignId?: string | null;
      userId?: string | null;
      capabilities?: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
      };
      poolType?: string;
      poolStatus?: string;
    };
  }>('/api/v1/numbers/:numberId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { numberId } = request.params as { numberId: string };
      const body = request.body;

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify number exists and belongs to tenant
      const existingNumber = await prisma.phoneNumber.findFirst({
        where: {
          id: numberId,
          tenantId: tenantId,
        },
      });

      if (!existingNumber || existingNumber.status === 'RELEASED') {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Phone number not found' } };
      }

      /*
       * Switching a number off used to be how it was "released", and the
       * carrier kept billing for it. Releasing is DELETE now, which gives the
       * number back; PATCH no longer sets INACTIVE.
       */
      if (body.status !== undefined && !['ACTIVE', 'SUSPENDED'].includes(body.status)) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'A number cannot be set INACTIVE. To give it up, release it with DELETE /api/v1/numbers/:numberId.',
          },
        };
      }

      // Verify campaign exists if provided
      if (body.campaignId !== undefined && body.campaignId !== null) {
        const campaign = await prisma.campaign.findFirst({
          where: {
            id: body.campaignId,
            tenantId: tenantId,
          },
        });

        if (!campaign) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }
      }

      /*
       * An agency editing its own number -- a white-label owner, since this
       * route is otherwise staff's -- may point it only at its own people, may
       * not move it in or out of the platform-wide RTB pool, and may not
       * switch it on over a DID another agency is taking calls on. Staff keep
       * every one of these. See `lib/tenant-scope-guards.ts`.
       */
      if (!isPlatformPrincipal(request)) {
        if (body.userId !== undefined && body.userId !== null) {
          const assignee = await prisma.user.findFirst({
            where: { id: body.userId, tenantId },
            select: { id: true },
          });
          if (!assignee) {
            void reply.code(404);
            return { error: { code: 'NOT_FOUND', message: 'User not found' } };
          }
        }

        const poolChanged =
          (body.poolType !== undefined && body.poolType !== existingNumber.poolType) ||
          (body.poolStatus !== undefined && body.poolStatus !== existingNumber.poolStatus);
        if (poolChanged) {
          void reply.code(403);
          return {
            error: {
              code: 'STAFF_ONLY',
              message: 'The RTB number pool is shared across the platform and is set by NetEnroll.',
            },
          };
        }

        if (
          body.status === 'ACTIVE' &&
          (await didActiveElsewhere(prisma, tenantId, existingNumber.number))
        ) {
          void reply.code(409);
          return {
            error: {
              code: 'DID_IN_USE',
              message: 'This number is active in another account.',
            },
          };
        }
      }

      // Update number
      const updateData: Record<string, unknown> = {};
      if (body.status !== undefined) {
        updateData.status = body.status;
      }
      if (body.campaignId !== undefined) {
        updateData.campaignId = body.campaignId;
      }
      if (body.userId !== undefined) {
        updateData.userId = body.userId;
      }
      if (body.capabilities !== undefined) {
        updateData.capabilities = {
          ...((existingNumber.capabilities as Record<string, unknown>) ?? {}),
          ...body.capabilities,
        };
      }
      // RTB Pool fields
      if (body.poolType !== undefined) {
        updateData.poolType = body.poolType;
      }
      if (body.poolStatus !== undefined) {
        updateData.poolStatus = body.poolStatus;
      }

      const updatedNumber = await prisma.phoneNumber.update({
        where: { id: numberId },
        data: updateData,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'PhoneNumber', numberId, existingNumber, updatedNumber, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      // Sync inbound DidRoute for the updated user assignment
      const { didRouteService } = await import('../services/did-route-service.js');
      await didRouteService.syncDidRouteForNumber(numberId, tenantId);

      return {
        id: updatedNumber.id,
        tenantId: updatedNumber.tenantId,
        number: updatedNumber.number,
        status: updatedNumber.status,
        provider: updatedNumber.provider,
        capabilities: updatedNumber.capabilities,
        campaign: updatedNumber.campaign
          ? { id: updatedNumber.campaign.id, name: updatedNumber.campaign.name }
          : null,
        user: updatedNumber.user
          ? {
              id: updatedNumber.user.id,
              name:
                `${updatedNumber.user.firstName || ''} ${updatedNumber.user.lastName || ''}`.trim() ||
                updatedNumber.user.email,
            }
          : null,
        purchasedAt: updatedNumber.purchasedAt?.toISOString(),
        createdAt: updatedNumber.createdAt.toISOString(),
        updatedAt: updatedNumber.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update phone number',
        },
      };
    }
  });
}

// Public API - Campaigns
export async function registerCampaignRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/campaigns',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      /*
       * A buyer sees the campaigns it has taken calls from, by name, and
       * nothing else. The full list carried every campaign in the agency with
       * its publisher, its payout and the price every OTHER buyer pays; the
       * buyer portal only ever wanted names for a filter. Unpaged, because a
       * filter that silently stops at 20 hides the 21st campaign.
       */
      const profile = await getUserProfile(request, prisma);
      if (!profile.isAdminOrOwner && profile.userRoles?.includes('BUYER')) {
        const own = profile.buyerId
          ? await prisma.campaign.findMany({
              where: { tenantId, calls: { some: { tenantId, buyerId: profile.buyerId } } },
              orderBy: { name: 'asc' },
              select: { id: true, name: true },
            })
          : [];
        return {
          data: own,
          meta: { page: 1, limit: own.length, total: own.length, totalPages: 1 },
        };
      }

      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [campaigns, total] = await Promise.all([
        prisma.campaign.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            publisher: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            flow: {
              select: {
                id: true,
                name: true,
              },
            },
            _count: {
              select: {
                calls: true,
                phoneNumbers: true,
              },
            },
          },
        }),
        prisma.campaign.count({ where: { tenantId } }),
      ]);

      return {
        data: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          offerName: c.offerName,
          country: c.country,
          recordingEnabled: c.recordingEnabled,
          publisherId: c.publisherId,
          publisher: c.publisher,
          flowId: c.flowId,
          flow: c.flow,
          callerIdPoolId: c.callerIdPoolId,
          metadata: c.metadata,
          billableDurationSeconds: c.billableDurationSeconds,
          publisherPayoutPerBillableCall: c.publisherPayoutPerBillableCall,
          buyerPricePerBillableCall: c.buyerPricePerBillableCall,
          calls: c._count.calls,
          phoneNumbers: c._count.phoneNumbers,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      name: string;
      publisherId: string;
      offerName?: string;
      country?: string;
      recordingEnabled?: boolean;
      flowId?: string;
      callerIdPoolId?: string;
      status?: 'ACTIVE' | 'PAUSED';
      billableDurationSeconds?: number;
      publisherPayoutPerBillableCall?: number;
      buyerPricePerBillableCall?: number;
      metadata?: Record<string, unknown>;
    };
  }>('/api/v1/campaigns', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const body = request.body;

      if (!body.name || !body.name.trim()) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Campaign name is required' } };
      }

      /*
       * A child agency runs no call network -- it cannot create publishers --
       * but every campaign names one. Its calls arrive through its parent, so
       * a child's campaign is attributed to the child's own "direct" publisher,
       * created the first time it is needed and reused after.
       */
      if (!body.publisherId) {
        const { housePublisherForChild } = await import('../services/house-publisher.js');
        const house = await housePublisherForChild(tenantId);
        if (house) body.publisherId = house;
      }

      if (!body.publisherId) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Publisher ID is required' } };
      }

      const billableDurationSeconds =
        body.billableDurationSeconds !== undefined ? body.billableDurationSeconds : 60;
      const publisherPayoutPerBillableCall =
        body.publisherPayoutPerBillableCall !== undefined ? body.publisherPayoutPerBillableCall : 0;
      const buyerPricePerBillableCall =
        body.buyerPricePerBillableCall !== undefined ? body.buyerPricePerBillableCall : 0;

      if (billableDurationSeconds < 0) {
        void reply.code(400);
        return {
          error: { code: 'VALIDATION_ERROR', message: 'Billable duration seconds must be >= 0' },
        };
      }
      if (publisherPayoutPerBillableCall < 0) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Publisher payout per billable call must be >= 0',
          },
        };
      }
      if (buyerPricePerBillableCall < 0) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Buyer price per billable call must be >= 0',
          },
        };
      }

      // Verify publisher exists and belongs to tenant
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const publisher = await prisma.publisher.findFirst({
        where: {
          id: body.publisherId,
          tenantId: tenantId,
        },
      });

      if (!publisher) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
      }

      // Verify flow exists if provided
      if (body.flowId) {
        const flow = await prisma.flow.findFirst({
          where: {
            id: body.flowId,
            tenantId: tenantId,
          },
        });

        if (!flow) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Flow not found' } };
        }
      }

      // Verify caller ID pool exists if provided
      if (body.callerIdPoolId) {
        const callerIdPool = await prisma.callerIdPool.findFirst({
          where: {
            id: body.callerIdPoolId,
            tenantId: tenantId,
          },
        });

        if (!callerIdPool) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Caller ID pool not found' } };
        }
      }

      // Create campaign
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: tenantId,
          publisherId: body.publisherId,
          name: body.name.trim(),
          offerName: body.offerName?.trim() || null,
          country: body.country || 'US',
          recordingEnabled: body.recordingEnabled !== false,
          status: body.status || 'ACTIVE',
          flowId: body.flowId || null,
          callerIdPoolId: body.callerIdPoolId || null,
          billableDurationSeconds,
          publisherPayoutPerBillableCall: new Prisma.Decimal(publisherPayoutPerBillableCall),
          buyerPricePerBillableCall: new Prisma.Decimal(buyerPricePerBillableCall),
          metadata: (body.metadata as import('@prisma/client').Prisma.InputJsonValue) || {},
        },
      });

      // Automatically create a CampaignPublisher assignment row backfill/link for backward compatibility
      await prisma.campaignPublisher.create({
        data: {
          tenantId: tenantId,
          campaignId: campaign.id,
          publisherId: body.publisherId,
          payoutPerBillableCall: null,
          status: 'ACTIVE',
        },
      });

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Campaign',
        campaign.id,
        {
          name: campaign.name,
          publisherId: campaign.publisherId,
          status: campaign.status,
          flowId: campaign.flowId,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      void reply.code(201);
      return {
        id: campaign.id,
        tenantId: campaign.tenantId,
        publisherId: campaign.publisherId,
        name: campaign.name,
        offerName: campaign.offerName,
        country: campaign.country,
        recordingEnabled: campaign.recordingEnabled,
        status: campaign.status,
        flowId: campaign.flowId,
        callerIdPoolId: campaign.callerIdPoolId,
        billableDurationSeconds: campaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: campaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: campaign.buyerPricePerBillableCall,
        metadata: campaign.metadata,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_FAILED',
          message: (error as Error).message || 'Failed to create campaign',
        },
      };
    }
  });

  // GET campaign stats (call counts by time window)
  fastify.get('/api/v1/campaigns/stats', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Get all campaigns for this tenant
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId },
      select: { id: true },
    });

    const campaignIds = campaigns.map(c => c.id);

    // Calculate time boundaries
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Aggregate stats using groupBy for each time window
    const [liveStats, hourStats, dayStats, monthStats, totalStats] = await Promise.all([
      // Live calls (ANSWERED or RINGING status)
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          status: { in: ['ANSWERED', 'RINGING'] },
        },
        _count: { id: true },
      }),
      // Last hour
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: oneHourAgo },
        },
        _count: { id: true },
      }),
      // Today
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: startOfToday },
        },
        _count: { id: true },
      }),
      // This month
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: startOfMonth },
        },
        _count: { id: true },
      }),
      // All time
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
        },
        _count: { id: true },
      }),
    ]);

    // Create lookup maps
    const liveMap = new Map(liveStats.map(s => [s.campaignId, s._count.id]));
    const hourMap = new Map(hourStats.map(s => [s.campaignId, s._count.id]));
    const dayMap = new Map(dayStats.map(s => [s.campaignId, s._count.id]));
    const monthMap = new Map(monthStats.map(s => [s.campaignId, s._count.id]));
    const totalMap = new Map(totalStats.map(s => [s.campaignId, s._count.id]));

    // Build response
    const stats = campaignIds.map(campaignId => ({
      campaignId,
      liveCount: liveMap.get(campaignId) || 0,
      hourCount: hourMap.get(campaignId) || 0,
      dayCount: dayMap.get(campaignId) || 0,
      monthCount: monthMap.get(campaignId) || 0,
      totalCount: totalMap.get(campaignId) || 0,
    }));

    return { data: stats };
  });

  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: request.params.campaignId,
          tenantId,
        },
        include: {
          publisher: { select: { id: true, name: true, code: true } },
          flow: { select: { id: true, name: true } },
          _count: { select: { calls: true, phoneNumbers: true } },
        },
      });

      if (!campaign) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
      }

      return {
        id: campaign.id,
        name: campaign.name,
        offerName: campaign.offerName,
        country: campaign.country,
        recordingEnabled: campaign.recordingEnabled,
        status: campaign.status,
        publisherId: campaign.publisherId,
        publisher: campaign.publisher,
        flowId: campaign.flowId,
        flow: campaign.flow,
        callerIdPoolId: campaign.callerIdPoolId,
        metadata: campaign.metadata,
        billableDurationSeconds: campaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: campaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: campaign.buyerPricePerBillableCall,
        calls: campaign._count.calls,
        phoneNumbers: campaign._count.phoneNumbers,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    }
  );

  fastify.patch<{
    Params: { campaignId: string };
    Body: {
      name?: string;
      offerName?: string;
      country?: string;
      recordingEnabled?: boolean;
      status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
      flowId?: string | null;
      callerIdPoolId?: string | null;
      billableDurationSeconds?: number;
      publisherPayoutPerBillableCall?: number;
      buyerPricePerBillableCall?: number;
      /**
       * Only the ring-time settings are accepted here, and they are MERGED
       * into the campaign's metadata: replacing the object would drop the
       * answer order and every other routing setting it holds.
       */
      metadata?: { agentRingSeconds?: number; buyerRingSeconds?: number };
    };
  }>('/api/v1/campaigns/:campaignId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { campaignId } = request.params;
      const body = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify campaign exists and belongs to tenant
      const existingCampaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });

      if (!existingCampaign) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.offerName !== undefined) updateData.offerName = body.offerName?.trim() || null;
      if (body.country !== undefined) updateData.country = body.country;
      if (body.recordingEnabled !== undefined) updateData.recordingEnabled = body.recordingEnabled;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.flowId !== undefined) updateData.flowId = body.flowId;
      if (body.callerIdPoolId !== undefined) updateData.callerIdPoolId = body.callerIdPoolId;

      /*
       * The flow and the caller-ID pool are foreign keys the database does not
       * tie to a tenant. Create checks both; this route did not, which staff
       * never needed and an agency must not have: a white-label owner could
       * otherwise run their calls on another agency's flow and numbers. Staff
       * keep what they had.
       */
      if (!isPlatformPrincipal(request)) {
        if (body.flowId) {
          const flow = await prisma.flow.findFirst({
            where: { id: body.flowId, tenantId },
            select: { id: true },
          });
          if (!flow) {
            void reply.code(404);
            return { error: { code: 'NOT_FOUND', message: 'Flow not found' } };
          }
        }
        if (body.callerIdPoolId) {
          const pool = await prisma.callerIdPool.findFirst({
            where: { id: body.callerIdPoolId, tenantId },
            select: { id: true },
          });
          if (!pool) {
            void reply.code(404);
            return { error: { code: 'NOT_FOUND', message: 'Caller ID pool not found' } };
          }
        }
      }

      if (body.billableDurationSeconds !== undefined) {
        if (body.billableDurationSeconds < 0) {
          void reply.code(400);
          return {
            error: { code: 'VALIDATION_ERROR', message: 'Billable duration seconds must be >= 0' },
          };
        }
        updateData.billableDurationSeconds = body.billableDurationSeconds;
      }
      if (body.publisherPayoutPerBillableCall !== undefined) {
        if (body.publisherPayoutPerBillableCall < 0) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Publisher payout must be >= 0' } };
        }
        updateData.publisherPayoutPerBillableCall = new Prisma.Decimal(
          body.publisherPayoutPerBillableCall
        );
      }
      if (body.buyerPricePerBillableCall !== undefined) {
        if (body.buyerPricePerBillableCall < 0) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Buyer price must be >= 0' } };
        }
        updateData.buyerPricePerBillableCall = new Prisma.Decimal(body.buyerPricePerBillableCall);
      }

      // Ring time per routing step: agents' steps and buyer-only steps.
      if (body.metadata !== undefined && body.metadata !== null) {
        const ringTimes: Record<string, number> = {};
        for (const key of ['agentRingSeconds', 'buyerRingSeconds'] as const) {
          const value = body.metadata[key];
          if (value === undefined) continue;
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 10 || value > 120) {
            void reply.code(400);
            return {
              error: {
                code: 'VALIDATION_ERROR',
                message: `${key} must be a whole number of seconds from 10 to 120`,
              },
            };
          }
          ringTimes[key] = value;
        }
        if (Object.keys(ringTimes).length > 0) {
          const existingMeta =
            existingCampaign.metadata &&
            typeof existingCampaign.metadata === 'object' &&
            !Array.isArray(existingCampaign.metadata)
              ? (existingCampaign.metadata as Record<string, unknown>)
              : {};
          updateData.metadata = { ...existingMeta, ...ringTimes };
        }
      }

      // Update campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: updateData,
        include: {
          publisher: { select: { id: true, name: true, code: true } },
          flow: { select: { id: true, name: true } },
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'Campaign', campaignId, existingCampaign, updatedCampaign, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      return {
        id: updatedCampaign.id,
        name: updatedCampaign.name,
        offerName: updatedCampaign.offerName,
        country: updatedCampaign.country,
        recordingEnabled: updatedCampaign.recordingEnabled,
        status: updatedCampaign.status,
        publisherId: updatedCampaign.publisherId,
        publisher: updatedCampaign.publisher,
        flowId: updatedCampaign.flowId,
        flow: updatedCampaign.flow,
        callerIdPoolId: updatedCampaign.callerIdPoolId,
        metadata: updatedCampaign.metadata,
        billableDurationSeconds: updatedCampaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: updatedCampaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: updatedCampaign.buyerPricePerBillableCall,
        createdAt: updatedCampaign.createdAt.toISOString(),
        updatedAt: updatedCampaign.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update campaign',
        },
      };
    }
  });

  // Duplicate campaign
  fastify.post<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/duplicate',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { campaignId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Get the original campaign
        const original = await prisma.campaign.findFirst({
          where: { id: campaignId, tenantId },
        });

        if (!original) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }

        // Create a copy with " - Copy" appended and status set to PAUSED
        const duplicate = await prisma.campaign.create({
          data: {
            tenantId: original.tenantId,
            publisherId: original.publisherId,
            name: `${original.name} - Copy`,
            offerName: original.offerName,
            country: original.country,
            recordingEnabled: original.recordingEnabled,
            status: 'PAUSED',
            routingMode: original.routingMode,
            flowId: original.flowId,
            callerIdPoolId: original.callerIdPoolId,
            metadata: original.metadata || {},
          },
          include: {
            publisher: { select: { id: true, name: true, code: true } },
            flow: { select: { id: true, name: true } },
          },
        });

        // Audit log
        const { auditCreate } = await import('../services/audit.js');
        await auditCreate(
          tenantId,
          'Campaign',
          duplicate.id,
          { duplicatedFrom: campaignId, name: duplicate.name },
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: request.id,
          }
        );

        void reply.code(201);
        return {
          id: duplicate.id,
          name: duplicate.name,
          offerName: duplicate.offerName,
          country: duplicate.country,
          recordingEnabled: duplicate.recordingEnabled,
          status: duplicate.status,
          publisherId: duplicate.publisherId,
          publisher: duplicate.publisher,
          flowId: duplicate.flowId,
          flow: duplicate.flow,
          callerIdPoolId: duplicate.callerIdPoolId,
          metadata: duplicate.metadata,
          createdAt: duplicate.createdAt.toISOString(),
          updatedAt: duplicate.updatedAt.toISOString(),
        };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DUPLICATE_FAILED',
            message: (error as Error).message || 'Failed to duplicate campaign',
          },
        };
      }
    }
  );

  fastify.delete<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { campaignId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Verify campaign exists and belongs to tenant
        const campaign = await prisma.campaign.findFirst({
          where: { id: campaignId, tenantId },
        });

        if (!campaign) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }

        // Delete campaign
        await prisma.campaign.delete({ where: { id: campaignId } });

        // Audit log
        const { auditDelete } = await import('../services/audit.js');
        await auditDelete(tenantId, 'Campaign', campaignId, campaign, {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        });

        void reply.code(204);
        return;
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DELETE_FAILED',
            message: (error as Error).message || 'Failed to delete campaign',
          },
        };
      }
    }
  );

  // GET campaign publishers
  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/publishers',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return replyTenantRefusal(request, reply);

      const { campaignId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const publishers = await prisma.campaignPublisher.findMany({
        where: { campaignId, tenantId },
        include: {
          publisher: { select: { id: true, name: true, code: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: publishers };
    }
  );

  // POST campaign publisher assignment
  fastify.post<{
    Params: { campaignId: string };
    Body: {
      publisherId: string;
      payoutPerBillableCall?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/campaigns/:campaignId/publishers', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) return replyTenantRefusal(request, reply);

    const { campaignId } = request.params;
    const { publisherId, payoutPerBillableCall, status } = request.body;

    if (!publisherId) {
      return reply.code(400).send({ error: 'publisherId is required' });
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Verify campaign & publisher belong to tenant
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

    const publisher = await prisma.publisher.findFirst({ where: { id: publisherId, tenantId } });
    if (!publisher) return reply.code(404).send({ error: 'Publisher not found' });

    // Check duplicate
    const existing = await prisma.campaignPublisher.findUnique({
      where: {
        tenantId_campaignId_publisherId: { tenantId, campaignId, publisherId },
      },
    });

    if (existing) {
      return reply
        .code(409)
        .send({ error: 'Publisher is already assigned to this campaign', existingId: existing.id });
    }

    const assignment = await prisma.campaignPublisher.create({
      data: {
        tenantId,
        campaignId,
        publisherId,
        payoutPerBillableCall:
          payoutPerBillableCall !== undefined && payoutPerBillableCall !== null
            ? new Prisma.Decimal(payoutPerBillableCall)
            : null,
        status: status || 'ACTIVE',
      },
      include: {
        publisher: { select: { id: true, name: true } },
      },
    });

    return reply.code(201).send({ data: assignment });
  });

  // PATCH campaign publisher assignment
  fastify.patch<{
    Params: { campaignId: string; assignmentId: string };
    Body: {
      payoutPerBillableCall?: number | null;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/campaigns/:campaignId/publishers/:assignmentId', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) return replyTenantRefusal(request, reply);

    const { campaignId, assignmentId } = request.params;
    const { payoutPerBillableCall, status } = request.body;
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const existing = await prisma.campaignPublisher.findFirst({
      where: { id: assignmentId, campaignId, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

    const updated = await prisma.campaignPublisher.update({
      where: { id: assignmentId },
      data: {
        payoutPerBillableCall:
          payoutPerBillableCall !== undefined
            ? payoutPerBillableCall === null
              ? null
              : new Prisma.Decimal(payoutPerBillableCall)
            : undefined,
        status: status || undefined,
      },
      include: {
        publisher: { select: { id: true, name: true } },
      },
    });

    return { data: updated };
  });

  // DELETE campaign publisher assignment
  fastify.delete<{ Params: { campaignId: string; assignmentId: string } }>(
    '/api/v1/campaigns/:campaignId/publishers/:assignmentId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return replyTenantRefusal(request, reply);

      const { campaignId, assignmentId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignPublisher.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      await prisma.campaignPublisher.delete({ where: { id: assignmentId } });
      return reply.code(204).send();
    }
  );

  // GET campaign buyers
  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/buyers',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return replyTenantRefusal(request, reply);

      const { campaignId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const buyers = await prisma.campaignBuyer.findMany({
        where: { campaignId, tenantId },
        include: {
          buyer: { select: { id: true, name: true, code: true } },
          buyerEndpoint: { select: { id: true, name: true, destination: true } },
        },
        orderBy: { priority: 'desc' },
      });

      return { data: buyers };
    }
  );

  // POST campaign buyer assignment
  fastify.post<{
    Params: { campaignId: string };
    Body: {
      buyerId: string;
      buyerEndpointId?: string;
      destinationNumber: string;
      pricePerBillableCall?: number;
      priority?: number;
      weight?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/campaigns/:campaignId/buyers', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) return replyTenantRefusal(request, reply);

    const { campaignId } = request.params;
    const {
      buyerId,
      buyerEndpointId,
      destinationNumber,
      pricePerBillableCall,
      priority,
      weight,
      status,
    } = request.body;

    if (!buyerId || !destinationNumber) {
      return reply.code(400).send({ error: 'buyerId and destinationNumber are required' });
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Verify campaign & buyer belong to tenant
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

    const buyer = await prisma.buyer.findFirst({ where: { id: buyerId, tenantId } });
    if (!buyer) return reply.code(404).send({ error: 'Buyer not found' });

    // Verify endpoint type and validate destination number format
    let normalizedDestination = destinationNumber.trim();
    let isPstn = true;

    if (buyerEndpointId) {
      const ep = await prisma.buyerEndpoint.findFirst({ where: { id: buyerEndpointId, buyerId } });
      if (!ep) return reply.code(404).send({ error: 'Buyer endpoint not found' });
      if (ep.type === 'SIP' || ep.type === 'WEBRTC') {
        isPstn = false;
      }
    }

    if (/^\d{4}$/.test(normalizedDestination)) {
      isPstn = false;
      // An extension is platform-wide; an agency rings only its own agents.
      if (
        !isPlatformPrincipal(request) &&
        (await extensionsOutsideTenant(prisma, tenantId, normalizedDestination)).length > 0
      ) {
        return reply.code(400).send({ error: 'That extension is not one of your agents' });
      }
    }

    if (isPstn) {
      // E.164 normalization & validation
      const digits = normalizedDestination.replace(/\D/g, '');
      if (digits.length < 10) {
        return reply
          .code(400)
          .send({ error: 'PSTN destination number must have at least 10 digits' });
      }
      normalizedDestination = digits.length === 10 ? `+1${digits}` : `+${digits}`;
      // Validate with standard E.164 regex
      if (!/^\+[1-9]\d{1,14}$/.test(normalizedDestination)) {
        return reply.code(400).send({ error: 'Invalid destination number format' });
      }
    }

    // Check duplicate (unique tenantId, campaignId, buyerId, destinationNumber)
    const existing = await prisma.campaignBuyer.findUnique({
      where: {
        tenantId_campaignId_buyerId_destinationNumber: {
          tenantId,
          campaignId,
          buyerId,
          destinationNumber: normalizedDestination,
        },
      },
    });

    if (existing) {
      return reply.code(409).send({
        error: 'Buyer with this destination is already assigned to this campaign',
        existingId: existing.id,
      });
    }

    /*
     * A campaign with a "who answers first" mode places a new buyer by that
     * mode's rule, not by whatever priority the body carried: the rule is
     * re-run over the whole campaign after the insert, in the same
     * transaction, so the new row is ranked relative to the buyers already
     * there and the agents stay where the mode put them. No mode set, and the
     * priority is written as given, exactly as before.
     */
    const answerOrder = answerOrderFromMetadata(campaign.metadata);

    const assignment = await prisma.$transaction(async tx => {
      const created = await tx.campaignBuyer.create({
        data: {
          tenantId,
          campaignId,
          buyerId,
          buyerEndpointId: buyerEndpointId || null,
          destinationNumber: normalizedDestination,
          pricePerBillableCall:
            pricePerBillableCall !== undefined && pricePerBillableCall !== null
              ? new Prisma.Decimal(pricePerBillableCall)
              : null,
          priority: priority || 0,
          weight: weight !== undefined ? weight : 100,
          status: status || 'ACTIVE',
        },
        select: { id: true },
      });

      if (answerOrder) {
        await applyAnswerOrder(tx, tenantId, campaignId, answerOrder);
      }

      return tx.campaignBuyer.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          buyer: { select: { id: true, name: true } },
          buyerEndpoint: { select: { id: true, name: true } },
        },
      });
    });

    return reply.code(201).send({ data: assignment });
  });

  // PATCH campaign buyer assignment
  fastify.patch<{
    Params: { campaignId: string; assignmentId: string };
    Body: {
      buyerEndpointId?: string | null;
      destinationNumber?: string;
      pricePerBillableCall?: number | null;
      priority?: number;
      weight?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/campaigns/:campaignId/buyers/:assignmentId', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) return replyTenantRefusal(request, reply);

    const { campaignId, assignmentId } = request.params;
    const { buyerEndpointId, destinationNumber, pricePerBillableCall, priority, weight, status } =
      request.body;
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const existing = await prisma.campaignBuyer.findFirst({
      where: { id: assignmentId, campaignId, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

    let normalizedDestination =
      destinationNumber !== undefined ? destinationNumber.trim() : existing.destinationNumber;
    let isPstn = true;

    const targetEpId = buyerEndpointId !== undefined ? buyerEndpointId : existing.buyerEndpointId;
    if (targetEpId) {
      const ep = await prisma.buyerEndpoint.findFirst({
        where: { id: targetEpId, buyerId: existing.buyerId },
      });
      if (!ep) return reply.code(404).send({ error: 'Buyer endpoint not found' });
      if (ep.type === 'SIP' || ep.type === 'WEBRTC') {
        isPstn = false;
      }
    }

    if (/^\d{4}$/.test(normalizedDestination)) {
      isPstn = false;
      // An extension is platform-wide; an agency rings only its own agents.
      if (
        destinationNumber !== undefined &&
        !isPlatformPrincipal(request) &&
        (await extensionsOutsideTenant(prisma, tenantId, normalizedDestination)).length > 0
      ) {
        return reply.code(400).send({ error: 'That extension is not one of your agents' });
      }
    }

    if (isPstn && destinationNumber !== undefined) {
      const digits = normalizedDestination.replace(/\D/g, '');
      if (digits.length < 10) {
        return reply
          .code(400)
          .send({ error: 'PSTN destination number must have at least 10 digits' });
      }
      normalizedDestination = digits.length === 10 ? `+1${digits}` : `+${digits}`;
      if (!/^\+[1-9]\d{1,14}$/.test(normalizedDestination)) {
        return reply.code(400).send({ error: 'Invalid destination number format' });
      }
    }

    // Check duplicate if destination number is changing
    if (destinationNumber !== undefined && normalizedDestination !== existing.destinationNumber) {
      const dup = await prisma.campaignBuyer.findUnique({
        where: {
          tenantId_campaignId_buyerId_destinationNumber: {
            tenantId,
            campaignId,
            buyerId: existing.buyerId,
            destinationNumber: normalizedDestination,
          },
        },
      });
      if (dup && dup.id !== assignmentId) {
        return reply.code(409).send({ error: 'Another assignment exists with this destination' });
      }
    }

    const updated = await prisma.campaignBuyer.update({
      where: { id: assignmentId },
      data: {
        buyerEndpointId: buyerEndpointId !== undefined ? buyerEndpointId : undefined,
        destinationNumber: destinationNumber !== undefined ? normalizedDestination : undefined,
        pricePerBillableCall:
          pricePerBillableCall !== undefined
            ? pricePerBillableCall === null
              ? null
              : new Prisma.Decimal(pricePerBillableCall)
            : undefined,
        priority: priority !== undefined ? priority : undefined,
        weight: weight !== undefined ? weight : undefined,
        status: status || undefined,
      },
      include: {
        buyer: { select: { id: true, name: true } },
        buyerEndpoint: { select: { id: true, name: true } },
      },
    });

    return { data: updated };
  });

  // DELETE campaign buyer assignment
  fastify.delete<{ Params: { campaignId: string; assignmentId: string } }>(
    '/api/v1/campaigns/:campaignId/buyers/:assignmentId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return replyTenantRefusal(request, reply);

      const { campaignId, assignmentId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignBuyer.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      await prisma.campaignBuyer.delete({ where: { id: assignmentId } });
      return reply.code(204).send();
    }
  );

  /**
   * PUT /api/v1/campaigns/:campaignId/answer-order
   *
   * "Who answers first": the agency's own agents, its buyers, or both
   * together. Rewrites the campaign's CampaignAgent and CampaignBuyer
   * priorities by the rule in `services/campaigns/answer-order.ts` and stores
   * the mode on `campaign.metadata.answerOrder`, so later assignments are
   * placed by the same rule. Routing is not changed: it already reads those
   * priorities.
   *
   * Same access as every other campaign write: staff, or a white-label OWNER
   * or ADMIN (`WHITE_LABEL_ALLOWED` in lib/staff-only-endpoints.ts), and only
   * ever on the acting tenant's own campaign -- anybody else's is a 404.
   *
   * One transaction: the priorities, the mode and the audit row commit or fail
   * together, so the stored mode can never describe priorities that were not
   * written.
   */
  fastify.put<{ Params: { campaignId: string }; Body: { answerOrder?: unknown } }>(
    '/api/v1/campaigns/:campaignId/answer-order',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return replyTenantRefusal(request, reply);

      const answerOrder = request.body?.answerOrder;
      if (!isAnswerOrder(answerOrder)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `answerOrder must be one of: ${ANSWER_ORDERS.join(', ')}`,
          },
        });
      }

      const { campaignId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
        select: { id: true, metadata: true },
      });
      if (!campaign) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
      }

      const previous = answerOrderFromMetadata(campaign.metadata);
      const metadata =
        campaign.metadata &&
        typeof campaign.metadata === 'object' &&
        !Array.isArray(campaign.metadata)
          ? (campaign.metadata as Record<string, unknown>)
          : {};

      const result = await prisma.$transaction(async tx => {
        const plan = await applyAnswerOrder(tx, tenantId, campaignId, answerOrder);

        await tx.campaign.update({
          where: { id: campaignId },
          data: { metadata: { ...metadata, answerOrder } as Prisma.InputJsonValue },
        });

        const [agents, buyers] = await Promise.all([
          tx.campaignAgent.findMany({
            where: { tenantId, campaignId },
            select: { userId: true, priority: true },
            orderBy: { createdAt: 'asc' },
          }),
          tx.campaignBuyer.findMany({
            where: { tenantId, campaignId },
            select: { buyerId: true, priority: true },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          }),
        ]);

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: getActingUserId(request) ?? undefined,
            action: 'campaign.answer_order.set',
            entityType: 'Campaign',
            entityId: campaignId,
            resource: request.url,
            method: request.method,
            requestId: request.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            changes: {
              before: { answerOrder: previous },
              after: { answerOrder },
              agentsUpdated: plan.agents.length,
              buyersUpdated: plan.buyers.length,
            },
          },
        });

        return { agents, buyers };
      });

      return reply.send({
        data: {
          answerOrder,
          agents: result.agents.map(a => ({ userId: a.userId, priority: a.priority })),
          buyers: result.buyers.map(b => ({ buyerId: b.buyerId, priority: b.priority })),
        },
      });
    }
  );
}

// Public API - Flows
export async function registerFlowRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/api/v1/flows', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const flows = await prisma.flow.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            version: true,
          },
        },
      },
    });

    return {
      data: flows.map(f => ({
        id: f.id,
        name: f.name,
        version: f.versions[0]?.version || 1,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      meta: {
        total: flows.length,
      },
    };
  });

  fastify.post('/api/v1/flows', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Flow',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { flowId: string } }>('/api/v1/flows/:flowId', async (request, _reply) => {
    return {
      id: request.params.flowId,
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Flow',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.patch<{ Params: { flowId: string } }>(
    '/api/v1/flows/:flowId',
    async (request, _reply) => {
      return {
        id: request.params.flowId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Flow',
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Public API - Publishers
export async function registerPublisherRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  // GET all publishers (with pagination)
  fastify.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
    '/api/v1/publishers',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '50');
      const skip = (page - 1) * limit;
      const statusFilter = request.query.status;

      const whereClause: { tenantId: string; status?: 'ACTIVE' | 'INACTIVE' } = { tenantId };
      if (statusFilter === 'ACTIVE' || statusFilter === 'INACTIVE') {
        whereClause.status = statusFilter;
      }

      const [publishers, total] = await Promise.all([
        prisma.publisher.findMany({
          where: whereClause,
          take: limit,
          skip,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            code: true,
            email: true,
            accessToRecordings: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.publisher.count({ where: whereClause }),
      ]);

      return {
        data: publishers.map(p => ({
          id: p.id,
          name: p.name,
          code: p.code,
          email: p.email,
          accessToRecordings: p.accessToRecordings,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  // GET publisher stats (server-side aggregation)
  fastify.get('/api/v1/publishers/stats', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Get all publishers for this tenant
    const publishers = await prisma.publisher.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true, status: true },
    });

    // Aggregate call stats for each publisher using Prisma groupBy
    const callStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null } },
      _count: { id: true },
    });

    const billableStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null }, billable: true },
      _count: { id: true },
    });

    const missedStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null }, missedCall: true },
      _count: { id: true },
    });

    // Create lookup maps
    const totalCallsMap = new Map(callStats.map(s => [s.publisherId, s._count.id]));
    const billableCallsMap = new Map(billableStats.map(s => [s.publisherId, s._count.id]));
    const missedCallsMap = new Map(missedStats.map(s => [s.publisherId, s._count.id]));

    // Combine data
    const stats = publishers.map(p => {
      const totalCalls = totalCallsMap.get(p.id) || 0;
      const billableCalls = billableCallsMap.get(p.id) || 0;
      const missedCalls = missedCallsMap.get(p.id) || 0;
      const conversionRate = totalCalls > 0 ? (billableCalls / totalCalls) * 100 : 0;

      return {
        publisherId: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        totalCalls,
        billableCalls,
        missedCalls,
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    return { data: stats };
  });

  // POST create publisher
  fastify.post<{
    Body: {
      name: string;
      email?: string;
      accessToRecordings?: boolean;
    };
  }>('/api/v1/publishers', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const body = request.body;

      if (!body.name || !body.name.trim()) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Publisher name is required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const { generatePublisherCode, sendWelcomeEmail } = await import(
        '../services/publisher-email.js'
      );

      // Generate 32-char hex code
      const code = generatePublisherCode();

      // Create publisher
      const publisher = await prisma.publisher.create({
        data: {
          tenantId,
          name: body.name.trim(),
          code,
          email: body.email?.trim() || null,
          accessToRecordings: body.accessToRecordings || false,
          status: 'ACTIVE',
        },
      });

      // Tell the publisher they have been added, if we have an address. Never
      // fatal: the publisher row is written, and an SMTP outage is not a reason
      // to answer the agency with a 500 for a party that now exists. A login
      // is a separate portal-access invitation, not this.
      if (publisher.email) {
        try {
          const agency = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true },
          });
          await sendWelcomeEmail({
            email: publisher.email,
            publisherName: publisher.name,
            publisherId: publisher.code,
            accessToRecordings: publisher.accessToRecordings,
            tenantId,
            agencyName: agency?.name ?? null,
          });
        } catch (error) {
          request.log.error(
            { err: error, publisherId: publisher.id },
            'Publisher welcome email could not be sent; publisher created anyway'
          );
        }
      }

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Publisher',
        publisher.id,
        {
          name: publisher.name,
          code: publisher.code,
          email: publisher.email,
          accessToRecordings: publisher.accessToRecordings,
          status: publisher.status,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      void reply.code(201);
      return {
        id: publisher.id,
        tenantId: publisher.tenantId,
        name: publisher.name,
        code: publisher.code,
        email: publisher.email,
        accessToRecordings: publisher.accessToRecordings,
        status: publisher.status,
        createdAt: publisher.createdAt.toISOString(),
        updatedAt: publisher.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_FAILED',
          message: (error as Error).message || 'Failed to create publisher',
        },
      };
    }
  });

  // PATCH update publisher
  fastify.patch<{
    Params: { publisherId: string };
    Body: {
      name?: string;
      email?: string;
      accessToRecordings?: boolean;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/publishers/:publisherId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { publisherId } = request.params;
      const body = request.body;

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify publisher exists and belongs to tenant
      const existingPublisher = await prisma.publisher.findFirst({
        where: { id: publisherId, tenantId },
      });

      if (!existingPublisher) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
      }

      // Build update data
      const updateData: {
        name?: string;
        email?: string | null;
        accessToRecordings?: boolean;
        status?: 'ACTIVE' | 'INACTIVE';
      } = {};

      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.email !== undefined) updateData.email = body.email?.trim() || null;
      if (body.accessToRecordings !== undefined)
        updateData.accessToRecordings = body.accessToRecordings;
      if (body.status !== undefined) updateData.status = body.status;

      const publisher = await prisma.publisher.update({
        where: { id: publisherId },
        data: updateData,
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'Publisher', publisher.id, existingPublisher, publisher, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      return {
        id: publisher.id,
        tenantId: publisher.tenantId,
        name: publisher.name,
        code: publisher.code,
        email: publisher.email,
        accessToRecordings: publisher.accessToRecordings,
        status: publisher.status,
        createdAt: publisher.createdAt.toISOString(),
        updatedAt: publisher.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update publisher',
        },
      };
    }
  });

  // DELETE publisher
  fastify.delete<{ Params: { publisherId: string } }>(
    '/api/v1/publishers/:publisherId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { publisherId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Verify publisher exists and belongs to tenant
        const publisher = await prisma.publisher.findFirst({
          where: { id: publisherId, tenantId },
        });

        if (!publisher) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
        }

        // Delete publisher (cascades to related data per schema)
        await prisma.publisher.delete({
          where: { id: publisherId },
        });

        // Audit log
        const { auditDelete } = await import('../services/audit.js');
        await auditDelete(tenantId, 'Publisher', publisher.id, publisher, {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        });

        void reply.code(204);
        return;
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DELETE_FAILED',
            message: (error as Error).message || 'Failed to delete publisher',
          },
        };
      }
    }
  );

  // GET single publisher
  fastify.get<{ Params: { publisherId: string } }>(
    '/api/v1/publishers/:publisherId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { publisherId } = request.params;

        const { requirePublisherAccess } = await import('../middleware/rbac.js');
        if (!requirePublisherAccess(user, publisherId)) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
        }

        const prisma = (await import('../lib/prisma.js')).getPrismaClient();
        const publisher = await prisma.publisher.findFirst({
          where: { id: publisherId, tenantId },
        });

        if (!publisher) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
        }

        return {
          id: publisher.id,
          tenantId: publisher.tenantId,
          name: publisher.name,
          code: publisher.code,
          email: publisher.email,
          accessToRecordings: publisher.accessToRecordings,
          status: publisher.status,
          createdAt: publisher.createdAt.toISOString(),
          updatedAt: publisher.updatedAt.toISOString(),
        };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'GET_FAILED',
            message: (error as Error).message || 'Failed to retrieve publisher',
          },
        };
      }
    }
  );

  // GET publisher stats
  fastify.get<{
    Params: { publisherId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/api/v1/publishers/:publisherId/stats', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { publisherId } = request.params;

      const { requirePublisherAccess } = await import('../middleware/rbac.js');
      if (!requirePublisherAccess(user, publisherId)) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const startDate = request.query.startDate
        ? new Date(request.query.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

      const callsWhere = {
        publisherId,
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
      };

      const [
        callsCount,
        billableCount,
        totalPayoutSum,
        avgDurationResult,
        pingCount,
        noBidCount,
        topCampaignsRaw,
        recentCallsRaw,
      ] = await Promise.all([
        prisma.call.count({ where: callsWhere }),
        prisma.call.count({ where: { ...callsWhere, billable: true } }),
        prisma.call.aggregate({
          where: callsWhere,
          _sum: { publisherPayoutAmount: true },
        }),
        prisma.call.aggregate({
          where: callsWhere,
          _avg: { connectedDuration: true },
        }),
        prisma.pingRequest.count({
          where: {
            publisherId,
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.pingRequest.count({
          where: {
            publisherId,
            status: 'NO_BID',
            createdAt: { gte: startDate, lte: endDate },
          },
        }),
        prisma.call.groupBy({
          by: ['campaignId', 'campaignName'],
          where: callsWhere,
          _count: { id: true },
          _sum: { publisherPayoutAmount: true },
          orderBy: { _count: { id: 'desc' } },
          take: 5,
        }),
        prisma.call.findMany({
          where: callsWhere,
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            campaign: true,
            fromNumber: true,
            createdBy: { select: { firstName: true, lastName: true } },
            recordings: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        }),
      ]);

      const totalCalls = callsCount;
      const billableCalls = billableCount;
      const nonBillableCalls = totalCalls - billableCalls;
      const billableRate = totalCalls > 0 ? (billableCalls / totalCalls) * 100 : 0;
      const payout = totalPayoutSum._sum.publisherPayoutAmount
        ? Number(totalPayoutSum._sum.publisherPayoutAmount)
        : 0;
      const avgConnectedDuration = avgDurationResult._avg.connectedDuration
        ? Math.round(avgDurationResult._avg.connectedDuration)
        : 0;

      const topCampaigns = topCampaignsRaw.map((tc: any) => ({
        campaignId: tc.campaignId || 'unknown',
        campaignName: tc.campaignName || 'Unknown Campaign',
        callsCount: tc._count.id,
        payout: tc._sum.publisherPayoutAmount ? Number(tc._sum.publisherPayoutAmount) : 0,
      }));

      const profile = await getUserProfile(request, prisma);
      const apiBaseUrl = getPublicApiBaseUrl(request);
      const recentCalls = recentCallsRaw.map((call: any) =>
        mapCallRecord(call, apiBaseUrl, prisma, request, true, profile)
      );

      return {
        totalCalls,
        billableCalls,
        nonBillableCalls,
        payout,
        billableRate,
        averageConnectedDuration: avgConnectedDuration,
        pingCount,
        noBidCount,
        topCampaigns,
        recentCalls,
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'STATS_FAILED',
          message: (error as Error).message || 'Failed to aggregate publisher stats',
        },
      };
    }
  });

  // GET API Keys list
  fastify.get<{ Params: { publisherId: string } }>(
    '/api/v1/publishers/:publisherId/keys',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { publisherId } = request.params;

        const { requirePublisherAccess } = await import('../middleware/rbac.js');
        if (!requirePublisherAccess(user, publisherId)) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
        }

        const prisma = (await import('../lib/prisma.js')).getPrismaClient();
        const keys = await prisma.apiKey.findMany({
          where: {
            tenantId,
            publisherId,
            status: { not: 'REVOKED' },
          },
          select: {
            id: true,
            name: true,
            prefix: true,
            status: true,
            scopes: true,
            lastUsedAt: true,
            createdAt: true,
            expiresAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        return { keys };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'LIST_KEYS_FAILED',
            message: (error as Error).message || 'Failed to list API keys',
          },
        };
      }
    }
  );

  // POST create API Key
  fastify.post<{
    Params: { publisherId: string };
    Body: { name?: string; expiresDays?: number };
  }>('/api/v1/publishers/:publisherId/keys', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { publisherId } = request.params;

      const { requirePublisherAccess } = await import('../middleware/rbac.js');
      if (!requirePublisherAccess(user, publisherId)) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
      }

      const body = request.body || {};
      const keyName = body.name?.trim() || 'API Key';

      // Generate raw key prefix 'hw_pub_' + random bytes
      const crypto = await import('crypto');
      const rawKey = `hw_pub_${crypto.randomBytes(24).toString('hex')}`;
      const prefix = rawKey.substring(0, 8);
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      let expiresAt: Date | null = null;
      if (body.expiresDays && body.expiresDays > 0) {
        expiresAt = new Date(Date.now() + body.expiresDays * 24 * 60 * 60 * 1000);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          tenantId,
          publisherId,
          name: keyName,
          keyHash,
          prefix,
          scopes: ['ping', 'post'],
          status: 'ACTIVE',
          expiresAt,
        },
      });

      void reply.code(201);
      return {
        key: {
          id: apiKeyRecord.id,
          name: apiKeyRecord.name,
          prefix: apiKeyRecord.prefix,
          status: apiKeyRecord.status,
          scopes: apiKeyRecord.scopes,
          createdAt: apiKeyRecord.createdAt.toISOString(),
          expiresAt: apiKeyRecord.expiresAt?.toISOString() || null,
        },
        rawKey,
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_KEY_FAILED',
          message: (error as Error).message || 'Failed to create API key',
        },
      };
    }
  });

  // DELETE revoke API Key
  fastify.delete<{ Params: { publisherId: string; keyId: string } }>(
    '/api/v1/publishers/:publisherId/keys/:keyId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { publisherId, keyId } = request.params;

        const { requirePublisherAccess } = await import('../middleware/rbac.js');
        if (!requirePublisherAccess(user, publisherId)) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
        }

        const prisma = (await import('../lib/prisma.js')).getPrismaClient();
        const key = await prisma.apiKey.findFirst({
          where: { id: keyId, publisherId, tenantId },
        });

        if (!key) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'API key not found' } };
        }

        await prisma.apiKey.update({
          where: { id: keyId },
          data: { status: 'REVOKED' },
        });

        return { success: true };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'REVOKE_KEY_FAILED',
            message: (error as Error).message || 'Failed to revoke API key',
          },
        };
      }
    }
  );

  // GET publisher integration docs
  fastify.get<{ Params: { publisherId: string } }>(
    '/api/v1/publishers/:publisherId/docs',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const tenantId = getActingTenantId(request);

        if (!tenantId) {
          return sendTenantRefusal(request, reply);
        }

        const { publisherId } = request.params;

        const { requirePublisherAccess } = await import('../middleware/rbac.js');
        if (!requirePublisherAccess(user, publisherId)) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied' } };
        }

        const prisma = (await import('../lib/prisma.js')).getPrismaClient();
        // Scoped by tenant, not just by `requirePublisherAccess`: that helper
        // returns true for ANY publisherId as soon as the caller holds ADMIN or
        // OWNER, and those are per-tenant roles. Without the tenant on the
        // query, an administrator of one agency could read another agency's
        // publisher code off this endpoint.
        const publisher = await prisma.publisher.findFirst({
          where: { id: publisherId, tenantId },
        });

        if (!publisher) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
        }

        const host = request.headers.host || 'agents.netenroll.com';
        const protocol = request.headers['x-forwarded-proto'] || 'https';
        const baseUrl = `${protocol}://${host}`;

        /*
         * Who a publisher writes to when a call did not price the way they
         * expected: the agency that pays them, not NetEnroll. The docs page
         * used to print support@netenroll.com, which sent a white-label
         * agency's publishers to a platform they have never heard of about a
         * price only the agency sets. The agency's first active OWNER, in
         * this tenant; null when it has none, and the page says to contact
         * the agency instead.
         */
        const owner = await prisma.user.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE',
            roles: { some: { role: { name: 'OWNER' } } },
          },
          orderBy: { createdAt: 'asc' },
          select: { email: true },
        });

        return {
          publisherId,
          publisherCode: publisher.code,
          supportEmail: owner?.email ?? null,
          pingEndpoint: `${baseUrl}/api/v1/ping`,
          postEndpoint: `${baseUrl}/api/v1/post`,
          docs: {
            curlPing: `curl -X POST ${baseUrl}/api/v1/ping \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: YOUR_API_KEY" \\\n  -d '{\n    "request_id": "unique-uuid-for-idempotency",\n    "vertical": "health_insurance",\n    "caller": {\n      "zip": "37901",\n      "state": "TN",\n      "age": 67\n    },\n    "source": "landing_page",\n    "min_bid": 10.00\n  }'`,
            curlPost: `curl -X POST ${baseUrl}/api/v1/post \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: YOUR_API_KEY" \\\n  -d '{\n    "token": "YOUR_BID_TOKEN",\n    "caller_number": "+12816991120"\n  }'`,
          },
        };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DOCS_FAILED',
            message: (error as Error).message || 'Failed to retrieve integration documentation',
          },
        };
      }
    }
  );
}

// Public API - Calls
export async function registerCallRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  // 1. GET /api/v1/calls — List all calls
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      phone?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      buyerId?: string;
      publisherId?: string;
      campaignId?: string;
      disputeStatus?: string;
      listId?: string;
      agentId?: string;
      disposition?: string;
      outcome?: string;
      hasRecording?: string;
      billable?: string;
    };
  }>('/api/v1/calls', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const startDate = request.query.startDate;
    const endDate = request.query.endDate;

    if (startDate) {
      const parsed = new Date(startDate);
      if (isNaN(parsed.getTime())) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid startDate format' } };
      }
    }

    if (endDate) {
      const parsed = new Date(endDate);
      if (isNaN(parsed.getTime())) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid endDate format' } };
      }
    }

    if (startDate && endDate) {
      if (new Date(startDate) > new Date(endDate)) {
        void reply.code(400);
        return {
          error: { code: 'VALIDATION_ERROR', message: 'startDate cannot be after endDate' },
        };
      }
    }

    /*
     * Recording reconciliation, off the read path.
     *
     * This used to be awaited before the list query ran: up to fifty stale
     * recordings reconciled one page load, each of which can read a file off
     * disk and push it to S3. Every one of those seconds is a second the call
     * ledger has not answered, and past the gateway timeout the browser gets a
     * 504 for a query that would have returned in milliseconds. Housekeeping
     * for recordings is not a precondition for showing an agency its calls, and
     * it must never be the reason they cannot see them.
     *
     * Fire and forget. The reconciler is idempotent and re-runs on the next
     * request, so a page that races it shows PROCESSING for one reload rather
     * than nothing at all.
     */
    void import('../services/recording-reconciler.js')
      .then(({ reconcileStaleRecordingsForTenant }) => reconcileStaleRecordingsForTenant(tenantId))
      .catch((err: unknown) => {
        request.log.error({ err, tenantId }, 'Recording reconciliation failed (background)');
      });

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const page = parseInt(request.query.page || '1');
    const limit = parseInt(request.query.limit || '20');
    const skip = (page - 1) * limit;

    const profile = await getUserProfile(request, prisma);

    let listPhoneNumbers: string[] | undefined = undefined;
    if (request.query.listId && request.query.listId !== 'all') {
      const leads = await prisma.insuranceLead.findMany({
        where: { tenantId, listId: request.query.listId },
        select: { phone: true },
      });
      listPhoneNumbers = leads.map(l => l.phone);
    }

    const where = buildCallWhere({
      tenantId,
      isAdminOrOwner: profile.isAdminOrOwner,
      userId: user?.userId,
      search: request.query.search,
      phone: request.query.phone,
      startDate: request.query.startDate,
      endDate: request.query.endDate,
      buyerId: profile.isAdminOrOwner ? request.query.buyerId : profile.buyerId,
      publisherId: profile.isAdminOrOwner ? request.query.publisherId : profile.publisherId,
      campaignId: request.query.campaignId,
      disputeStatus: request.query.disputeStatus,
      listPhoneNumbers,
      /*
       * Only a principal may name an agent. For anybody else the parameter is
       * dropped rather than refused: their list is already their own calls,
       * and a 400 on a stray query parameter would break a bookmarked link
       * shared from a principal's screen for no gain.
       */
      agentId: profile.isAdminOrOwner ? request.query.agentId : undefined,
      disposition: request.query.disposition,
      outcome: request.query.outcome,
      hasRecording: request.query.hasRecording,
      billable: request.query.billable,
    });

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          campaign: true,
          fromNumber: true,
          publisher: true,
          buyer: true,
          createdBy: { select: { firstName: true, lastName: true } },
          recordings: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.call.count({ where }),
    ]);

    await attachAnsweredBy(calls, prisma, tenantId);

    const apiBaseUrl = getPublicApiBaseUrl(request);
    /*
     * The sale on each call, for the ledger's Application column: the first
     * submitted, non-voided application against it, by the same definition
     * the call detail's `hasSubmittedApplication` uses. One query for the
     * page, not one per row.
     */
    const pageCallIds = calls.map(call => call.id);
    const submittedApplications = pageCallIds.length
      ? await prisma.insuranceCarrierApplication.findMany({
          where: {
            tenantId,
            callId: { in: pageCallIds },
            submittedAt: { not: null },
            voidedAt: null,
          },
          orderBy: { submittedAt: 'asc' },
          select: { id: true, callId: true, carrier: true },
        })
      : [];
    const applicationByCall = new Map<string, { id: string; carrier: string }>();
    for (const application of submittedApplications) {
      if (application.callId && !applicationByCall.has(application.callId)) {
        applicationByCall.set(application.callId, {
          id: application.id,
          carrier: application.carrier,
        });
      }
    }

    const mappedCalls = calls.map(call => ({
      ...mapCallRecord(call, apiBaseUrl, prisma, request, false, profile),
      application: applicationByCall.get(call.id) ?? null,
    }));

    return {
      data: mappedCalls,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // 2. GET /api/v1/calls/export.csv — Export all matching calls to CSV
  fastify.get<{
    Querystring: {
      phone?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      buyerId?: string;
      publisherId?: string;
      campaignId?: string;
      disputeStatus?: string;
      listId?: string;
      agentId?: string;
      disposition?: string;
      outcome?: string;
      hasRecording?: string;
      billable?: string;
    };
  }>('/api/v1/calls/export.csv', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const startDate = request.query.startDate;
    const endDate = request.query.endDate;

    if (startDate) {
      const parsed = new Date(startDate);
      if (isNaN(parsed.getTime())) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid startDate format' } };
      }
    }

    if (endDate) {
      const parsed = new Date(endDate);
      if (isNaN(parsed.getTime())) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid endDate format' } };
      }
    }

    if (startDate && endDate) {
      if (new Date(startDate) > new Date(endDate)) {
        void reply.code(400);
        return {
          error: { code: 'VALIDATION_ERROR', message: 'startDate cannot be after endDate' },
        };
      }
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const profile = await getUserProfile(request, prisma);

    let listPhoneNumbers: string[] | undefined = undefined;
    if (request.query.listId && request.query.listId !== 'all') {
      const leads = await prisma.insuranceLead.findMany({
        where: { tenantId, listId: request.query.listId },
        select: { phone: true },
      });
      listPhoneNumbers = leads.map(l => l.phone);
    }

    const where = buildCallWhere({
      tenantId,
      isAdminOrOwner: profile.isAdminOrOwner,
      userId: user?.userId,
      search: request.query.search,
      phone: request.query.phone,
      startDate,
      endDate,
      buyerId: profile.isAdminOrOwner ? request.query.buyerId : profile.buyerId,
      publisherId: profile.isAdminOrOwner ? request.query.publisherId : profile.publisherId,
      campaignId: request.query.campaignId,
      disputeStatus: request.query.disputeStatus,
      listPhoneNumbers,
      /*
       * Only a principal may name an agent. For anybody else the parameter is
       * dropped rather than refused: their list is already their own calls,
       * and a 400 on a stray query parameter would break a bookmarked link
       * shared from a principal's screen for no gain.
       */
      agentId: profile.isAdminOrOwner ? request.query.agentId : undefined,
      disposition: request.query.disposition,
      outcome: request.query.outcome,
      hasRecording: request.query.hasRecording,
      billable: request.query.billable,
    });

    const apiBaseUrl = getPublicApiBaseUrl(request);

    /*
     * Who the call was bought and sold by, where it went, and whether money
     * moved on it are the agency's commercial book. They are OWNER/ADMIN
     * columns; a buyer, publisher or agent export leaves them out entirely
     * rather than shipping them blank.
     */
    const commercialColumns = profile.isAdminOrOwner;

    const headers = [
      'Time',
      'Call ID',
      'Call SID',
      ...(commercialColumns ? ['Publisher', 'Buyer'] : []),
      'Campaign',
      'Caller ID (From)',
      'DID (DNIS)',
      ...(commercialColumns ? ['Destination (To)'] : []),
      'Duration',
      'Connected Duration',
      'Billable',
      'Agent',
      'Disposition',
      'Disposition Notes',
      'Source',
      ...(commercialColumns ? ['Buyer Charge Status', 'Publisher Payout Status'] : []),
      'Dispute Status',
      'Recording',
    ];

    if (profile.isAdminOrOwner) {
      headers.push('Revenue', 'Payout', 'Cost', 'Profit', 'Margin');
    } else if (profile.userRoles?.includes('BUYER')) {
      headers.push('Revenue');
    } else if (profile.userRoles?.includes('PUBLISHER')) {
      headers.push('Payout');
    }

    const batchSize = 1000;
    let offset = 0;
    let hasMore = true;
    const allRows: string[][] = [];

    while (hasMore) {
      const batch = await prisma.call.findMany({
        where,
        skip: offset,
        take: batchSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          campaign: true,
          fromNumber: true,
          publisher: true,
          buyer: true,
          createdBy: { select: { firstName: true, lastName: true } },
          recordings: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      await attachAnsweredBy(batch, prisma, tenantId);

      const mappedBatch = batch.map(call => {
        const mapped = mapCallRecord(call, apiBaseUrl, prisma, request, true, profile);

        const row = [
          mapped.createdAt,
          mapped.id,
          mapped.callSid || '',
          ...(commercialColumns ? [mapped.publisherName || '', mapped.buyerName || ''] : []),
          mapped.campaignName || '',
          mapped.callerId || '',
          mapped.did || '',
          ...(commercialColumns ? [mapped.toNumber || mapped.targetNumber || ''] : []),
          mapped.duration ? formatDuration(mapped.duration) : '0:00',
          mapped.connectedDuration ? formatDuration(mapped.connectedDuration) : '0:00',
          mapped.billable ? 'Y' : 'N',
          /*
           * Named, not blank. An empty cell in a spreadsheet reads as "no
           * agent", which is a claim about the call; this is a claim about
           * what we recorded, and the two are worth telling apart when
           * somebody sorts the export by this column.
           */
          mapped.agentName || 'Unattributed',
          mapped.disposition || '',
          mapped.dispositionNotes || '',
          mapped.callSource || '',
          ...(commercialColumns
            ? [mapped.buyerChargeStatus || '', mapped.publisherPayoutStatus || '']
            : []),
          mapped.disputeStatus || '',
          /*
           * A link to the call in the app, never to the audio. The stream URL
           * used to be written here with a 7-day login token on the end, so
           * every exported spreadsheet was a working login. The call page
           * plays the recording to whoever signs in and may hear it.
           */
          mapped.recordingUrl ? `${appUrl()}/calls?call=${encodeURIComponent(mapped.id)}` : '',
        ];

        if (profile.isAdminOrOwner) {
          row.push(
            mapped.revenue !== null ? Number(mapped.revenue).toFixed(2) : '0.00',
            mapped.payout !== null ? Number(mapped.payout).toFixed(2) : '0.00',
            mapped.cost !== null ? Number(mapped.cost).toFixed(2) : '0.00',
            mapped.profit !== null ? Number(mapped.profit).toFixed(2) : '0.00',
            mapped.margin !== null ? Number(mapped.margin).toFixed(2) + '%' : '0.00%'
          );
        } else if (profile.userRoles?.includes('BUYER')) {
          row.push(mapped.revenue !== null ? Number(mapped.revenue).toFixed(2) : '0.00');
        } else if (profile.userRoles?.includes('PUBLISHER')) {
          row.push(mapped.payout !== null ? Number(mapped.payout).toFixed(2) : '0.00');
        }

        return row;
      });

      allRows.push(...mappedBatch);

      offset += batch.length;
      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    const csvContent = [
      headers.join(','),
      ...allRows.map(row => row.map(cell => csvEscape(cell)).join(',')),
    ].join('\n');

    const dateStr = new Date().toISOString().slice(0, 10);
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="call-logs-${dateStr}.csv"`);
    return reply.send(csvContent);
  });

  fastify.post('/api/v1/calls', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const body = request.body as {
      estimatedMinutes?: number;
      estimatedCost?: number;
      toNumber?: string;
    };
    const { quotaService } = await import('../services/quota-service.js');

    // Check concurrent calls quota
    const overrideToken = request.headers['x-quota-override'] as string | undefined;
    const concurrentCheck = await quotaService.checkConcurrentCalls(tenantId, overrideToken);
    if (!concurrentCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: concurrentCheck.reason || 'Concurrent call limit exceeded',
          current: concurrentCheck.current,
          limit: concurrentCheck.limit,
        },
      };
    }

    // Check daily minutes quota
    const estimatedMinutes = body.estimatedMinutes || 1;
    const minutesCheck = await quotaService.checkDailyMinutes(
      tenantId,
      estimatedMinutes,
      overrideToken
    );
    if (!minutesCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: minutesCheck.reason || 'Daily minute limit exceeded',
          current: minutesCheck.current,
          limit: minutesCheck.limit,
        },
      };
    }

    // Check budget
    const estimatedCost = body.estimatedCost || 0;
    const budgetCheck = await quotaService.checkBudget(tenantId, estimatedCost, overrideToken);
    if (!budgetCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'BUDGET_EXCEEDED',
          message: budgetCheck.reason || 'Budget limit exceeded',
          current: budgetCheck.current,
          limit: budgetCheck.limit,
        },
      };
    }

    // Create call (placeholder - implement actual call creation)
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: tenantId,
      toNumber: body.toNumber || '+15551234567',
      callSid: `call_${Date.now()}`,
      status: 'INITIATED',
      direction: 'OUTBOUND',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      quota: {
        concurrentCalls: concurrentCheck,
        dailyMinutes: minutesCheck,
        budget: budgetCheck,
      },
    };
  });

  fastify.get<{ Params: { callId: string } }>('/api/v1/calls/:callId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { callId } = request.params;

    const call = await prisma.call.findFirst({
      where: {
        id: callId,
        tenantId,
      },
      include: {
        campaign: true,
        fromNumber: true,
        publisher: true,
        buyer: true,
        recordings: true,
        transcriptions: true,
        cdrs: true,
        legs: true,
        accruals: {
          include: {
            billingAccount: true,
          },
        },
        buyerTransactions: true,
      },
    });

    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    const profile = await getUserProfile(request, prisma);

    if (!mayReadCall(profile, call, user?.userId)) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access denied to this call' } };
    }

    await attachAnsweredBy([call], prisma, tenantId);

    const mapped = mapCallRecord(
      call,
      getPublicApiBaseUrl(request),
      prisma,
      request,
      true,
      profile
    );

    /*
     * The matching PingRequest, for NetEnroll staff only.
     *
     * It carries every bid on the call -- each buyer's name and price -- which
     * is the marketplace's book, not any one agency's. Nobody else is shown it.
     */
    let pingRequest = null;
    if (isPlatformAdminRequest(request) && call.did && call.callerId) {
      pingRequest = await prisma.pingRequest.findFirst({
        where: {
          assignedPhoneNumber: { number: call.did, tenantId },
          callerNumber: call.callerId,
        },
        include: {
          bids: {
            include: {
              buyer: true,
            },
          },
        },
      });
    }

    // Role-scoped visibility for relations:
    let accruals = null;
    let cdrs = null;
    let buyerTransactions = null;

    if (profile.isAdminOrOwner) {
      accruals = call.accruals;
      cdrs = call.cdrs;
      buyerTransactions = call.buyerTransactions;
    } else if (profile.userRoles?.includes('BUYER')) {
      buyerTransactions = call.buyerTransactions;
    }

    /*
     * Whether this call already carries a sale.
     *
     * The screen needs it to decide what to ask for when somebody changes the
     * disposition: a call with no application on it needs the five fields, a
     * call that already has one must not be asked for a second -- that would
     * spend a second credit for one piece of business. Non-voided, because a
     * voided application is not one and the measurement drops it.
     */
    const submittedApplication = await prisma.insuranceCarrierApplication.findFirst({
      where: { tenantId, callId, submittedAt: { not: null }, voidedAt: null },
      select: { id: true, carrier: true, firstName: true, lastName: true },
    });

    return {
      ...mapped,
      hasSubmittedApplication: submittedApplication !== null,
      submittedApplication,
      legs: call.legs,
      recordings: mapped.recordingUrl ? call.recordings : [],
      transcriptions: mapped.recordingUrl ? call.transcriptions : [],
      pingRequest,
      accruals,
      cdrs,
      buyerTransactions,
    };
  });

  // ── Recording Status POST — Update recording lifecycle state ──
  fastify.post<{
    Params: { callId: string };
    Body: {
      status: 'started' | 'recording' | 'stopped' | 'processing' | 'ready' | 'error' | 'failed';
      error?: string;
    };
  }>('/api/v1/calls/:callId/recording-status', async (request, reply) => {
    // This endpoint writes to a Call. It had no tenant concept at all: it took
    // a callId, fetched that row by primary key from anywhere in the database,
    // and wrote to it. The /api/v1 hook populates `request.user` but never
    // refuses a request, so an anonymous caller who guessed or scraped a call
    // id could set another agency's recording state to `error`.
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const { callId } = request.params;
    const { status, error: errorMsg } = request.body || {};

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Check if call exists first
    const call = await prisma.call.findFirst({
      where: { id: callId, tenantId },
    });

    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    const updateData: Record<string, any> = {};
    const now = new Date();

    switch (status) {
      case 'started':
      case 'recording':
        updateData.recordingStatus = 'RECORDING';
        if (!call.recordingStartedAt) {
          updateData.recordingStartedAt = now;
        }
        break;
      case 'stopped':
      case 'processing':
        updateData.recordingStatus = 'PROCESSING';
        updateData.recordingError = null;
        break;
      case 'ready':
        // only set READY if recordingUrl or primaryRecordingId exists
        if (!call.recordingUrl && !call.primaryRecordingId) {
          void reply.code(400);
          return {
            error: {
              code: 'INVALID_STATE',
              message:
                'Cannot set status to READY without a playable recordingUrl or primaryRecordingId',
            },
          };
        }
        updateData.recordingStatus = 'READY';
        break;
      case 'error':
      case 'failed':
        updateData.recordingStatus = 'FAILED';
        updateData.recordingError = errorMsg || 'Recording failed';
        updateData.recordingCompletedAt = now;

        // Try to parse HTTP code from the error message if it's there
        let uploadHttpCode: number | null = null;
        if (errorMsg) {
          const match = errorMsg.match(/HTTP (\d+)/);
          if (match) {
            uploadHttpCode = parseInt(match[1], 10);
          }
        }
        const callMetadata = (call.metadata as any) || {};
        const existingRecordingDebug = callMetadata.recordingDebug || {};
        updateData.metadata = {
          ...callMetadata,
          recordingDebug: {
            ...existingRecordingDebug,
            uploadAttemptedAt: now.toISOString(),
            uploadHttpCode,
            uploadError: errorMsg || 'Recording failed',
          },
        };
        break;
      default:
        void reply.code(400);
        return {
          error: { code: 'INVALID_STATUS', message: `Unknown status: ${status as string}` },
        };
    }

    try {
      // `updateMany` rather than `update`: the where clause carries the tenant,
      // and `update` will not accept a non-unique filter.
      await prisma.call.updateMany({
        where: { id: callId, tenantId },
        data: updateData,
      });
      const updatedCall = await prisma.call.findFirst({
        where: { id: callId, tenantId },
        select: { recordingStatus: true },
      });

      return {
        success: true,
        callId,
        recordingStatus: updatedCall?.recordingStatus ?? null,
      };
    } catch (err) {
      request.log.error({ error: err, callId }, 'Failed to update recording status');
      void reply.code(500);
      return { error: { code: 'UPDATE_FAILED', message: 'Failed to update recording status' } };
    }
  });

  // ── Recording Debug GET — Debug pipeline issues for a single call ──
  fastify.get<{ Params: { callId: string } }>(
    '/api/v1/calls/:callId/recording-debug',
    async (request, reply) => {
      // Same hole as recording-status above, on the read side: this returns a
      // call's metadata and its recording rows, and used to do so for any call
      // id in the database, to any caller.
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const { callId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const call = await prisma.call.findFirst({
        where: { id: callId, tenantId },
        include: {
          recordings: true,
        },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
      }

      // Determine storage type
      const storageType = process.env.S3_BUCKET ? 'S3' : 'local';

      const fs = await import('fs');
      const path = await import('path');
      const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';

      const wavPath = `/recordings/${callId}.wav`;
      const tmpWavPath = `/tmp/recordings/${callId}.wav`;

      const apiRecordingsWavExists = fs.existsSync(wavPath);
      let apiRecordingsWavSize: string | null = null;
      if (apiRecordingsWavExists) {
        try {
          apiRecordingsWavSize = fs.statSync(wavPath).size.toString();
        } catch {}
      }

      const apiTmpRecordingsWavExists = fs.existsSync(tmpWavPath);
      let apiTmpRecordingsWavSize: string | null = null;
      if (apiTmpRecordingsWavExists) {
        try {
          apiTmpRecordingsWavSize = fs.statSync(tmpWavPath).size.toString();
        } catch {}
      }

      const recordingsWithFileCheck = call.recordings.map(r => {
        let fileExists: boolean | null = null;
        if (storageType === 'local' && r.storageKey) {
          const localFilePath = path.join(localDir, r.storageKey);
          fileExists = fs.existsSync(localFilePath);
        }
        return {
          id: r.id,
          callId: r.callId,
          legId: r.legId,
          url: r.url,
          storageKey: r.storageKey,
          format: r.format,
          size: r.size?.toString(),
          status: r.status,
          createdAt: r.createdAt,
          fileExists,
        };
      });

      return {
        call: {
          id: call.id,
          callSid: call.callSid,
          status: call.status,
          recordingStatus: call.recordingStatus,
          recordingUrl: call.recordingUrl,
          primaryRecordingId: call.primaryRecordingId,
          recordingError: call.recordingError,
          recordingStartedAt: call.recordingStartedAt,
          recordingCompletedAt: call.recordingCompletedAt,
          externalId: (call as any).externalId ?? null,
          callSource: (call as any).callSource ?? null,
          metadata: call.metadata,
        },
        recordings: recordingsWithFileCheck,
        diagnostics: {
          apiRecordingsWavExists,
          apiRecordingsWavSize,
          apiTmpRecordingsWavExists,
          apiTmpRecordingsWavSize,
        },
        storage: {
          type: storageType,
          bucket: process.env.S3_BUCKET || null,
          endpoint: process.env.S3_ENDPOINT || null,
          localStorageDir: localDir,
        },
      };
    }
  );

  async function propagateLeadDisposition(
    tenantId: string,
    disposition: string,
    phoneVal?: string | null,
    notesVal?: string | null
  ) {
    if (!phoneVal) return;
    const clean = phoneVal.replace(/\D/g, '');
    const last10 = clean.length >= 10 ? clean.slice(-10) : clean;
    if (last10.length < 10) return;

    try {
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const { updateLead } = await import('../services/insurance-lead-service.js');

      // Find matching leads
      const leads = await prisma.insuranceLead.findMany({
        where: {
          tenantId,
          phone: { endsWith: last10 },
        },
      });

      let leadStatus: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST' = 'NEW';
      if (disposition === 'APPLICATION_SUBMITTED' || disposition === 'LIVE_TRANSFER') {
        leadStatus = 'CONVERTED';
      } else if (['SET_APPOINTMENT', 'SET_CALLBACK', 'FOLLOW_UP'].includes(disposition)) {
        leadStatus = 'CONTACTED';
      } else if (
        ['NOT_INTERESTED', 'NOT_QUALIFIED', 'WRONG_NUMBER', 'DISCONNECTED'].includes(disposition)
      ) {
        leadStatus = 'LOST';
      } else if (disposition === 'NO_ANSWER') {
        leadStatus = 'NEW';
      }

      for (const lead of leads) {
        const updates: Record<string, any> = {
          status: leadStatus,
          lastContactedAt: new Date(),
        };
        if (notesVal) {
          updates.notes = lead.notes
            ? `${lead.notes}\n[Call Note - ${new Date().toLocaleDateString()}]: ${notesVal}`
            : notesVal;
        }
        await updateLead(tenantId, lead.id, updates);
      }
    } catch (err) {
      console.error('[Disposition Propagation] Failed to update insurance lead:', err);
    }
  }

  // ── Disposition POST — Save/update disposition for a call ──
  const VALID_DISPOSITIONS = [
    'NO_ANSWER',
    'DISCONNECTED',
    'NOT_INTERESTED',
    'NOT_QUALIFIED',
    'NO_MEMORY_CONFUSED',
    'WRONG_NUMBER',
    'VERIFIED',
    'FOLLOW_UP',
    'LIVE_TRANSFER',
    'SET_APPOINTMENT',
    'SET_CALLBACK',
    'APPLICATION_SUBMITTED',
  ];
  const VALID_CALL_SOURCES = ['CALL_CENTER', 'SOFTPHONE', 'AI_VOICE'];
  const VALID_FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'];

  /**
   * The dispositions that are a claim about business written, and so cannot be
   * saved on their own.
   *
   * `APPLICATION_SUBMITTED` is not a note an agent leaves on a call. It is the
   * numerator of the closing percentage that prices the agency, and it spends a
   * credit off their balance. Until this endpoint carried the application, the
   * two were separate requests -- disposition first, because the client only
   * has a browser session id and this endpoint is what resolves it to a `Call`
   * row, then the application with the id that came back. Any failure between
   * them left a call LABELLED as a sale with no sale behind it: nothing in the
   * numerator, no credit spent, and an agency whose measured closing percentage
   * was lower than its real one -- which on the rate curve is a HIGHER price
   * per application. The agent saw "saved".
   *
   * One request now. The application is recorded against the resolved call
   * BEFORE the disposition is written, so the label cannot exist without the
   * sale. If the application is refused, so is the disposition.
   */
  const DISPOSITIONS_REQUIRING_APPLICATION = new Set(['APPLICATION_SUBMITTED']);

  fastify.post<{
    Body: {
      callId?: string;
      callSid?: string;
      disposition: string;
      notes?: string;
      duration?: number;
      callerNumber?: string;
      callSource?: string;
      direction?: string;
      followUpAt?: string;
      /**
       * The business the agent wrote. Required when `disposition` is one of
       * `DISPOSITIONS_REQUIRING_APPLICATION`, refused otherwise -- an
       * application attached to "not interested" is a contradiction, and
       * silently recording it would put a sale in the numerator that the agent
       * never claimed.
       */
      application?: unknown;
    };
  }>('/api/v1/calls/disposition', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const {
      callId,
      callSid,
      disposition,
      notes,
      duration,
      callerNumber,
      callSource,
      direction,
      followUpAt,
      application,
    } = request.body;

    // Validate disposition
    if (!disposition || !VALID_DISPOSITIONS.includes(disposition)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_DISPOSITION',
          message: `Disposition must be one of: ${VALID_DISPOSITIONS.join(', ')}`,
        },
      };
    }

    // Validate callSource if provided
    if (callSource && !VALID_CALL_SOURCES.includes(callSource)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_CALL_SOURCE',
          message: `Call source must be one of: ${VALID_CALL_SOURCES.join(', ')}`,
        },
      };
    }

    /*
     * The application, validated before anything is written.
     *
     * Required and refused are both enforced here rather than trusted to the
     * screen. The two disposition screens already refuse to save without a
     * complete form -- but a guard that lives only in a browser is a guard an
     * integration, a script, or the next screen somebody builds does not have,
     * and what it protects is the number the agency is priced on.
     */
    const requiresApplication = DISPOSITIONS_REQUIRING_APPLICATION.has(disposition);

    let applicationInput: ApplicationInput | null = null;
    if (requiresApplication) {
      if (application === undefined || application === null) {
        void reply.code(400);
        return {
          error: {
            code: 'APPLICATION_REQUIRED',
            message:
              'Recording an application submitted needs the application: carrier, face amount, ' +
              'premium, first name and last name.',
          },
        };
      }

      const parsed = ApplicationInputSchema.safeParse(application);
      if (!parsed.success) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: describeApplicationIssues(parsed.error),
          },
        };
      }
      applicationInput = parsed.data;
    } else if (application !== undefined && application !== null) {
      /*
       * An application on any other disposition. Refused rather than ignored:
       * quietly dropping it loses business the agent believed they recorded,
       * and quietly recording it puts a sale in the numerator against a call
       * the agent marked "not interested".
       */
      void reply.code(400);
      return {
        error: {
          code: 'APPLICATION_NOT_EXPECTED',
          message: `An application can only be recorded with: ${[...DISPOSITIONS_REQUIRING_APPLICATION].join(', ')}`,
        },
      };
    }

    if (requiresApplication && !user?.userId) {
      /*
       * An application is attributed to the agent who wrote it -- that is what
       * the per-agent production table reads. There is no such thing as one
       * written by nobody.
       */
      void reply.code(401);
      return {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Recording an application requires a signed-in agent',
        },
      };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    /**
     * Record the business, against the call we have just resolved.
     *
     * Called BEFORE the disposition is written, every time, so that a refused
     * application refuses the disposition with it. The alternative -- write the
     * label, then try the sale -- is what this endpoint used to do across two
     * requests, and it is how a call ends up marked as a sale that the closing
     * percentage never counted.
     *
     * `clientRequestId` makes it idempotent: an agent whose save timed out
     * after the row landed presses the button again, the unique index turns the
     * second write into a P2002, and `recordAgentApplication` answers with the
     * row that already exists rather than charging a second credit.
     */
    // Bound here so the helper below closes over a narrowed value rather than
    // the nullable one `getActingTenantId` returns.
    const actingTenantId: string = tenantId;

    async function recordTheApplication(
      resolvedCallId: string
    ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
      if (!applicationInput || !user?.userId) return { ok: true };
      try {
        await recordAgentApplication({
          tenantId: actingTenantId,
          createdById: user.userId,
          clientRequestId: applicationInput.clientRequestId,
          callId: resolvedCallId,
          insuranceLeadId: applicationInput.insuranceLeadId ?? null,
          carrier: applicationInput.carrier,
          product: applicationInput.product ?? null,
          planType: applicationInput.planType ?? null,
          faceAmount: applicationInput.faceAmount,
          modalPremium: applicationInput.modalPremium,
          paymentMode: applicationInput.paymentMode,
          carrierApplicationNumber: applicationInput.carrierApplicationNumber ?? null,
          firstName: applicationInput.firstName,
          lastName: applicationInput.lastName,
          dob: applicationInput.dob ?? null,
          state: applicationInput.state ?? null,
          phone: applicationInput.phone ?? null,
        });
        return { ok: true };
      } catch (err) {
        /*
         * A call id this agent cannot claim. `attributeCall` refuses rather
         * than downgrading, because a wrong link on the figure that sets an
         * agency's price is worse than no link -- see `call-attribution.ts`.
         */
        if (err instanceof UnknownCallError) {
          return {
            ok: false,
            status: 409,
            code: 'CALL_NOT_ATTRIBUTABLE',
            message: "That call is not this agent's to record an application against.",
          };
        }
        request.log.error(
          { err, tenantId: actingTenantId, callId: resolvedCallId },
          'Application record failed'
        );
        return {
          ok: false,
          status: 500,
          code: 'APPLICATION_NOT_RECORDED',
          message:
            'The application could not be recorded, so the call has not been marked as a sale. Try again.',
        };
      }
    }

    /*
     * The softphone names an inbound call by the id FreeSWITCH gave it --
     * `fs-<uuid>`, from the INVITE's X-Call-Id -- which is the callSid the CDR
     * writes the call under. It may arrive in either field.
     */
    const softphoneSid = isSoftphoneCallSid(callSid)
      ? callSid
      : isSoftphoneCallSid(callId)
        ? callId
        : null;
    const lookupSid = callSid || softphoneSid;

    // Find the call by callId or callSid (idempotent — supports repeated saves)
    let call = null;
    if (callId && !isSoftphoneCallSid(callId)) {
      call = await prisma.call.findFirst({
        where: { id: callId, tenantId },
      });
    }
    if (!call && lookupSid) {
      call = await prisma.call.findFirst({
        where: { callSid: lookupSid, tenantId },
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      disposition,
      dispositionNotes: notes || null,
    };
    if (callSource) updateData.callSource = callSource;
    if (duration !== undefined) updateData.duration = duration;
    if (followUpAt) {
      updateData.followUpAt = new Date(followUpAt);
      updateData.followUpStatus = 'PENDING';
    }

    if (call) {
      const finalEndedAt = call.endedAt || new Date();
      let finalDuration = call.duration;
      if (
        duration !== undefined &&
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration >= 0
      ) {
        finalDuration = duration;
      } else if (finalDuration === null || finalDuration === undefined) {
        finalDuration = 0;
      }

      const recordingStatusUpdate: Record<string, unknown> = {};
      if (call.recordingStatus === 'RECORDING') {
        recordingStatusUpdate.recordingStatus = 'PROCESSING';
      } else if (call.recordingStatus === 'PENDING') {
        if (!call.answeredAt) {
          recordingStatusUpdate.recordingStatus = 'FAILED';
          recordingStatusUpdate.recordingError = 'Call was not answered, no recording generated.';
        } else {
          recordingStatusUpdate.recordingStatus = 'PROCESSING';
        }
      }

      /*
       * Who took this call, when nothing else recorded it.
       *
       * `answeredByUserId` had exactly one writer: the softphone answer
       * handler in `routes/agent-phone.ts`. Every other way a call reaches a
       * disposition -- the call-centre console, a click-to-dial that was never
       * answered through that endpoint, a row this very request is about to
       * create -- left it null. Those calls then read as UNATTRIBUTED in the
       * per-agent table the agency principal coaches from, and showed no agent
       * at all on the call ledger.
       *
       * The person saving a disposition is the person who handled the call, so
       * they are the honest answer when there is no better one.
       *
       * ONLY WHEN IT IS NULL. This endpoint is idempotent and is re-called on
       * repeated saves; a supervisor or a later correction must never be able
       * to take a call off the agent who actually answered it. An existing
       * attribution is a fact from the answer handler and outranks this guess.
       *
       * This does not move any money. A delivered call is INBOUND, not blocked,
       * with `answeredAt` in the window -- see `rating/measurement.ts` -- and
       * none of those three are touched here. What changes is which agent a
       * call already in the agency's total is credited to: a delivered call
       * that read as unattributed now names somebody. The agency total is the
       * same number either way, which is the property that lets the per-agent
       * table reconcile with it.
       */
      const attribution =
        call.answeredByUserId === null && user?.userId ? { answeredByUserId: user.userId } : {};

      /*
       * The sale, before the label. A refused application leaves this call
       * exactly as it was -- no disposition written, nothing marked saved --
       * rather than a call reading "application submitted" with nothing in the
       * numerator behind it.
       */
      const recorded = await recordTheApplication(call.id);
      if (!recorded.ok) {
        void reply.code(recorded.status);
        return { error: { code: recorded.code, message: recorded.message } };
      }

      /*
       * A row the FreeSWITCH CDR wrote (`fs-<uuid>`) already holds what the
       * switch measured -- status, times, durations -- and billing has been
       * calculated from them. The disposition labels that call; it does not
       * get to re-time it from the browser's clock.
       */
      const cdrOwned = isSoftphoneCallSid(call.callSid);
      const { duration: _clientDuration, ...labelData } = updateData;

      // Update existing call record (idempotent upsert pattern)
      const updated = await prisma.call.update({
        where: { id: call.id },
        data: cdrOwned
          ? { ...labelData, ...attribution }
          : {
              ...updateData,
              ...attribution,
              status: 'COMPLETED',
              endedAt: finalEndedAt,
              duration: finalDuration,
              connectedDuration: call.answeredAt ? finalDuration : 0,
              ...recordingStatusUpdate,
            },
      });

      const rawPhone = callerNumber || call.toNumber || call.callerId;
      if (rawPhone) {
        await propagateLeadDisposition(tenantId, disposition, rawPhone, notes);
      }

      return {
        id: updated.id,
        callSid: updated.callSid,
        disposition: updated.disposition,
        dispositionNotes: updated.dispositionNotes,
        callSource: updated.callSource,
        followUpAt: updated.followUpAt?.toISOString() ?? null,
        followUpStatus: updated.followUpStatus,
        updatedAt: updated.updatedAt.toISOString(),
      };
    } else if (softphoneSid) {
      /*
       * A softphone call whose CDR has not landed yet. Its row will be written
       * by the CDR under this same callSid, so creating one here would make a
       * second INBOUND row for the one call -- which is exactly what used to
       * happen. The disposition waits instead, and the CDR merges it (and
       * records the application, if there is one) when it arrives.
       */
      const pending = await savePendingDisposition(prisma, {
        tenantId,
        callSid: softphoneSid,
        userId: user?.userId ?? null,
        disposition,
        notes: notes || null,
        callSource: callSource || null,
        followUpAt: followUpAt ? new Date(followUpAt) : null,
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
        application: applicationInput,
      });

      if (callerNumber) {
        await propagateLeadDisposition(tenantId, disposition, callerNumber, notes);
      }

      void reply.code(202);
      return {
        id: null,
        pending: true,
        callSid: pending.callSid,
        disposition: pending.disposition,
        dispositionNotes: pending.notes,
        callSource: pending.callSource,
        followUpAt: pending.followUpAt?.toISOString() ?? null,
        followUpStatus: pending.followUpAt ? 'PENDING' : null,
        updatedAt: pending.updatedAt.toISOString(),
      };
    } else {
      // Create a new call record if none exists (e.g. softphone call not yet tracked)
      // Use actual direction from the payload instead of hardcoding OUTBOUND
      const callDirection = direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
      /*
       * The call was never tracked, so the row is created in two steps when an
       * application rides along: bare first, then the application against it,
       * then the disposition. A single create carrying the disposition would
       * write the label before the sale existed, and a failure after it would
       * leave the same orphan this endpoint was changed to make impossible.
       */
      const dispositionFields = requiresApplication ? {} : { ...updateData };

      const newCall = await prisma.call.create({
        data: {
          tenantId,
          callSid: callSid || `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          toNumber: callerNumber || 'unknown',
          status: 'COMPLETED',
          direction: callDirection,
          createdById: user?.userId || null,
          /*
           * `createdById` alone is not attribution. It is written here and
           * nowhere else on an inbound call, and the per-agent table groups by
           * `answeredByUserId` -- so a row created by a disposition save used
           * to count for nobody: the agent who made the call and wrote it up
           * did not see it in their own figures, and their agency's per-agent
           * total did not reconcile with its agency total.
           *
           * There is no ambiguity on this path: the row exists BECAUSE this
           * agent dispositioned a call no other record covers.
           *
           * `answeredAt` is deliberately NOT set here, and must not be. It is
           * what `rating/measurement.ts` counts to bill the agency for a
           * delivered call, and this endpoint is reachable by any agent: a
           * disposition save that stamped it would let the floor mint billable
           * delivered calls by writing calls up. This column says who handled
           * the call; it never says the call was delivered.
           */
          answeredByUserId: user?.userId || null,
          ...dispositionFields,
        },
      });

      if (requiresApplication) {
        const recorded = await recordTheApplication(newCall.id);
        if (!recorded.ok) {
          void reply.code(recorded.status);
          return { error: { code: recorded.code, message: recorded.message } };
        }
        /*
         * Only now is the call a sale. The row already exists and carries the
         * agent and the number; what it did not carry until this line is the
         * claim that business came off it.
         */
        await prisma.call.update({ where: { id: newCall.id }, data: updateData });
        Object.assign(newCall, updateData);
      }

      const rawPhone = callerNumber || newCall.toNumber || newCall.callerId;
      if (rawPhone) {
        await propagateLeadDisposition(tenantId, disposition, rawPhone, notes);
      }

      void reply.code(201);
      return {
        id: newCall.id,
        callSid: newCall.callSid,
        disposition: newCall.disposition,
        dispositionNotes: newCall.dispositionNotes,
        callSource: newCall.callSource,
        followUpAt: newCall.followUpAt?.toISOString() ?? null,
        followUpStatus: newCall.followUpStatus,
        createdAt: newCall.createdAt.toISOString(),
      };
    }
  });

  /**
   * PATCH /api/v1/calls/:callId/disposition — write the call up afterwards.
   *
   * ── The follow-up, which is most of the business ────────────────────────────
   *
   * An agent takes the call today and the customer signs on Thursday. Nothing
   * about that is unusual -- it is how final expense is sold -- and when it
   * happens the agent comes back into the call log, opens the same customer,
   * and dispositions the call as "application submitted" then. That is a SALE,
   * on exactly the same terms as one written on the call itself.
   *
   * This route used to REFUSE that. It checked for an application and returned
   * 409 when there was none, on the reasoning that a correction path should not
   * be able to invent business. The reasoning was sound; the premise was wrong.
   * The agent is not correcting a write-up, they are writing the sale up for the
   * first time, days later, and the only door they have is this one. Refusing
   * it meant the business was never counted -- which understates the closing
   * percentage, and a lower closing percentage is a HIGHER price per
   * application. The guard charged the agency for its own sales.
   *
   * So it takes the application, exactly as `POST /api/v1/calls/disposition`
   * does, records it against this call, and only then writes the disposition.
   * Same order, same guarantee: the label cannot exist without the sale.
   */
  fastify.patch<{
    Params: { callId: string };
    Body: {
      disposition?: string;
      notes?: string;
      followUpAt?: string;
      followUpStatus?: string;
      /** Required with `APPLICATION_SUBMITTED`, unless one is already on the call. */
      application?: unknown;
    };
  }>('/api/v1/calls/:callId/disposition', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { callId } = request.params;
    const { disposition, notes, followUpAt, followUpStatus, application } = request.body;

    if (disposition && !VALID_DISPOSITIONS.includes(disposition)) {
      void reply.code(400);
      return { error: { code: 'INVALID_DISPOSITION', message: `Invalid disposition value` } };
    }

    if (followUpStatus && !VALID_FOLLOW_UP_STATUSES.includes(followUpStatus)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_STATUS',
          message: `Follow-up status must be one of: ${VALID_FOLLOW_UP_STATUSES.join(', ')}`,
        },
      };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const call = await prisma.call.findFirst({ where: { id: callId, tenantId } });
    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    /*
     * Who may write this call up.
     *
     * The same rule as reading it (`mayReadCall`), minus the counterparties: a
     * buyer or publisher may see their own traffic but a disposition is the
     * agency's record of what its agent did, and is not theirs to change. This
     * route had no check at all past the tenant, so any agent could rewrite a
     * colleague's disposition -- and with it their closing figures -- by id.
     */
    const profile = await getUserProfile(request, prisma);
    if (!profile.isAdminOrOwner) {
      const isCounterparty =
        profile.userRoles?.includes('BUYER') || profile.userRoles?.includes('PUBLISHER');
      if (isCounterparty || !mayReadCall(profile, call, user?.userId)) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this call' } };
      }
    }

    /*
     * Marking this call a sale, days after it happened.
     *
     * The application is required, in the same shape and on the same terms as
     * the live path -- unless one is ALREADY on the call, which is the genuine
     * correction case: an agent who dispositioned it wrong, fixed it to
     * something else, and is now putting it back. That business is already
     * counted and must not be counted twice.
     */
    if (disposition !== undefined && DISPOSITIONS_REQUIRING_APPLICATION.has(disposition)) {
      const existing = await prisma.insuranceCarrierApplication.findFirst({
        where: {
          tenantId,
          callId,
          submittedAt: { not: null },
          // A voided application is not one -- see `rating/measurement.ts`.
          voidedAt: null,
        },
        select: { id: true },
      });

      if (!existing) {
        if (application === undefined || application === null) {
          void reply.code(400);
          return {
            error: {
              code: 'APPLICATION_REQUIRED',
              message:
                'Marking this call an application submitted needs the application: carrier, ' +
                'coverage amount, annual premium, first name and last name.',
            },
          };
        }

        const parsed = ApplicationInputSchema.safeParse(application);
        if (!parsed.success) {
          void reply.code(400);
          return {
            error: { code: 'VALIDATION_ERROR', message: describeApplicationIssues(parsed.error) },
          };
        }

        if (!user?.userId) {
          void reply.code(401);
          return {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Recording an application requires a signed-in agent',
            },
          };
        }

        /*
         * Recorded BEFORE the disposition is written, so a refusal leaves the
         * call exactly as it was rather than reading as a sale with nothing
         * behind it. Same order as the live path, for the same reason.
         */
        try {
          await recordAgentApplication({
            tenantId,
            createdById: user.userId,
            clientRequestId: parsed.data.clientRequestId,
            callId,
            insuranceLeadId: parsed.data.insuranceLeadId ?? null,
            carrier: parsed.data.carrier,
            product: parsed.data.product ?? null,
            planType: parsed.data.planType ?? null,
            faceAmount: parsed.data.faceAmount,
            modalPremium: parsed.data.modalPremium,
            paymentMode: parsed.data.paymentMode,
            carrierApplicationNumber: parsed.data.carrierApplicationNumber ?? null,
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName,
            dob: parsed.data.dob ?? null,
            state: parsed.data.state ?? null,
            phone: parsed.data.phone ?? null,
          });
        } catch (err) {
          if (err instanceof UnknownCallError) {
            void reply.code(409);
            return {
              error: {
                code: 'CALL_NOT_ATTRIBUTABLE',
                message: "That call is not this agent's to record an application against.",
              },
            };
          }
          request.log.error({ err, tenantId, callId }, 'Application record failed');
          void reply.code(500);
          return {
            error: {
              code: 'APPLICATION_NOT_RECORDED',
              message:
                'The application could not be recorded, so the call has not been marked as a sale. Try again.',
            },
          };
        }
      } else if (application !== undefined && application !== null) {
        /*
         * A second application sent for a call that already has one. Refused
         * rather than written: a couple insuring together is two applications
         * and belongs on the live path with its own form instance, and silently
         * adding one here would spend a credit the agent did not intend.
         */
        void reply.code(409);
        return {
          error: {
            code: 'APPLICATION_ALREADY_RECORDED',
            message: 'This call already has a submitted application on it.',
          },
        };
      }
    }

    const updateData: Record<string, unknown> = {};
    if (disposition !== undefined) updateData.disposition = disposition;
    if (notes !== undefined) updateData.dispositionNotes = notes;
    if (followUpAt !== undefined) updateData.followUpAt = followUpAt ? new Date(followUpAt) : null;
    if (followUpStatus !== undefined) updateData.followUpStatus = followUpStatus;

    const updated = await prisma.call.update({
      where: { id: callId },
      data: updateData,
    });

    const rawPhone = call.toNumber || call.callerId;
    if (rawPhone && (disposition !== undefined || notes !== undefined)) {
      await propagateLeadDisposition(
        tenantId,
        disposition !== undefined ? disposition : call.disposition || 'NO_ANSWER',
        rawPhone,
        notes
      );
    }

    return {
      id: updated.id,
      disposition: updated.disposition,
      dispositionNotes: updated.dispositionNotes,
      followUpAt: updated.followUpAt?.toISOString() ?? null,
      followUpStatus: updated.followUpStatus,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  /**
   * POST /api/v1/calls/:callId/dispute
   * Dispute a call connection
   */
  fastify.post<{
    Params: { callId: string };
    Body: { reason: string };
  }>('/api/v1/calls/:callId/dispute', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { callId } = request.params;
    const { reason } = request.body;

    if (!reason || reason.trim() === '') {
      void reply.code(400);
      return { error: { code: 'BAD_REQUEST', message: 'Dispute reason is required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // 1. Fetch user to verify they are buyer and retrieve their buyerId
    const userRecord = await prisma.user.findUnique({
      where: { id: user?.userId },
      include: { roles: { include: { role: true } } },
    });

    if (!userRecord) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'User not found' } };
    }

    const roles = userRecord.roles.map((ur: any) => ur.role.name) || [];
    const isAdminOrOwner = roles.some(role => role === 'ADMIN' || role === 'OWNER');
    const isBuyer = roles.some(role => role === 'BUYER');

    if (!isAdminOrOwner && !isBuyer) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Access denied: Must be buyer or admin to dispute' },
      };
    }

    // 2. Fetch Call and verify owner/buyer scopes
    const call = await prisma.call.findFirst({
      where: { id: callId, tenantId },
    });

    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    if (isBuyer && !isAdminOrOwner) {
      if (!userRecord.buyerId || call.buyerId !== userRecord.buyerId) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'You can only dispute your own calls' } };
      }

      // Check buyer permission canDisputeConversions
      const buyer = await prisma.buyer.findUnique({
        where: { id: userRecord.buyerId },
      });

      if (!buyer || !buyer.canDisputeConversions) {
        void reply.code(403);
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Your buyer account is not permitted to dispute calls',
          },
        };
      }
    }

    /*
     * One dispute per call. A call that already carries one -- open, or
     * decided ACCEPTED or DENIED -- is refused rather than overwritten: a
     * refiled dispute on a DENIED call used to reset it to DISPUTED and erase
     * the decision, and a buyer could keep a denied call in dispute forever.
     */
    const alreadyDisputed = {
      error: {
        code: 'ALREADY_DISPUTED',
        message: 'A dispute has already been filed on this call',
      },
    };
    if (call.disputeStatus !== null) {
      void reply.code(409);
      return alreadyDisputed;
    }

    // 3. Update Call with dispute status and save reason in metadata
    const metadata = (call.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...metadata,
      disputeReason: reason,
      disputedAt: new Date().toISOString(),
      disputedBy: userRecord.email,
    };

    // Conditional on the column still being empty, so two concurrent filings
    // cannot both succeed.
    const { count } = await prisma.call.updateMany({
      where: { id: callId, tenantId, disputeStatus: null },
      data: {
        disputeStatus: 'DISPUTED',
        metadata: updatedMetadata,
      },
    });
    if (count === 0) {
      void reply.code(409);
      return alreadyDisputed;
    }

    return {
      success: true,
      callId,
      disputeStatus: 'DISPUTED',
    };
  });

  /**
   * POST /api/v1/calls/:callId/accept
   *
   * The buyer confirming a call was what they paid for. It records when, in
   * `metadata.acceptedByBuyerAt`, and changes nothing else: the charge already
   * happened when the call crossed its threshold, so `buyerChargeStatus` is
   * left exactly as it is, and the disposition is the agency's record of what
   * its agent did, not the buyer's to write.
   *
   * The buyer portal's Accept button used to POST to the disposition route,
   * which answers PATCH only, so every click 404'd.
   *
   * Only the buyer the call was sold to may accept it. Accepting twice keeps
   * the first time.
   */
  fastify.post<{ Params: { callId: string } }>(
    '/api/v1/calls/:callId/accept',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const profile = await getUserProfile(request, prisma);
      if (!user?.userId || !profile.buyerId) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Only a buyer can accept a call' } };
      }

      const { callId } = request.params;
      const call = await prisma.call.findFirst({
        where: { id: callId, tenantId },
        select: { id: true, buyerId: true, buyerChargeStatus: true, metadata: true },
      });
      if (!call) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
      }
      if (call.buyerId !== profile.buyerId) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'You can only accept your own calls' } };
      }

      const metadata = (call.metadata as Record<string, unknown> | null) ?? {};
      const acceptedByBuyerAt =
        typeof metadata.acceptedByBuyerAt === 'string'
          ? metadata.acceptedByBuyerAt
          : new Date().toISOString();

      if (metadata.acceptedByBuyerAt !== acceptedByBuyerAt) {
        await prisma.call.update({
          where: { id: call.id },
          data: { metadata: { ...metadata, acceptedByBuyerAt } as Prisma.InputJsonValue },
        });
      }

      return {
        success: true,
        callId: call.id,
        acceptedByBuyerAt,
        buyerChargeStatus: call.buyerChargeStatus,
      };
    }
  );

  /**
   * The publisher a portal request is about, or null after answering.
   *
   * 403 when the caller may not see this publisher at all (another publisher's
   * id, or a role with no portal); 404 when the publisher is not the acting
   * tenant's. `requirePublisherAccess` passes an OWNER or ADMIN for ANY id and
   * those roles are per tenant, so the tenant check is what stops an owner of
   * one agency reading another agency's publisher by its id.
   */
  async function portalPublisher(
    request: FastifyRequest<{ Params: { publisherId: string } }>,
    reply: FastifyReply
  ): Promise<{ tenantId: string; publisherId: string } | null> {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      void reply.send(sendTenantRefusal(request, reply));
      return null;
    }

    const { publisherId } = request.params;
    const { requirePublisherAccess } = await import('../middleware/rbac.js');
    if (!requirePublisherAccess((request as AuthRequest).user, publisherId)) {
      void reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      return null;
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const publisher = await prisma.publisher.findFirst({
      where: { id: publisherId, tenantId },
      select: { id: true },
    });
    if (!publisher) {
      void reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Publisher not found' } });
      return null;
    }

    return { tenantId, publisherId };
  }

  /**
   * The period a portal request asked for, defaulting to This month -- the
   * range a publisher's statement is about -- rather than the owner screens'
   * Today.
   */
  async function portalPeriod(
    query: { period?: string; from?: string; to?: string },
    reply: FastifyReply
  ) {
    const { periodFromQuery } = await import('./call-sales.js');
    return periodFromQuery({ ...query, period: query.period ?? 'THIS_MONTH' }, reply);
  }

  /**
   * GET /api/v1/publishers/:publisherId/payouts
   *
   *   { data: { payments: [{ id, amount, method, reference, paidAt, periodFrom,
   *             periodTo, deductions: [{ id, callId, callDate, amount, createdAt }] }],
   *             waiting: [{ id, callId, callDate, amount, createdAt }] } }
   *
   * What the agency recorded paying this publisher on its Payouts screen, from
   * `publisher_payments`. This used to read `payouts`, a table nothing writes,
   * so every publisher's history was empty however often they had been paid.
   * `waiting` is the returns accepted after a payment that the next one will
   * deduct. See `services/reporting/publisher-portal.ts`.
   */
  fastify.get<{
    Params: { publisherId: string };
  }>('/api/v1/publishers/:publisherId/payouts', async (request, reply) => {
    const scope = await portalPublisher(request, reply);
    if (!scope) return reply;

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { getPublisherPayments } = await import('../services/reporting/publisher-portal.js');
    return { data: await getPublisherPayments(prisma, scope.tenantId, scope.publisherId) };
  });

  /**
   * GET /api/v1/publishers/:publisherId/payouts/summary?period=&from=&to=
   *
   *   { data: { period: { key, label, from, to, days, complete, startsAt, endsAt },
   *             payable, payableCalls, held, paid, returnsPending, netPayable } }
   *
   * This publisher's row of the owner's Payouts screen for the same period,
   * from the same `getPayoutsSummary`, so the two cannot disagree. `period`
   * defaults to THIS_MONTH.
   */
  fastify.get<{
    Params: { publisherId: string };
    Querystring: { period?: string; from?: string; to?: string };
  }>('/api/v1/publishers/:publisherId/payouts/summary', async (request, reply) => {
    const scope = await portalPublisher(request, reply);
    if (!scope) return reply;

    const period = await portalPeriod(request.query, reply);
    if (!period) return reply;

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { getPayoutsSummary } = await import('./payouts.js');
    const summary = await getPayoutsSummary(prisma, scope.tenantId, period);
    const row = summary.publishers.find(p => p.publisherId === scope.publisherId);

    return {
      data: {
        period: {
          key: period.key,
          label: period.label,
          from: period.from,
          to: period.to,
          days: period.days,
          complete: period.complete,
          startsAt: period.start.toISOString(),
          endsAt: new Date(period.endExclusive.getTime() - 1).toISOString(),
        },
        payable: row?.payable ?? 0,
        payableCalls: row?.payableCalls ?? 0,
        held: row?.held ?? 0,
        paid: row?.paid ?? 0,
        returnsPending: row?.returnsPending ?? 0,
        netPayable: row?.netPayable ?? 0,
      },
    };
  });

  /**
   * GET /api/v1/publishers/:publisherId/daily?period=&from=&to=
   *
   *   { data: { period: { key, label, from, to, days, complete },
   *             days: [{ day: 'YYYY-MM-DD', calls, billable, payout }] } }
   *
   * The publisher's inbound calls per America/New_York calendar day, every day
   * of the period present, zero days included. The dashboard's trend chart;
   * it used to be a sine wave scaled to the period's totals. `period` defaults
   * to THIS_MONTH, and a range longer than a year is refused 400.
   */
  fastify.get<{
    Params: { publisherId: string };
    Querystring: { period?: string; from?: string; to?: string };
  }>('/api/v1/publishers/:publisherId/daily', async (request, reply) => {
    const scope = await portalPublisher(request, reply);
    if (!scope) return reply;

    const period = await portalPeriod(request.query, reply);
    if (!period) return reply;

    const { getPublisherDaily, MAX_DAILY_DAYS } = await import(
      '../services/reporting/publisher-portal.js'
    );
    if (period.days > MAX_DAILY_DAYS) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: `The daily series covers at most ${MAX_DAILY_DAYS} days`,
        },
      };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const days = await getPublisherDaily(prisma, scope.tenantId, scope.publisherId, period);

    return {
      data: {
        period: {
          key: period.key,
          label: period.label,
          from: period.from,
          to: period.to,
          days: period.days,
          complete: period.complete,
        },
        days,
      },
    };
  });

  // ── Follow-Ups GET — List upcoming and overdue follow-ups ──

  fastify.get<{
    Querystring: { status?: string; limit?: string };
  }>('/api/v1/calls/follow-ups', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const limit = parseInt(request.query.limit || '50');
    const statusFilter = request.query.status || 'PENDING';

    const followUps = await prisma.call.findMany({
      where: {
        tenantId,
        followUpAt: { not: null },
        followUpStatus: statusFilter,
      },
      orderBy: { followUpAt: 'asc' },
      take: limit,
      select: {
        id: true,
        callSid: true,
        callerId: true,
        toNumber: true,
        disposition: true,
        dispositionNotes: true,
        callSource: true,
        followUpAt: true,
        followUpStatus: true,
        duration: true,
        createdAt: true,
      },
    });

    const now = new Date();
    return {
      data: followUps.map(f => ({
        ...f,
        followUpAt: f.followUpAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
        isOverdue: f.followUpAt ? f.followUpAt < now : false,
      })),
    };
  });
}

// Public API - Recordings (legacy placeholder routes)
export async function registerRecordingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // These routes are now handled by registerRecordingManagementRoutes
  // Keeping for backward compatibility
  fastify.get('/api/v1/recordings', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId',
    async (request, _reply) => {
      return {
        id: request.params.recordingId,
        callId: '00000000-0000-0000-0000-000000000000',
        url: 'https://example.com/recording.wav',
        format: 'wav',
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Public API - Webhooks
export async function registerWebhookRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/webhooks',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [webhooks, total] = await Promise.all([
        prisma.webhook.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.webhook.count({ where: { tenantId } }),
      ]);

      return {
        data: webhooks.map(w => ({
          id: w.id,
          url: w.url,
          events: w.events,
          status: w.status.toLowerCase(),
          lastTriggeredAt: w.lastTriggeredAt?.toISOString() || null,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      url: string;
      events: string[];
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/webhooks', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const body = request.body;

    if (!body.url || !body.url.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'URL is required' } };
    }

    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'At least one event is required' } };
    }

    // Validate URL format
    try {
      new URL(body.url);
    } catch {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { randomBytes } = await import('crypto');

    // Generate webhook secret
    const secret = randomBytes(32).toString('hex');

    const webhook = await prisma.webhook.create({
      data: {
        tenantId,
        url: body.url.trim(),
        events: body.events,
        secret,
        status: body.status || 'ACTIVE',
      },
    });

    // Audit log
    const { auditCreate } = await import('../services/audit.js');
    await auditCreate(
      tenantId,
      'Webhook',
      webhook.id,
      {
        url: webhook.url,
        events: webhook.events,
        status: webhook.status,
      },
      {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      }
    );

    void reply.code(201);
    return {
      id: webhook.id,
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
      status: webhook.status.toLowerCase(),
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString(),
    };
  });

  fastify.get<{ Params: { webhookId: string } }>(
    '/api/v1/webhooks/:webhookId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { webhookId } = request.params as { webhookId: string };
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const webhook = await prisma.webhook.findFirst({
        where: {
          id: webhookId,
          tenantId,
        },
      });

      if (!webhook) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
      }

      return {
        id: webhook.id,
        tenantId: webhook.tenantId,
        url: webhook.url,
        events: webhook.events,
        status: webhook.status.toLowerCase(),
        lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() || null,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      };
    }
  );

  fastify.patch<{
    Params: { webhookId: string };
    Body: {
      url?: string;
      events?: string[];
      status?: 'ACTIVE' | 'INACTIVE' | 'FAILED';
    };
  }>('/api/v1/webhooks/:webhookId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { webhookId } = request.params as { webhookId: string };
    const body = request.body;
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const existingWebhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        tenantId,
      },
    });

    if (!existingWebhook) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
    }

    const updateData: Record<string, unknown> = {};
    if (body.url !== undefined) {
      try {
        new URL(body.url);
        updateData.url = body.url.trim();
      } catch {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' } };
      }
    }
    if (body.events !== undefined) {
      if (!Array.isArray(body.events) || body.events.length === 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'At least one event is required' } };
      }
      updateData.events = body.events;
    }
    if (body.status !== undefined) {
      updateData.status = body.status.toUpperCase();
    }

    const updatedWebhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: updateData,
    });

    // Audit log
    const { auditUpdate } = await import('../services/audit.js');
    await auditUpdate(tenantId, 'Webhook', webhookId, existingWebhook, updatedWebhook, {
      userId: user?.userId,
      ipAddress: request.ip,
      requestId: request.id,
    });

    return {
      id: updatedWebhook.id,
      tenantId: updatedWebhook.tenantId,
      url: updatedWebhook.url,
      events: updatedWebhook.events,
      status: updatedWebhook.status.toLowerCase(),
      lastTriggeredAt: updatedWebhook.lastTriggeredAt?.toISOString() || null,
      createdAt: updatedWebhook.createdAt.toISOString(),
      updatedAt: updatedWebhook.updatedAt.toISOString(),
    };
  });

  fastify.delete<{ Params: { webhookId: string } }>(
    '/api/v1/webhooks/:webhookId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { webhookId } = request.params as { webhookId: string };
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const webhook = await prisma.webhook.findFirst({
        where: {
          id: webhookId,
          tenantId,
        },
      });

      if (!webhook) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
      }

      await prisma.webhook.delete({
        where: { id: webhookId },
      });

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Webhook',
        webhookId,
        { deleted: true, url: webhook.url },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      return reply.code(204).send();
    }
  );
}

// Public API - Users
export async function registerUserRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/users',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            // The licence list lives here. Without it on this read there is no
            // way to see what was granted -- only the PATCH response echoed it,
            // which means the screen that sets it could not show it.
            metadata: true,
            buyerId: true,
            publisherId: true,
            buyer: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            roles: {
              select: {
                role: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.user.count({ where: { tenantId } }),
      ]);

      return {
        data: users.map(u => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          status: u.status.toLowerCase(),
          roles: u.roles.map(ur => ur.role.name.toLowerCase()),
          buyerId: u.buyerId,
          buyerName: u.buyer?.name || null,
          buyerCode: u.buyer?.code || null,
          publisherId: u.publisherId,
          invitedAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() || null,
          // Normalised on the way out so the screen shows what would actually
          // be enforced, not what happens to be stored.
          licensedStates: normalizeLicensedStates(
            (u.metadata as { licensedStates?: unknown } | null)?.licensedStates
          ),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  /*
   * Retired. This used to create the user on the spot with a random temporary
   * password, return that password in the response body, and send nothing --
   * the inviter was expected to pass a plaintext password on by hand, and the
   * invitee was never made to change it. Every invitation now goes through
   * `POST /api/v1/auth/activation-grants`, which emails a single-use,
   * expiring link and creates the account only when it is used. 410, not 404,
   * so an old client learns where to go rather than that nothing is here.
   */
  fastify.post('/api/v1/users/invite', async (_request, reply) => {
    void reply.code(410);
    return {
      error: {
        code: 'GONE',
        message:
          'POST /api/v1/users/invite has been removed. Invite people with ' +
          'POST /api/v1/auth/activation-grants, which emails them a link to set up their account.',
      },
    };
  });

  fastify.patch<{
    Params: { userId: string };
    Body: {
      firstName?: string;
      lastName?: string;
      status?: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      buyerId?: string | null;
      publisherId?: string | null;
      metadata?: Record<string, unknown>;
    };
  }>('/api/v1/users/:userId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const { userId } = request.params;
      const body = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // This endpoint edits any user in the tenant -- status, and the buyer or
      // publisher they are scoped to -- and it only ever checked that the
      // caller belonged to the tenant. Any authenticated account could:
      //
      //   * flip a PENDING signup to ACTIVE, which is the whole of the approval
      //     gate that self-serve registration now depends on;
      //   * SUSPEND an administrator, locking out the people who would notice;
      //   * set its own buyerId to somebody else's buyer and read that buyer's
      //     calls, spend and billing through the buyer portal.
      //
      // Approving and re-scoping users is administrative work, so it needs an
      // administrator. Self-service profile edits are a different endpoint
      // (/api/auth/me/settings) and are unaffected.
      const editorProfile = await getUserProfile(request, prisma);

      if (!editorProfile.isAdminOrOwner) {
        void reply.code(403);
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Only an administrator or owner can modify users',
          },
        };
      }

      // Verify user exists and belongs to tenant
      const existingUser = await prisma.user.findFirst({
        where: {
          id: userId,
          tenantId: tenantId,
        },
      });

      if (!existingUser) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'User not found' } };
      }

      const updateData: Record<string, unknown> = {};
      if (body.firstName !== undefined) {
        updateData.firstName = body.firstName;
      }
      if (body.lastName !== undefined) {
        updateData.lastName = body.lastName;
      }
      if (body.status !== undefined) {
        updateData.status = body.status;
      }
      if (body.buyerId !== undefined) {
        updateData.buyerId = body.buyerId || null;
      }
      if (body.publisherId !== undefined) {
        updateData.publisherId = body.publisherId || null;
      }

      let metadataChanged = false;
      let newExtension: string | null = null;
      let oldExtension: string | null = null;

      if (body.metadata !== undefined) {
        const currentMetadata = (existingUser.metadata as Record<string, any>) || {};
        const mergedMetadata = {
          ...currentMetadata,
          ...body.metadata,
        };

        // `metadata.licensedStates` is the AGENT licence list that
        // `lib/licensed-states.ts` enforces against, and this endpoint -- admin
        // and owner only -- is the only way to set it. The column is untyped, so
        // this is where the type is checked.
        //
        // Rejecting beats normalising away the bad entries: an administrator who
        // pastes "Tennesee" and is told nothing has granted a licence they think
        // they granted, and the agent finds out by being refused a call. The
        // read side in `licensed-states.ts` still drops anything it cannot
        // resolve, because a row written before this check existed may hold one.
        if (mergedMetadata.licensedStates !== undefined) {
          if (!Array.isArray(mergedMetadata.licensedStates)) {
            void reply.code(400);
            return {
              error: {
                code: 'INVALID_LICENSED_STATES',
                message: 'licensedStates must be an array of US state codes',
              },
            };
          }

          const rejected = (mergedMetadata.licensedStates as unknown[]).filter(
            entry => normalizeStateCode(entry) === null
          );

          if (rejected.length > 0) {
            void reply.code(400);
            return {
              error: {
                code: 'INVALID_LICENSED_STATES',
                message: `Not US states: ${rejected.map(entry => String(entry)).join(', ')}`,
              },
            };
          }

          mergedMetadata.licensedStates = [
            ...new Set(
              (mergedMetadata.licensedStates as unknown[]).map(entry => normalizeStateCode(entry)!)
            ),
          ].sort();
        }

        updateData.metadata = mergedMetadata;

        oldExtension = currentMetadata.extension || null;
        newExtension =
          body.metadata.extension !== undefined
            ? (body.metadata.extension as string | null)
            : oldExtension;
        if (newExtension !== oldExtension) {
          metadataChanged = true;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        include: {
          roles: {
            include: {
              role: true,
            },
          },
          buyer: true,
          publisher: true,
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'User', userId, existingUser, updatedUser, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      // Sync inbound DidRoute if user's extension changed
      if (metadataChanged) {
        const phoneNumbers = await prisma.phoneNumber.findMany({
          where: { userId, tenantId, status: 'ACTIVE' },
        });

        const { didRouteService } = await import('../services/did-route-service.js');
        for (const num of phoneNumbers) {
          await didRouteService.syncDidRouteForNumber(num.id, tenantId);
        }

        const { logger } = await import('../lib/logger.js');
        logger.info({
          msg: 'User extension updated; synced did routes for assigned phone numbers',
          userId,
          phoneNumbersCount: phoneNumbers.length,
          oldExtension,
          newExtension,
        });
      }

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        status: updatedUser.status.toLowerCase(),
        roles: updatedUser.roles.map(r => r.role.name.toLowerCase()),
        buyerId: updatedUser.buyerId,
        buyerName: updatedUser.buyer?.name || null,
        metadata: updatedUser.metadata,
        createdAt: updatedUser.createdAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update user',
        },
      };
    }
  });
}

// Public API - Reporting
export async function registerReportingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  const { analyticsService } = await import('../services/analytics.js');
  const { getPrismaClient } = await import('../lib/prisma.js');

  /*
   * ── A duplicate auth hook used to sit here, and it broke the cross-agency
   *    view on every reporting route ─────────────────────────────────────────
   *
   * It re-verified the JWT and assigned the raw decoded payload straight over
   * `request.user`. That payload is `{ userId, tenantId, email }` and nothing
   * else, so it DISCARDED the principal `registerApiV1Auth` had already built
   * one hook earlier -- including `isPlatformAdmin` and the acting-tenant
   * fields that `applyPlatformContext` attaches.
   *
   * `resolveTenant` decides between "sign in" and "pick an agency" by reading
   * `isPlatformAdmin`. With it clobbered away, a platform operator with no
   * agency selected was told `401 UNAUTHORIZED` on
   * `/api/v1/reporting/metrics`, `/api/v1/reporting/calls`,
   * `/api/v1/reporting/campaigns/:id` and `/api/v1/dashboard/stats` -- and the
   * web client reads 401 as a dead session and signs them out. These routes
   * were converted to `resolveTenant` in Phase 2 and were still wrong,
   * because the conversion was correct and something else undid it downstream.
   *
   * It is deleted rather than repaired. `registerApiV1Auth` runs on the root
   * instance, ahead of every plugin, and already does everything this did:
   * bearer tokens, API keys with the same status and expiry checks, and the
   * platform context on top. A second, weaker copy of an auth path is the
   * thing the Phase 1 tenant-context work existed to remove.
   */

  // Helper to get authenticated user profile (role, buyerId, publisherId)
  async function getUserProfile(request: FastifyRequest, prisma: any) {
    const user = (request as AuthRequest).user;
    let userRoles: string[] = [];
    let buyerId: string | null = null;
    let publisherId: string | null = null;

    if (user?.userId) {
      const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        include: { roles: { include: { role: true } } },
      });
      if (userRecord) {
        userRoles = userRecord.roles.map((ur: any) => ur.role.name) || [];
        buyerId = userRecord.buyerId || null;
        publisherId = userRecord.publisherId || (userRecord.metadata as any)?.publisherId || null;
      }
    }

    if (user?.publisherId) {
      publisherId = user.publisherId;
    }

    // AGENT is NOT admin-or-owner.
    //
    // It used to be counted here, which made every `if (!isAdminOrOwner) return
    // 403` in the reporting routes below pass for any call-centre agent —
    // campaign profitability, reconciliation, buyer costs, publisher revenue.
    // Those carry platform revenue, cost and margin. The module-level
    // getUserProfile has always checked ADMIN/OWNER only; this copy drifted.
    const isAdminOrOwner =
      userRoles.some(role => role === 'ADMIN' || role === 'OWNER') ||
      (user?.roles?.some((role: string) => role === 'ADMIN' || role === 'OWNER') ?? false);
    return {
      isAdminOrOwner,
      userRoles,
      buyerId: buyerId || user?.buyerId || null,
      publisherId,
    };
  }

  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      publisherId?: string;
      buyerId?: string;
      granularity?: 'hour' | 'day';
    };
  }>('/api/v1/reporting/metrics', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const prisma = getPrismaClient();
    const profile = await getUserProfile(request, prisma);

    // `demoTenantId` is gone from these filters: analytics.ts read it as
    // `filters.demoTenantId || filters.tenantId`, so a header decided which
    // agency's numbers came back.
    const filters: any = {
      tenantId,
      startDate,
      endDate,
      campaignId: request.query.campaignId,
      publisherId: request.query.publisherId,
      buyerId: request.query.buyerId,
      granularity: request.query.granularity || 'hour',
    };

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('PUBLISHER')) {
        filters.publisherId = profile.publisherId || undefined;
      } else if (profile.userRoles.includes('BUYER')) {
        filters.buyerId = profile.buyerId || undefined;
        filters.publisherId = undefined; // Force hide publishers
      } else {
        filters.publisherId = 'none';
        filters.buyerId = 'none';
      }
    }

    const result = await analyticsService.getMetrics(filters);

    if (!profile.isAdminOrOwner) {
      result.metrics.totalCost = 0;
      if (result.breakdown) {
        for (const row of result.breakdown) {
          row.cost = 0;
        }
      }
    }
    return result;
  });

  fastify.get('/api/v1/reporting/calls', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const prisma = getPrismaClient();
    const profile = await getUserProfile(request, prisma);

    const filters: any = {
      tenantId,
      startDate,
      endDate,
      granularity: 'hour' as const,
    };

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('PUBLISHER')) {
        filters.publisherId = profile.publisherId || undefined;
      } else if (profile.userRoles.includes('BUYER')) {
        filters.buyerId = profile.buyerId || undefined;
      } else {
        filters.publisherId = 'none';
        filters.buyerId = 'none';
      }
    }

    const result = await analyticsService.getMetrics(filters);

    if (!profile.isAdminOrOwner) {
      result.metrics.totalCost = 0;
      if (result.breakdown) {
        for (const row of result.breakdown) {
          row.cost = 0;
        }
      }
    }
    return result;
  });

  fastify.get<{
    Params: { campaignId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/api/v1/reporting/campaigns/:campaignId', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const prisma = getPrismaClient();
    const profile = await getUserProfile(request, prisma);
    const campaignId = request.params.campaignId;

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('PUBLISHER')) {
        const cmp = await prisma.campaign.findFirst({
          where: { id: campaignId, publisherId: profile.publisherId || '' },
        });
        if (!cmp) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied to this campaign report' } };
        }
      } else if (profile.userRoles.includes('BUYER')) {
        const mapping = await prisma.campaignBuyer.findFirst({
          where: { campaignId, buyerId: profile.buyerId || '' },
        });
        if (!mapping) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied to this campaign report' } };
        }
      } else {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this campaign report' } };
      }
    }

    const filters = {
      tenantId,
      startDate,
      endDate,
      campaignId,
      granularity: 'day' as const,
    };

    const result = await analyticsService.getMetrics(filters);

    if (!profile.isAdminOrOwner) {
      result.metrics.totalCost = 0;
      if (result.breakdown) {
        for (const row of result.breakdown) {
          row.cost = 0;
        }
      }
    }

    return {
      campaignId,
      ...result,
    };
  });

  // ── Dashboard Stats (contractor KPIs from Call model) ──
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string };
  }>('/api/v1/dashboard/stats', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const prisma = getPrismaClient();
    const profile = await getUserProfile(request, prisma);

    // Parse date range — default to current month
    const now = new Date();
    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : now;

    const whereClause = buildCallWhere({
      tenantId,
      isAdminOrOwner: profile.isAdminOrOwner,
      userId: user?.userId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      buyerId: profile.buyerId,
      publisherId: profile.publisherId,
    });

    const followUpWhereClause = buildCallWhere({
      tenantId,
      isAdminOrOwner: profile.isAdminOrOwner,
      userId: user?.userId,
      buyerId: profile.buyerId,
      publisherId: profile.publisherId,
    });
    followUpWhereClause.followUpStatus = 'PENDING';
    followUpWhereClause.followUpAt = { not: null };

    // Non-connected dispositions (excluded from connected count)
    const nonConnectedDispositions = ['NO_ANSWER', 'WRONG_NUMBER', 'DISCONNECTED'];

    const connectedWhere = {
      ...whereClause,
    };
    if (connectedWhere.AND) {
      connectedWhere.AND = [
        ...connectedWhere.AND,
        {
          OR: [{ disposition: { notIn: nonConnectedDispositions } }, { disposition: null }],
        },
      ];
    } else {
      connectedWhere.AND = [
        {
          OR: [{ disposition: { notIn: nonConnectedDispositions } }, { disposition: null }],
        },
      ];
    }

    /*
     * Delivered calls and submitted applications: what this business is
     * measured and billed on.
     *
     * The tiles here used to be "Appointments" and "Appt. Rate" -- calls with
     * `disposition: 'SET_APPOINTMENT'`, over connected calls. NetEnroll does
     * not sell appointments and has never billed for one. An agency is charged
     * per SUBMITTED APPLICATION against the calls it was DELIVERED, and the
     * closing percentage between those two is what places it on the rate curve
     * and sets its price. A dashboard reporting a number nobody is paid for,
     * beside a Delivery screen reporting the number they are, is two answers to
     * "how did today go" -- and the agency reads the wrong one first.
     *
     * The predicates come from `services/rating/measurement.ts`, the module the
     * nightly settlement bills from, rather than being restated here. That is
     * the point rather than a convenience: a dashboard computing its own idea
     * of a delivered call would drift from the invoice, and the invoice is the
     * one that would be believed. One definition, two readers.
     *
     * -- Whose numbers --------------------------------------------------------
     *
     * An admin or owner sees the agency. An agent sees their own, on the same
     * rule the call list above already applies: `answeredByUserId` for the
     * calls they picked up, `createdById` for the applications they wrote.
     * Both columns carry a composite index covering exactly this query
     * (`[tenantId, answeredByUserId, answeredAt]` and
     * `[tenantId, createdById, submittedAt]`), so an agent's dashboard costs
     * no more than an owner's.
     */
    const measurementRange = { start: startDate, endExclusive: endDate };
    const agentScope =
      !profile.isAdminOrOwner && !profile.buyerId && !profile.publisherId && user?.userId
        ? user.userId
        : null;

    const deliveredWhere = {
      ...deliveredCallWhere(tenantId, measurementRange),
      ...(agentScope ? { answeredByUserId: agentScope } : {}),
    };
    const submittedWhere = {
      ...submittedApplicationWhere(tenantId, measurementRange),
      ...(agentScope ? { createdById: agentScope } : {}),
    };

    // Run all aggregations in parallel
    const [
      totalCalls,
      deliveredCalls,
      submittedApplications,
      appointmentsSet,
      callbacksScheduled,
      followUpsDue,
      connectedCalls,
      dispositionBreakdown,
    ] = await Promise.all([
      // Total calls in range
      prisma.call.count({ where: whereClause }),

      // Delivered calls: inbound, unblocked, ANSWERED. The billing denominator.
      prisma.call.count({ where: deliveredWhere }),

      // Submitted applications, voided ones excluded. The billing numerator.
      prisma.insuranceCarrierApplication.count({ where: submittedWhere }),

      // Appointments set
      prisma.call.count({
        where: { ...whereClause, disposition: 'SET_APPOINTMENT' },
      }),

      // Callbacks scheduled
      prisma.call.count({
        where: { ...whereClause, disposition: 'SET_CALLBACK' },
      }),

      // Follow-ups due (pending, followUpAt in the future or overdue)
      prisma.call.count({
        where: followUpWhereClause,
      }),

      // Connected calls = total minus non-connected dispositions
      prisma.call.count({
        where: connectedWhere,
      }),

      // Disposition breakdown
      prisma.call.groupBy({
        by: ['disposition'],
        where: { ...whereClause, disposition: { not: null } },
        _count: { id: true },
      }),
    ]);

    // Appointment Rate = appointments / connected calls
    const appointmentRate =
      connectedCalls > 0 ? Math.round((appointmentsSet / connectedCalls) * 10000) / 100 : 0;

    /*
     * Closing percentage, and null rather than zero for an empty window.
     *
     * Zero is a real measurement -- calls taken, nothing written -- and it is
     * the one that prices an agency to review. "No calls at all" is not that,
     * and showing them as the same number would flag an agency for the offence
     * of being closed. `measureClosing` draws exactly this distinction for
     * exactly this reason; the tile renders null as a dash.
     */
    const closingPct =
      deliveredCalls > 0
        ? Math.round((submittedApplications / deliveredCalls) * 10000) / 100
        : null;

    // Build disposition breakdown map
    const dispositions: Record<string, number> = {};
    for (const entry of dispositionBreakdown) {
      if (entry.disposition) {
        dispositions[entry.disposition] = entry._count.id;
      }
    }

    return {
      totalCalls,
      deliveredCalls,
      submittedApplications,
      closingPct,
      connectedCalls,
      appointmentsSet,
      callbacksScheduled,
      followUpsDue,
      appointmentRate,
      dispositions,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  });

  /*
   * The three money reports. Each is computed once, in
   * `services/reporting/reports.ts`, on `salesCallWhere`'s calls, and its CSV
   * renders the same rows. They take `period`/`from`/`to` as
   * `/api/v1/call-sales/summary` does.
   */
  type ReportQuery = ReportPeriodQuery & { campaignId?: string };

  // ── Publisher Revenue Report ──
  async function publisherRevenueFor(
    request: FastifyRequest<{ Querystring: ReportQuery & { publisherId?: string } }>,
    reply: any
  ) {
    const prisma = getPrismaClient();
    const {
      isAdminOrOwner,
      userRoles,
      publisherId: userPubId,
    } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner && !userRoles.includes('PUBLISHER')) {
      void reply.code(403).send({ error: 'Forbidden' });
      return null;
    }

    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      replyTenantRefusal(request, reply);
      return null;
    }

    const period = reportPeriodFromQuery(request.query, reply);
    if (!period) return null;

    let targetPublisherId = request.query.publisherId || null;
    if (userRoles.includes('PUBLISHER') && !isAdminOrOwner) {
      targetPublisherId = userPubId;
    }

    return buildPublisherRevenueReport(prisma, tenantId, period, {
      campaignId: campaignFilter(request.query.campaignId),
      publisherId: targetPublisherId,
    });
  }

  fastify.get<{ Querystring: ReportQuery & { publisherId?: string } }>(
    '/api/v1/reports/publisher-revenue',
    async (request, reply) => {
      const report = await publisherRevenueFor(request, reply);
      if (!report) return reply;
      return report;
    }
  );

  // ── Publisher Revenue CSV Export ──
  fastify.get<{ Querystring: ReportQuery & { publisherId?: string } }>(
    '/api/v1/reports/publisher-revenue/export.csv',
    async (request, reply) => {
      const report = await publisherRevenueFor(request, reply);
      if (!report) return reply;
      void reply
        .type('text/csv')
        .header('Content-Disposition', 'attachment; filename="publisher_revenue_report.csv"')
        .send(publisherRevenueCsv(report));
    }
  );

  // ── Buyer Costs Report ──
  async function buyerCostsFor(
    request: FastifyRequest<{ Querystring: ReportQuery & { buyerId?: string } }>,
    reply: any
  ) {
    const prisma = getPrismaClient();
    const {
      isAdminOrOwner,
      userRoles,
      buyerId: userBuyerId,
    } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner && !userRoles.includes('BUYER')) {
      void reply.code(403).send({ error: 'Forbidden' });
      return null;
    }

    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      replyTenantRefusal(request, reply);
      return null;
    }

    const period = reportPeriodFromQuery(request.query, reply);
    if (!period) return null;

    let targetBuyerId = request.query.buyerId || null;
    if (userRoles.includes('BUYER') && !isAdminOrOwner) {
      // A buyer with no linked buyer reads nothing, never every buyer's calls.
      targetBuyerId = userBuyerId || 'none';
    }

    return buildBuyerCostsReport(prisma, tenantId, period, {
      campaignId: campaignFilter(request.query.campaignId),
      buyerId: targetBuyerId,
    });
  }

  fastify.get<{ Querystring: ReportQuery & { buyerId?: string } }>(
    '/api/v1/reports/buyer-costs',
    async (request, reply) => {
      const report = await buyerCostsFor(request, reply);
      if (!report) return reply;
      return report;
    }
  );

  // ── Buyer Costs CSV Export ──
  fastify.get<{ Querystring: ReportQuery & { buyerId?: string } }>(
    '/api/v1/reports/buyer-costs/export.csv',
    async (request, reply) => {
      const report = await buyerCostsFor(request, reply);
      if (!report) return reply;
      void reply
        .type('text/csv')
        .header('Content-Disposition', 'attachment; filename="buyer_costs_report.csv"')
        .send(buyerCostsCsv(report));
    }
  );

  // ── Campaign Profitability Report ──
  async function campaignProfitabilityFor(
    request: FastifyRequest<{ Querystring: ReportQuery }>,
    reply: any
  ) {
    const prisma = getPrismaClient();
    const { isAdminOrOwner } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner) {
      void reply.code(403).send({ error: 'Forbidden' });
      return null;
    }

    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      replyTenantRefusal(request, reply);
      return null;
    }

    const period = reportPeriodFromQuery(request.query, reply);
    if (!period) return null;

    return buildCampaignProfitabilityReport(prisma, tenantId, period, {
      campaignId: campaignFilter(request.query.campaignId),
    });
  }

  fastify.get<{ Querystring: ReportQuery }>(
    '/api/v1/reports/campaign-profitability',
    async (request, reply) => {
      const report = await campaignProfitabilityFor(request, reply);
      if (!report) return reply;
      return { totals: report.totals, rows: report.rows };
    }
  );

  // ── Campaign Profitability CSV Export ──
  fastify.get<{ Querystring: ReportQuery }>(
    '/api/v1/reports/campaign-profitability/export.csv',
    async (request, reply) => {
      const report = await campaignProfitabilityFor(request, reply);
      if (!report) return reply;
      void reply
        .type('text/csv')
        .header('Content-Disposition', 'attachment; filename="campaign_profitability_report.csv"')
        .send(campaignProfitabilityCsv(report));
    }
  );

  // ── Reconciliation Report ──
  fastify.get('/api/v1/reports/reconciliation', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const tenantId = getActingTenantId(request);
    if (!tenantId) return replyTenantRefusal(request, reply);

    // 1. High-level aggregates
    const callAgg = await prisma.call.aggregate({
      where: { tenantId },
      _count: { id: true },
      _sum: {
        buyerBillableAmount: true,
        publisherPayoutAmount: true,
        cost: true,
      },
    });

    const ledgerAggs = await prisma.accrualLedger.groupBy({
      by: ['type'],
      where: { tenantId },
      _sum: { amount: true },
    });

    const ledgerTotals: Record<string, Prisma.Decimal> = {};
    for (const la of ledgerAggs) {
      ledgerTotals[la.type] = la._sum.amount
        ? new Prisma.Decimal(la._sum.amount)
        : new Prisma.Decimal(0);
    }

    const txnAgg = await prisma.buyerTransaction.aggregate({
      where: { buyer: { tenantId } },
      _sum: { amount: true },
    });

    const payoutAgg = await prisma.payout.groupBy({
      by: ['status'],
      where: { billingAccount: { tenantId } },
      _sum: { amount: true },
    });

    const invoiceLineAgg = await prisma.invoiceLine.aggregate({
      where: { invoice: { billingAccount: { tenantId } } },
      _sum: { total: true },
    });

    const balanceAgg = await prisma.balance.groupBy({
      by: ['type'],
      where: { billingAccount: { tenantId } },
      _sum: { amount: true },
    });

    // 2. Query Detailed Mismatches

    // a. missing ledger rows
    const missingBuyerRevenue = await prisma.call.findMany({
      where: {
        tenantId,
        buyerBillableAmount: { gt: 0 },
        buyerChargeStatus: 'CHARGED',
        accruals: {
          none: { type: 'BUYER_REVENUE' },
        },
      },
      select: { id: true, callSid: true, buyerBillableAmount: true, createdAt: true },
    });

    const missingPublisherPayout = await prisma.call.findMany({
      where: {
        tenantId,
        publisherPayoutAmount: { gt: 0 },
        accruals: {
          none: { type: 'PUBLISHER_PAYOUT' },
        },
      },
      select: { id: true, callSid: true, publisherPayoutAmount: true, createdAt: true },
    });

    const missingCarrierCost = await prisma.call.findMany({
      where: {
        tenantId,
        cost: { gt: 0 },
        accruals: {
          none: { type: 'CARRIER_COST' },
        },
      },
      select: { id: true, callSid: true, cost: true, createdAt: true },
    });

    // b. duplicate ledger rows
    const duplicatesQuery = await prisma.$queryRaw<
      Array<{
        call_id: string;
        type: string;
        count: bigint;
      }>
    >`
      SELECT call_id, type, COUNT(*) as count
      FROM accrual_ledger
      WHERE tenant_id = ${tenantId} AND call_id IS NOT NULL
      GROUP BY call_id, type
      HAVING COUNT(*) > 1
    `;

    const duplicateLedgerRows = duplicatesQuery.map(row => ({
      callId: row.call_id,
      type: row.type,
      count: Number(row.count),
    }));

    // c. calls with revenue but no buyer charge
    const callsWithRevenueNoCharge = await prisma.call.findMany({
      where: {
        tenantId,
        buyerBillableAmount: { gt: 0 },
        OR: [
          { buyerChargeStatus: { not: 'CHARGED' } },
          {
            buyer: { billingType: 'UPFRONT' },
            buyerTransactions: {
              none: { type: 'DEBIT' },
            },
          },
        ],
      },
      select: {
        id: true,
        callSid: true,
        buyerBillableAmount: true,
        buyerChargeStatus: true,
        buyer: { select: { billingType: true } },
      },
    });

    // d. calls with payout but no publisher payable
    const callsWithPayoutNoPayable = await prisma.call.findMany({
      where: {
        tenantId,
        publisherPayoutAmount: { gt: 0 },
        publisherPayoutStatus: { notIn: ['PAYABLE', 'PAID'] },
      },
      select: { id: true, callSid: true, publisherPayoutAmount: true, publisherPayoutStatus: true },
    });

    // e. calls with missing buyer/publisher
    const callsMissingBuyerPublisher = await prisma.call.findMany({
      where: {
        tenantId,
        OR: [
          { buyerBillableAmount: { gt: 0 }, buyerId: null },
          { publisherPayoutAmount: { gt: 0 }, publisherId: null },
        ],
      },
      select: {
        id: true,
        callSid: true,
        buyerBillableAmount: true,
        publisherPayoutAmount: true,
        buyerId: true,
        publisherId: true,
      },
    });

    // f. calls with billable=true but zero revenue
    const callsBillableNoRevenue = await prisma.call.findMany({
      where: {
        tenantId,
        billable: true,
        OR: [{ buyerBillableAmount: null }, { buyerBillableAmount: 0 }],
      },
      select: { id: true, callSid: true, createdAt: true },
    });

    // g. calls with non-billable but non-zero payout
    const callsNonBillableWithPayout = await prisma.call.findMany({
      where: {
        tenantId,
        billable: false,
        publisherPayoutAmount: { gt: 0 },
      },
      select: { id: true, callSid: true, publisherPayoutAmount: true },
    });

    return {
      summaries: {
        calls: {
          totalCalls: callAgg._count.id,
          totalRevenue: (callAgg._sum.buyerBillableAmount || 0).toString(),
          totalPayout: (callAgg._sum.publisherPayoutAmount || 0).toString(),
          totalCarrierCost: (callAgg._sum.cost || 0).toString(),
        },
        ledger: {
          buyerRevenue: (ledgerTotals.BUYER_REVENUE || 0).toString(),
          publisherPayout: (ledgerTotals.PUBLISHER_PAYOUT || 0).toString(),
          carrierCost: (ledgerTotals.CARRIER_COST || 0).toString(),
        },
        transactions: {
          totalAmount: (txnAgg._sum.amount || 0).toString(),
        },
        payouts: payoutAgg.map(p => ({
          status: p.status,
          total: (p._sum.amount || 0).toString(),
        })),
        invoices: {
          totalInvoiced: (invoiceLineAgg._sum.total || 0).toString(),
        },
        balances: balanceAgg.map(b => ({
          type: b.type,
          total: (b._sum.amount || 0).toString(),
        })),
      },
      mismatches: {
        missingLedgerRows: {
          buyerRevenue: missingBuyerRevenue,
          publisherPayout: missingPublisherPayout,
          carrierCost: missingCarrierCost,
        },
        duplicateLedgerRows,
        callsWithRevenueNoCharge,
        callsWithPayoutNoPayable,
        callsMissingBuyerPublisher,
        callsBillableNoRevenue,
        callsNonBillableWithPayout,
      },
    };
  });
}

// Public API - Billing
export async function registerBillingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  /*
   * The agency's own invoices and balance -- what NetEnroll bills the tenant.
   *
   * A buyer or publisher is a user inside the tenant too, so these tenant-
   * scoped reads handed them the agency's platform bill. They are refused;
   * a buyer's statement is its own ledger (`/api/v1/buyers/:id/...`).
   */
  async function isCounterparty(request: FastifyRequest, prisma: any): Promise<boolean> {
    const profile = await getUserProfile(request, prisma);
    if (profile.isAdminOrOwner) return false;
    return (
      !!profile.userRoles?.includes('BUYER') ||
      !!profile.userRoles?.includes('PUBLISHER') ||
      !!profile.buyerId ||
      !!profile.publisherId
    );
  }
  const COUNTERPARTY_REFUSAL = {
    error: { code: 'FORBIDDEN', message: "The agency's billing is not visible to this account" },
  };
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/billing/invoices',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      if (await isCounterparty(request, prisma)) {
        void reply.code(403);
        return COUNTERPARTY_REFUSAL;
      }
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      // Get billing account for tenant
      const billingAccount = await prisma.billingAccount.findFirst({
        where: { tenantId },
      });

      if (!billingAccount) {
        return {
          data: [],
          meta: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where: { billingAccountId: billingAccount.id },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            lines: {
              select: {
                id: true,
                description: true,
                quantity: true,
                unitPrice: true,
                total: true,
              },
            },
          },
        }),
        prisma.invoice.count({ where: { billingAccountId: billingAccount.id } }),
      ]);

      return {
        data: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status.toLowerCase(),
          period: {
            start: inv.periodStart.toISOString(),
            end: inv.periodEnd.toISOString(),
          },
          subtotal: inv.subtotal.toString(),
          tax: inv.tax.toString(),
          total: inv.total.toString(),
          dueDate: inv.dueDate.toISOString(),
          paidAt: inv.paidAt?.toISOString() || null,
          lines: inv.lines.map(line => ({
            id: line.id,
            description: line.description,
            quantity: line.quantity.toString(),
            unitPrice: line.unitPrice.toString(),
            total: line.total.toString(),
          })),
          createdAt: inv.createdAt.toISOString(),
          updatedAt: inv.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.get<{ Params: { invoiceId: string } }>(
    '/api/v1/billing/invoices/:invoiceId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);

      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      if (await isCounterparty(request, prisma)) {
        void reply.code(403);
        return COUNTERPARTY_REFUSAL;
      }
      const { invoiceId } = request.params as { invoiceId: string };

      // Get billing account for tenant
      const billingAccount = await prisma.billingAccount.findFirst({
        where: { tenantId },
      });

      if (!billingAccount) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Billing account not found' } };
      }

      const invoice = await prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          billingAccountId: billingAccount.id,
        },
        include: {
          lines: true,
        },
      });

      if (!invoice) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Invoice not found' } };
      }

      return {
        id: invoice.id,
        billingAccountId: invoice.billingAccountId,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status.toLowerCase(),
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        subtotal: invoice.subtotal.toString(),
        tax: invoice.tax.toString(),
        total: invoice.total.toString(),
        dueDate: invoice.dueDate.toISOString(),
        paidAt: invoice.paidAt?.toISOString() || null,
        lines: invoice.lines.map(line => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          total: line.total.toString(),
        })),
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };
    }
  );

  fastify.get('/api/v1/billing/balance', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    if (await isCounterparty(request, prisma)) {
      void reply.code(403);
      return COUNTERPARTY_REFUSAL;
    }

    // Get billing account for tenant
    const billingAccount = await prisma.billingAccount.findFirst({
      where: { tenantId },
    });

    if (!billingAccount) {
      // Return zero balance if no billing account exists
      return {
        billingAccountId: null,
        currency: 'USD',
        available: '0.00',
        pending: '0.00',
        held: '0.00',
        total: '0.00',
      };
    }

    // Get balances by type
    const balances = await prisma.balance.findMany({
      where: { billingAccountId: billingAccount.id },
    });

    const available = balances
      .filter(b => b.type === 'AVAILABLE')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const pending = balances
      .filter(b => b.type === 'PENDING')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const held = balances
      .filter(b => b.type === 'HELD')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const total = available + pending + held;

    return {
      billingAccountId: billingAccount.id,
      currency: billingAccount.currency,
      available: available.toFixed(2),
      pending: pending.toFixed(2),
      held: held.toFixed(2),
      total: total.toFixed(2),
    };
  });
}

// Admin API - Tenants
/**
 * The /admin/api/v1 surface: NetEnroll's own console, not an agency's.
 *
 * Every route below is platform-shaped -- it lists or creates TENANTS,
 * carriers, trunks and rate cards across the platform -- and every one of them
 * was registered with no authentication and no authorization whatsoever. They
 * are stubs today, returning hardcoded placeholders, which is the only reason
 * that has not leaked anything; a stub that becomes real behind no gate is how
 * it would.
 *
 * Gated at the plugin level rather than per handler, so filling one of these in
 * cannot accidentally ship it open.
 */
export async function registerAdminTenantRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get('/admin/api/v1/tenants', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/tenants', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Tenant',
      slug: 'tenant',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { tenantId: string } }>(
    '/admin/api/v1/tenants/:tenantId',
    async (request, _reply) => {
      return {
        id: request.params.tenantId,
        name: 'Tenant',
        slug: 'tenant',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { tenantId: string } }>(
    '/admin/api/v1/tenants/:tenantId',
    async (request, _reply) => {
      return {
        id: request.params.tenantId,
        name: 'Tenant',
        slug: 'tenant',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Numbers
export async function registerAdminNumberRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // See the note on registerAdminTenantRoutes: platform console, staff only.
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.post('/admin/api/v1/numbers/provision', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      number: '+15551234567',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

// Admin API - Carriers
export async function registerAdminCarrierRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // See the note on registerAdminTenantRoutes: platform console, staff only.
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get('/admin/api/v1/carriers', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/carriers', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Carrier',
      code: 'CARRIER_001',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { carrierId: string } }>(
    '/admin/api/v1/carriers/:carrierId',
    async (request, _reply) => {
      return {
        id: request.params.carrierId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Carrier',
        code: 'CARRIER_001',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { carrierId: string } }>(
    '/admin/api/v1/carriers/:carrierId',
    async (request, _reply) => {
      return {
        id: request.params.carrierId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Carrier',
        code: 'CARRIER_001',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Trunks
export async function registerAdminTrunkRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // See the note on registerAdminTenantRoutes: platform console, staff only.
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get('/admin/api/v1/trunks', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/trunks', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      carrierId: '00000000-0000-0000-0000-000000000000',
      name: 'Trunk',
      type: 'SIP',
      host: 'sip.example.com',
      port: 5060,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { trunkId: string } }>(
    '/admin/api/v1/trunks/:trunkId',
    async (request, _reply) => {
      return {
        id: request.params.trunkId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        carrierId: '00000000-0000-0000-0000-000000000000',
        name: 'Trunk',
        type: 'SIP',
        host: 'sip.example.com',
        port: 5060,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { trunkId: string } }>(
    '/admin/api/v1/trunks/:trunkId',
    async (request, _reply) => {
      return {
        id: request.params.trunkId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        carrierId: '00000000-0000-0000-0000-000000000000',
        name: 'Trunk',
        type: 'SIP',
        host: 'sip.example.com',
        port: 5060,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Rate Cards
export async function registerAdminRateCardRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // See the note on registerAdminTenantRoutes: platform console, staff only.
  fastify.addHook('onRequest', authenticate);
  fastify.addHook('preHandler', requirePlatformAdmin);

  fastify.get('/admin/api/v1/rate-cards', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/rate-cards', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      billingAccountId: '00000000-0000-0000-0000-000000000000',
      name: 'Rate Card',
      effectiveFrom: new Date().toISOString(),
      status: 'ACTIVE',
      rates: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { rateCardId: string } }>(
    '/admin/api/v1/rate-cards/:rateCardId',
    async (request, _reply) => {
      return {
        id: request.params.rateCardId,
        billingAccountId: '00000000-0000-0000-0000-000000000000',
        name: 'Rate Card',
        effectiveFrom: new Date().toISOString(),
        status: 'ACTIVE',
        rates: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { rateCardId: string } }>(
    '/admin/api/v1/rate-cards/:rateCardId',
    async (request, _reply) => {
      return {
        id: request.params.rateCardId,
        billingAccountId: '00000000-0000-0000-0000-000000000000',
        name: 'Rate Card',
        effectiveFrom: new Date().toISOString(),
        status: 'ACTIVE',
        rates: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}
