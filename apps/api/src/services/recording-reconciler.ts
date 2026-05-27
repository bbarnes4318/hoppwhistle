import * as fs from 'fs';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { RecordingService } from './recording-service.js';

const STALE_PROCESSING_MS = Number(process.env.RECORDING_PROCESSING_TIMEOUT_MS || 60_000);

type ReconcileResult =
  | { action: 'not_needed'; callId: string }
  | { action: 'ready_from_existing_recording'; callId: string; recordingId: string }
  | { action: 'uploaded_from_shared_file'; callId: string }
  | { action: 'failed_stale_processing'; callId: string; error: string };

export async function reconcileRecordingForCall(callId: string): Promise<ReconcileResult> {
  const prisma = getPrismaClient();

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      recordings: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!call) {
    logger.info({ callId, finalAction: 'failed_stale_processing' }, '[Recording Reconciler] Call not found');
    return { action: 'failed_stale_processing', callId, error: 'Call not found' };
  }

  if (call.recordingStatus === 'READY' || call.recordingStatus === 'FAILED' || call.recordingStatus === null) {
    logger.info({ callId, currentStatus: call.recordingStatus, finalAction: 'not_needed' }, '[Recording Reconciler] No reconciliation needed');
    return { action: 'not_needed', callId };
  }

  const activeStatuses = ['PENDING', 'RECORDING', 'PROCESSING'];
  if (!activeStatuses.includes(call.recordingStatus || '')) {
    logger.info({ callId, currentStatus: call.recordingStatus, finalAction: 'not_needed' }, '[Recording Reconciler] Status is not active');
    return { action: 'not_needed', callId };
  }

  const existingRecording = call.recordings[0];
  logger.info(
    { callId, previousStatus: call.recordingStatus, hasRecordingRow: !!existingRecording },
    '[Recording Reconciler] Starting reconciliation check'
  );

  if (existingRecording) {
    const playbackUrl = `/api/v1/recordings/${existingRecording.id}/stream`;

    await prisma.call.update({
      where: { id: callId },
      data: {
        primaryRecordingId: existingRecording.id,
        recordingStatus: 'READY',
        recordingUrl: playbackUrl,
        recordingCompletedAt: existingRecording.createdAt,
        recordingError: null,
      },
    });

    logger.info(
      { callId, recordingId: existingRecording.id, finalAction: 'READY' },
      '[Recording Reconciler] Repaired call recordingStatus to READY using existing recording'
    );

    return {
      action: 'ready_from_existing_recording',
      callId,
      recordingId: existingRecording.id,
    };
  }

  const now = Date.now();
  const lastRelevantTime =
    call.recordingCompletedAt?.getTime() ||
    call.endedAt?.getTime() ||
    call.updatedAt.getTime();

  const ageMs = now - lastRelevantTime;

  if (ageMs < STALE_PROCESSING_MS) {
    logger.info(
      { callId, ageMs, limitMs: STALE_PROCESSING_MS, finalAction: 'not_needed' },
      '[Recording Reconciler] Call recording is not stale yet'
    );
    return { action: 'not_needed', callId };
  }

  const path1 = `/recordings/${callId}.wav`;
  const path2 = `/tmp/recordings/${callId}.wav`;
  const file1Exists = fs.existsSync(path1);
  const file2Exists = fs.existsSync(path2);

  logger.info(
    { callId, file1Exists, file2Exists },
    `[Recording Reconciler] Checking paths: ${path1} (exists: ${file1Exists}), ${path2} (exists: ${file2Exists})`
  );

  const possiblePaths = [path1, path2];

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);

      if (stat.size > 0) {
        const recordingService = new RecordingService();
        const fileBuffer = fs.readFileSync(filePath);

        await recordingService.uploadRecording({
          callId,
          format: 'wav',
          file: fileBuffer,
          duration: call.duration || undefined,
        });

        try {
          fs.unlinkSync(filePath);
        } catch (cleanupErr) {
          logger.warn({ callId, filePath, err: cleanupErr }, '[Recording Reconciler] Failed to clean up WAV file after upload');
        }

        logger.info(
          { callId, filePath, finalAction: 'uploaded_from_file' },
          '[Recording Reconciler] Successfully uploaded recording from shared file'
        );
        return { action: 'uploaded_from_shared_file', callId };
      }
    }
  }

  const error =
    `Recording stayed ${call.recordingStatus} for ${Math.round(ageMs / 1000)}s ` +
    'and no recording row or shared WAV file was found. FreeSWITCH upload hook likely did not run or upload failed.';

  await prisma.call.update({
    where: { id: callId },
    data: {
      recordingStatus: 'FAILED',
      recordingError: error,
      recordingCompletedAt: new Date(),
    },
  });

  logger.info(
    { callId, finalAction: 'FAILED', error },
    '[Recording Reconciler] Marked recordingStatus as FAILED'
  );

  return {
    action: 'failed_stale_processing',
    callId,
    error,
  };
}

export async function reconcileStaleRecordingsForTenant(tenantId: string): Promise<void> {
  const prisma = getPrismaClient();

  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);

  const staleCalls = await prisma.call.findMany({
    where: {
      tenantId,
      recordingStatus: {
        in: ['PENDING', 'RECORDING', 'PROCESSING'],
      },
      updatedAt: {
        lt: cutoff,
      },
    },
    select: {
      id: true,
    },
    take: 50,
    orderBy: {
      updatedAt: 'asc',
    },
  });

  if (staleCalls.length > 0) {
    logger.info({ tenantId, count: staleCalls.length }, '[Recording Reconciler] Reconciling stale calls for tenant');
    await Promise.allSettled(staleCalls.map(call => reconcileRecordingForCall(call.id)));
  }
}
