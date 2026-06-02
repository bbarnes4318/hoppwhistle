import { Readable } from 'stream';

import { getPrismaClient } from '../lib/prisma.js';

import { getStorageService } from './storage.js';

export interface RecordingUploadData {
  callId: string;
  legId?: string;
  format?: string;
  file: Buffer | Readable;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export class RecordingService {
  private prisma = getPrismaClient();

  /**
   * Upload a recording from FreeSWITCH callback.
   * This is the CANONICAL ingestion path for all recordings.
   *
   * Lifecycle:
   *   1. Upload file to S3
   *   2. Create Recording row (status = COMPLETED)
   *   3. Update Call row: primaryRecordingId, recordingStatus, recordingUrl, etc.
   *   4. Emit recording.ready event for transcription / UI refresh
   */
  async uploadRecording(data: RecordingUploadData): Promise<{
    id: string;
    storageKey: string;
    size: bigint;
    checksum: string;
  }> {
    const storage = getStorageService();
    const format = data.format || 'wav';

    // Upload to S3
    const uploadResult = await storage.uploadRecording(
      data.file,
      data.callId,
      format,
      {
        callId: data.callId,
        legId: data.legId || '',
        format,
      }
    );

    // Get call to extract tenant ID
    const call = await this.prisma.call.findUnique({
      where: { id: data.callId },
      select: { tenantId: true, primaryRecordingId: true },
    });

    if (!call) {
      throw new Error(`Call ${data.callId} not found`);
    }

    // Create recording record
    // Note: Multiple recordings per call are supported (one per leg)
    const recording = await this.prisma.recording.create({
      data: {
        callId: data.callId,
        legId: data.legId,
        url: uploadResult.url,
        storageKey: uploadResult.storageKey,
        format,
        size: uploadResult.size,
        checksum: uploadResult.checksum,
        duration: data.duration,
        status: 'COMPLETED',
        metadata: (data.metadata || {}) as import('@prisma/client').Prisma.InputJsonValue,
      },
    });

    // =========================================================================
    // Update the Call row with recording info
    // This bridges the Recording table to the Call.recordingUrl field that
    // the /calls and /dashboard UIs already read.
    // =========================================================================
    // Build a secure internal playback URL instead of exposing raw S3 URLs
    const playbackUrl = `/api/v1/recordings/${recording.id}/stream`;

    const existingCall = await this.prisma.call.findUnique({
      where: { id: data.callId },
      select: { metadata: true }
    });
    const callMetadata = (existingCall?.metadata as any) || {};
    const existingRecordingDebug = callMetadata.recordingDebug || {};
    const recordingDebug = {
      ...existingRecordingDebug,
      uploadAttemptedAt: new Date().toISOString(),
      uploadHttpCode: 200,
    };

    await this.prisma.call.update({
      where: { id: data.callId },
      data: {
        primaryRecordingId: recording.id,
        recordingStatus: 'READY',
        recordingCompletedAt: new Date(),
        recordingUrl: playbackUrl,
        recordingError: null, // Clear any previous error
        metadata: {
          ...callMetadata,
          recordingDebug,
        } as any,
      },
    });

    // Emit recording.ready event for transcription and live UI refresh
    const { eventBus } = await import('./event-bus.js');
    const signedUrl = await storage.getSignedUrl(uploadResult.storageKey, 3600);

    await eventBus.publish('recording.*', {
      event: 'recording.ready',
      tenantId: call.tenantId,
      data: {
        callId: data.callId,
        recordingId: recording.id,
        recordingUrl: signedUrl,
        playbackUrl,
        format,
        durationSec: data.duration,
        metadata: data.metadata || {},
      },
    });

    return {
      id: recording.id,
      storageKey: uploadResult.storageKey,
      size: uploadResult.size,
      checksum: uploadResult.checksum,
    };
  }

  /**
   * Mark a call's recording as failed.
   * Called when recording upload or processing fails.
   */
  async markRecordingFailed(callId: string, error: string): Promise<void> {
    const existingCall = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { metadata: true }
    });
    const callMetadata = (existingCall?.metadata as any) || {};
    const existingRecordingDebug = callMetadata.recordingDebug || {};
    const recordingDebug = {
      ...existingRecordingDebug,
      uploadAttemptedAt: new Date().toISOString(),
      uploadError: error,
    };

    await this.prisma.call.update({
      where: { id: callId },
      data: {
        recordingStatus: 'FAILED',
        recordingError: error,
        metadata: {
          ...callMetadata,
          recordingDebug,
        } as any,
      },
    });

    // Emit failure event so live UI can update
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { tenantId: true },
    });

    if (call) {
      const { eventBus } = await import('./event-bus.js');
      await eventBus.publish('recording.*', {
        event: 'recording.failed',
        tenantId: call.tenantId,
        data: {
          callId,
          error,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Generate signed URL for playback
   */
  async getSignedUrl(
    recordingId: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    if (!recording.storageKey) {
      throw new Error('Recording storage key not found');
    }

    if (recording.deletedAt) {
      throw new Error('Recording has been deleted');
    }

    const storage = getStorageService();
    return storage.getSignedUrl(recording.storageKey, expiresIn);
  }

  /**
   * Get streaming URL
   */
  async getStreamUrl(recordingId: string): Promise<string> {
    return this.getSignedUrl(recordingId, 86400); // 24 hours for streaming
  }

  /**
   * Get readable stream and content details for a recording
   */
  async getRecordingStream(recordingId: string): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: bigint;
  }> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    if (recording.deletedAt) {
      throw new Error('Recording has been deleted');
    }

    const fs = await import('fs');
    const path = await import('path');

    // 1. Check if recording.url points to a local file path starting with '/recordings/'
    if (recording.url && recording.url.startsWith('/recordings/')) {
      const mountedPath = recording.url;
      if (fs.existsSync(mountedPath)) {
        const stat = fs.statSync(mountedPath);
        return {
          stream: fs.createReadStream(mountedPath),
          contentType: 'audio/wav',
          contentLength: BigInt(stat.size),
        };
      }
    }

    // 2. Check if the basename exists directly in mounted /recordings directory
    if (recording.url) {
      const baseName = path.basename(recording.url);
      const possiblePath = path.join('/recordings', baseName);
      if (fs.existsSync(possiblePath)) {
        const stat = fs.statSync(possiblePath);
        return {
          stream: fs.createReadStream(possiblePath),
          contentType: 'audio/wav',
          contentLength: BigInt(stat.size),
        };
      }
    }

    // 3. Fallback to normal storage service flow if storageKey is present
    if (!recording.storageKey) {
      throw new Error('Recording storage key not found');
    }

    try {
      const storage = getStorageService();
      return await storage.getRecordingStream(recording.storageKey);
    } catch (s3Error) {
      // 4. If S3 fails, check if the file is in local uploads or /recordings
      const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
      const localFilePath = path.join(localDir, recording.storageKey);
      if (fs.existsSync(localFilePath)) {
        const stat = fs.statSync(localFilePath);
        return {
          stream: fs.createReadStream(localFilePath),
          contentType: 'audio/wav',
          contentLength: BigInt(stat.size),
        };
      }

      if (recording.url && recording.url.includes('/local-stream/')) {
        const decodedKey = decodeURIComponent(recording.url.split('/local-stream/')[1]);
        const fallbackPath = path.join(localDir, decodedKey);
        if (fs.existsSync(fallbackPath)) {
          const stat = fs.statSync(fallbackPath);
          return {
            stream: fs.createReadStream(fallbackPath),
            contentType: 'audio/wav',
            contentLength: BigInt(stat.size),
          };
        }
      }

      throw s3Error;
    }
  }

  /**
   * Backfill metadata for a recording
   */
  async backfillMetadata(recordingId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording || !recording.storageKey) {
      throw new Error('Recording or storage key not found');
    }

    const storage = getStorageService();

    // Get metadata from S3
    const metadata = await storage.getMetadata(recording.storageKey);

    // Update database
    await this.prisma.recording.update({
      where: { id: recordingId },
      data: {
        size: metadata.size,
        checksum: metadata.checksum,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Backfill metadata for all recordings missing it
   */
  async backfillAllMetadata(limit: number = 100): Promise<number> {
    const recordings = await this.prisma.recording.findMany({
      where: {
        OR: [
          { size: null },
          { checksum: null },
        ],
        storageKey: { not: null },
        deletedAt: null,
      },
      take: limit,
    });

    let processed = 0;
    for (const recording of recordings) {
      try {
        await this.backfillMetadata(recording.id);
        processed++;
      } catch (error) {
        console.error(`Error backfilling metadata for recording ${recording.id}:`, error);
      }
    }

    return processed;
  }
}
