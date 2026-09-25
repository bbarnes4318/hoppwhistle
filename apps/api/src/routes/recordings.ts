import type { Call, Prisma, RecordingStatus } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getActingTenantId, getActingUserId, sendTenantRefusal } from '../lib/tenant-context.js';
import { RecordingService } from '../services/recording-service.js';

const recordingService = new RecordingService();
const prisma = getPrismaClient();

function getPublicApiBaseUrl(request: FastifyRequest): string {
  const envUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
  if (envUrl) {
    return envUrl.replace(/\/api\/?$/, '');
  }
  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = request.headers.host || 'localhost:3001';
  return `${protocol}://${host}`;
}

/**
 * Recording management routes
 */
// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins must return a promise
export async function registerRecordingManagementRoutes(fastify: FastifyInstance) {
  // Upload recording callback from FreeSWITCH
  fastify.post<{
    Body: {
      callId: string;
      legId?: string;
      url?: string;
      format?: string;
      size?: number;
      duration?: number;
    };
  }>('/api/v1/recordings/upload', async (request, reply) => {
    let resolvedCallId: string | undefined = undefined;
    try {
      const { callId, legId, url, format, duration } = request.body || {};
      resolvedCallId = callId;

      // If URL is provided, download and upload to S3
      if (url) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download recording from ${url}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) {
          throw new Error('Downloaded recording file is empty');
        }
        const uploadResult = await recordingService.uploadRecording({
          callId: resolvedCallId || '',
          legId,
          format: format || 'wav',
          file: buffer,
          duration,
        });

        return {
          success: true,
          recordingId: uploadResult.id,
          storageKey: uploadResult.storageKey,
          size: uploadResult.size.toString(),
          checksum: uploadResult.checksum,
        };
      }

      let fileBuffer: Buffer | null = null;
      let resolvedFormat: string | undefined = format;
      let resolvedLegId: string | undefined = legId;
      let resolvedDuration: number | undefined = duration;

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            if (!resolvedFormat && part.filename) {
              resolvedFormat = part.filename.split('.').pop();
            }
          } else {
            const fieldVal = part.value !== undefined ? String(part.value) : undefined;
            if (part.fieldname === 'callId') {
              resolvedCallId = fieldVal;
            } else if (part.fieldname === 'format') {
              resolvedFormat = fieldVal;
            } else if (part.fieldname === 'legId') {
              resolvedLegId = fieldVal;
            } else if (part.fieldname === 'duration') {
              resolvedDuration = fieldVal ? Number(fieldVal) : undefined;
            }
          }
        }
      }

      if (!resolvedCallId) {
        void reply.code(400);
        return {
          error: {
            code: 'MISSING_CALL_ID',
            message: 'callId is required',
          },
        };
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('No file provided or file is empty');
      }

      const uploadResult = await recordingService.uploadRecording({
        callId: resolvedCallId,
        legId: resolvedLegId,
        format: resolvedFormat || 'wav',
        file: fileBuffer,
        duration: resolvedDuration,
      });

      return {
        success: true,
        recordingId: uploadResult.id,
        storageKey: uploadResult.storageKey,
        size: uploadResult.size.toString(),
        checksum: uploadResult.checksum,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to upload recording';
      if (resolvedCallId) {
        try {
          await recordingService.markRecordingFailed(resolvedCallId, errorMsg);
        } catch (markErr) {
          request.log.error({ error: markErr, callId: resolvedCallId }, 'Failed to mark recording as failed');
        }
      }
      void reply.code(400);
      return {
        error: {
          code: 'UPLOAD_ERROR',
          message: errorMsg,
        },
      };
    }
  });

  // Helper to get authenticated user profile (role, buyerId, publisherId, accessToRecordings)
  async function getUserProfile(request: FastifyRequest) {
    const user = request.user;
    let userRoles: string[] = [];
    let buyerId: string | null = null;
    let publisherId: string | null = null;
    let publisherAccessToRecordings = false;
    let buyerAccessToRecordings = false;

    if (user?.userId) {
      const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        include: { roles: { include: { role: true } } },
      });
      if (userRecord) {
        userRoles = userRecord.roles.map(ur => ur.role.name) || [];
        buyerId = userRecord.buyerId || null;
        publisherId =
          userRecord.publisherId ||
          (userRecord.metadata as { publisherId?: string } | null)?.publisherId ||
          null;
      }
    }

    if (user?.roles && Array.isArray(user.roles)) {
      for (const r of user.roles) {
        if (!userRoles.includes(r)) userRoles.push(r);
      }
    }

    if (publisherId) {
      const pub = await prisma.publisher.findUnique({
        where: { id: publisherId },
        select: { accessToRecordings: true },
      });
      publisherAccessToRecordings = pub?.accessToRecordings ?? false;
    }

    if (buyerId) {
      const buyer = await prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { metadata: true },
      });
      buyerAccessToRecordings = !!(
        buyer?.metadata as { accessToRecordings?: unknown } | null | undefined
      )?.accessToRecordings;
    }

    const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER') || 
                           (user?.roles?.some(role => role === 'ADMIN' || role === 'OWNER') ?? false);

    return {
      isAdminOrOwner,
      userRoles,
      buyerId,
      publisherId,
      publisherAccessToRecordings,
      buyerAccessToRecordings,
    };
  }

  // Helper to verify recording access permissions
  async function checkRecordingAccess(
    recording: { call: Call | null },
    profile: Awaited<ReturnType<typeof getUserProfile>>,
    tenantId: string,
    userId?: string
  ): Promise<boolean> {
    if (profile.isAdminOrOwner) {
      return true;
    }
    if (profile.userRoles.includes('PUBLISHER')) {
      return !!(profile.publisherAccessToRecordings && recording.call?.publisherId === profile.publisherId);
    }
    if (profile.userRoles.includes('BUYER')) {
      return !!(profile.buyerAccessToRecordings && recording.call?.buyerId === profile.buyerId);
    }
    if (profile.userRoles.includes('AGENT') && userId) {
      if (recording.call?.createdById === userId) {
        return true;
      }
      // Fetch agent's phone numbers
      const fetchedNumbers = await prisma.phoneNumber.findMany({
        where: { tenantId, userId },
        select: { number: true },
      });
      const userNumbers = fetchedNumbers.map(n => n.number);
      const numberFormats: string[] = [];
      for (const num of userNumbers) {
        numberFormats.push(num);
        if (num.startsWith('+1')) {
          numberFormats.push(num.substring(2));
          numberFormats.push(num.substring(1));
        } else if (num.startsWith('1') && num.length === 11) {
          numberFormats.push('+' + num);
          numberFormats.push(num.substring(1));
        } else if (num.length === 10) {
          numberFormats.push('+1' + num);
          numberFormats.push('1' + num);
        }
      }
      const callCaller = recording.call?.callerId || '';
      const callTo = recording.call?.toNumber || '';
      const callDid = recording.call?.did || '';
      return numberFormats.includes(callCaller) || numberFormats.includes(callTo) || numberFormats.includes(callDid);
    }
    return false;
  }

  // List recordings
  fastify.get('/api/v1/recordings', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const {
      page = 1,
      limit = 20,
      callId,
      status,
    } = request.query as {
      page?: number;
      limit?: number;
      callId?: string;
      status?: string;
    };

    const profile = await getUserProfile(request);

    const callWhere: Prisma.CallWhereInput = { tenantId };
    const where: Prisma.RecordingWhereInput = {
      call: callWhere,
      deletedAt: null,
    };

    if (callId) {
      where.callId = callId;
    }

    if (status) {
      where.status = status as RecordingStatus;
    }

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('PUBLISHER')) {
        if (!profile.publisherAccessToRecordings) {
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
        callWhere.publisherId = profile.publisherId;
      } else if (profile.userRoles.includes('BUYER')) {
        if (!profile.buyerAccessToRecordings) {
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
        callWhere.buyerId = profile.buyerId;
      } else if (profile.userRoles.includes('AGENT')) {
        // Fetch agent's phone numbers
        const fetchedNumbers = await prisma.phoneNumber.findMany({
          where: { tenantId, userId: request.user?.userId },
          select: { number: true },
        });
        const userNumbers = fetchedNumbers.map(n => n.number);
        const numberFormats: string[] = [];
        for (const num of userNumbers) {
          numberFormats.push(num);
          if (num.startsWith('+1')) {
            numberFormats.push(num.substring(2));
            numberFormats.push(num.substring(1));
          } else if (num.startsWith('1') && num.length === 11) {
            numberFormats.push('+' + num);
            numberFormats.push(num.substring(1));
          } else if (num.length === 10) {
            numberFormats.push('+1' + num);
            numberFormats.push('1' + num);
          }
        }
        callWhere.OR = [
          { createdById: request.user?.userId },
          { fromNumber: { userId: request.user?.userId } },
          { callerId: { in: numberFormats } },
          { toNumber: { in: numberFormats } },
          { did: { in: numberFormats } },
        ];
      } else {
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
    }

    const [recordings, total] = await Promise.all([
      prisma.recording.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          call: {
            select: {
              id: true,
              callSid: true,
              fromNumber: { select: { number: true } },
              toNumber: true,
            },
          },
        },
      }),
      prisma.recording.count({ where }),
    ]);

    return {
      data: recordings.map(r => ({
        id: r.id,
        callId: r.callId,
        legId: r.legId,
        format: r.format,
        size: r.size?.toString(),
        duration: r.duration,
        status: r.status,
        storageTier: r.storageTier,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // Get recording details
  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const recording = await prisma.recording.findFirst({
        where: {
          id: request.params.recordingId,
          call: { tenantId },
          deletedAt: null,
        },
        include: {
          call: true,
        },
      });

      if (!recording) {
        void reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Recording not found',
          },
        };
      }

      const profile = await getUserProfile(request);
      const isAllowed = await checkRecordingAccess(recording, profile, tenantId, request.user?.userId);

      if (!isAllowed) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
      }

      return {
        id: recording.id,
        callId: recording.callId,
        legId: recording.legId,
        url: recording.url,
        storageKey: recording.storageKey,
        format: recording.format,
        size: recording.size?.toString(),
        checksum: recording.checksum,
        duration: recording.duration,
        status: recording.status,
        storageTier: recording.storageTier,
        metadata: recording.metadata,
        createdAt: recording.createdAt.toISOString(),
        updatedAt: recording.updatedAt.toISOString(),
      };
    }
  );

  // Get signed URL for playback
  fastify.get<{
    Params: { recordingId: string };
    Querystring: { expiresIn?: string };
  }>('/api/v1/recordings/:recordingId/url', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    try {
      const { recordingId } = request.params;

      const recording = await prisma.recording.findFirst({
        where: {
          id: recordingId,
          deletedAt: null,
          call: { tenantId },
        },
        include: {
          call: true,
        },
      });

      if (!recording) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
      }

      const profile = await getUserProfile(request);
      const isAllowed = await checkRecordingAccess(recording, profile, tenantId, request.user?.userId);

      if (!isAllowed) {
        void reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
      }

      const token = await reply.jwtSign(
        {
          tenantId,
          userId: request.user?.userId,
          email: request.user?.email,
        },
        { expiresIn: '1h' }
      );

      const apiBaseUrl = getPublicApiBaseUrl(request);
      const playbackUrl = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${recordingId}/stream?token=${token}`;

      return {
        url: playbackUrl,
        expiresIn: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    } catch (error) {
      void reply.code(404);
      return {
        error: {
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Recording not found',
        },
      };
    }
  });

  // Stream recording
  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId/stream',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      try {
        const { recordingId } = request.params;

        const recording = await prisma.recording.findFirst({
          where: {
            id: recordingId,
            deletedAt: null,
            call: { tenantId },
          },
          include: {
            call: true,
          },
        });

        if (!recording) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
        }

        const profile = await getUserProfile(request);
        const isAllowed = await checkRecordingAccess(recording, profile, tenantId, request.user?.userId);

        if (!isAllowed) {
          void reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
        }

        const { stream, contentType, contentLength } = await recordingService.getRecordingStream(recordingId);
        
        void reply.type(contentType);
        if (contentLength !== undefined) {
          void reply.header('Content-Length', contentLength.toString());
        }
        return reply.send(stream);
      } catch (error) {
        void reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'Recording not found',
          },
        };
      }
    }
  );

  /**
   * Backfill size and checksum for a recording, from object storage.
   *
   * This took a recording id from the request and passed it straight to the
   * service, which looks it up by primary key. No tenant, no role: any
   * authenticated caller could name any recording on the platform and write to
   * its row. A small write -- size and checksum -- but a write across the agency
   * boundary, reached by naming a uuid the recordings list hands out.
   *
   * The ownership check is the query, not a comparison after it, and it runs
   * before the service is called at all.
   */
  fastify.post<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId/backfill',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) {
        return sendTenantRefusal(request, reply);
      }

      const owned = await prisma.recording.findFirst({
        where: { id: request.params.recordingId, deletedAt: null, call: { tenantId } },
        select: { id: true },
      });

      if (!owned) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
      }

      try {
        await recordingService.backfillMetadata(request.params.recordingId);
        return {
          success: true,
          message: 'Metadata backfilled successfully',
        };
      } catch (error) {
        void reply.code(400);
        return {
          error: {
            code: 'BACKFILL_ERROR',
            message: error instanceof Error ? error.message : 'Failed to backfill metadata',
          },
        };
      }
    }
  );

  /**
   * Stream a locally-stored recording by its storage key.
   *
   * ── What this used to be ─────────────────────────────────────────────────
   *
   * A route with no `preHandler`, on a plugin with no auth hook, whose handler
   * never read `request.user`, never called `getActingTenantId()` and never
   * touched the `recordings` table. It resolved the wildcard against
   * `LOCAL_STORAGE_DIR` and streamed the file. Directory traversal was handled;
   * authentication was absent entirely.
   *
   * The keys are not secret. `services/storage.ts` returns
   * `/api/v1/recordings/local-stream/<storageKey>` from `getSignedUrl()`
   * whenever the file is on local disk or S3 credentials are unset, so the key
   * travels in API responses and in `recording.url`, and from there into access
   * logs, browser history and anywhere a link is pasted. The format is
   * `recordings/YYYY/MM/DD/<callId>.<ext>` and carries NO tenant segment. Any
   * key that ever left the building was a permanent, credential-free download
   * of one agency's call audio, by anybody, from any tenant.
   *
   * ── What authorises it now ───────────────────────────────────────────────
   *
   * The same decision the `:recordingId` routes make, reached the same way: the
   * acting tenant from the authenticated principal, the row looked up WITH that
   * tenant in the query rather than checked afterwards, and then
   * `checkRecordingAccess`, which narrows an AGENT to recordings of calls they
   * created or took on one of their own numbers.
   *
   * The storage key is an identifier, never a credential. Holding one proves
   * nothing and grants nothing; it only names the row whose ownership is then
   * checked.
   *
   * ── Two kinds of file live under the same prefix ─────────────────────────
   *
   * `Recording` (owned by a tenant through its `Call`) and `RecordingAnalysis`
   * (owned by a tenant and a user directly -- the Recording Analyzer's
   * uploads). Both are served from local storage by the same helper, so both
   * are resolved here. A key matching neither is a 404: not "no such file",
   * which would confirm the key's shape to someone probing, but "no such
   * recording", which is the same answer an unauthorised key gets.
   */
  fastify.get('/api/v1/recordings/local-stream/*', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const params = request.params as Record<string, string>;
    let storageKey = params['*'];
    if (!storageKey) {
      void reply.code(400);
      return { error: { code: 'BAD_REQUEST', message: 'Missing storage key' } };
    }

    // Ensure storage key is fully URL-decoded (handling %2F, %20, etc.)
    try {
      storageKey = decodeURIComponent(storageKey);
    } catch {
      // ignore decoding errors
    }

    const userId = getActingUserId(request) ?? undefined;

    /*
     * Tenant scoping is IN the query, not a comparison after it. A
     * `findFirst({ where: { storageKey } })` followed by
     * `if (row.tenantId !== tenantId)` is one early return away from being a
     * cross-tenant read, and this route is where that mistake costs the most.
     */
    const recording = await prisma.recording.findFirst({
      where: { storageKey, deletedAt: null, call: { tenantId } },
      include: { call: true },
    });

    let authorized = false;

    if (recording) {
      const profile = await getUserProfile(request);
      authorized = await checkRecordingAccess(recording, profile, tenantId, userId);
    } else {
      /*
       * A Recording Analyzer upload. Owned by the user who uploaded it, inside
       * one tenant -- there is no call, so no publisher, buyer or agent-number
       * dimension to narrow by. An agency administrator sees the agency's;
       * everyone else sees their own.
       */
      const analysis = await prisma.recordingAnalysis.findFirst({
        where: { storageKey, tenantId },
        select: { userId: true },
      });

      if (analysis) {
        const profile = await getUserProfile(request);
        authorized = Boolean(profile.isAdminOrOwner) || (!!userId && analysis.userId === userId);
      }
    }

    if (!authorized) {
      /*
       * 404, not 403. A 403 tells a caller holding a guessed or leaked key that
       * the key is real and names a recording in this tenant, which is most of
       * what they wanted to know. An unauthorised key and an unknown key are
       * answered identically.
       */
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
    }

    const fs = await import('fs');
    const path = await import('path');
    const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
    const localFilePath = path.join(localDir, storageKey);

    // Verify directory traversal protection
    const resolvedPath = path.resolve(localFilePath);
    const resolvedDir = path.resolve(localDir);
    if (!resolvedPath.startsWith(resolvedDir)) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Access forbidden: invalid storage key' } };
    }

    if (!fs.existsSync(resolvedPath)) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Local recording file not found' } };
    }

    const stream = fs.createReadStream(resolvedPath);
    void reply.type('audio/wav');
    return reply.send(stream);
  });
}
