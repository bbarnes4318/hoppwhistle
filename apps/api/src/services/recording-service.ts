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

    // Upsert recording record.
    // If there is already a Recording row for this call (e.g. a placeholder from
    // the CDR handler) that is missing its storageKey, update it in-place instead
    // of creating a duplicate row.
    const existingRecording = await this.prisma.recording.findFirst({
      where: {
        callId: data.callId,
        ...(data.legId ? { legId: data.legId } : {}),
        storageKey: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    const recordingData = {
      callId: data.callId,
      legId: data.legId,
      url: uploadResult.url,
      storageKey: uploadResult.storageKey,
      format,
      size: uploadResult.size,
      checksum: uploadResult.checksum,
      duration: data.duration,
      status: 'COMPLETED' as const,
      metadata: (data.metadata || {}) as import('@prisma/client').Prisma.InputJsonValue,
    };

    const recording = existingRecording
      ? await this.prisma.recording.update({
          where: { id: existingRecording.id },
          data: recordingData,
        })
      : await this.prisma.recording.create({ data: recordingData });

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
      include: { call: { select: { id: true } } },
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    if (recording.deletedAt) {
      throw new Error('Recording has been deleted');
    }

    const fs = await import('fs');
    const path = await import('path');

    // Helper: serve a local file if it exists
    const serveLocalFile = (filePath: string) => {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          return {
            stream: fs.createReadStream(filePath),
            contentType: 'audio/wav',
            contentLength: BigInt(stat.size),
          };
        }
      }
      return null;
    };

    // 1. Check if recording.url points to a local file path starting with '/recordings/'
    if (recording.url && recording.url.startsWith('/recordings/')) {
      const result = serveLocalFile(recording.url);
      if (result) return result;
    }

    // 2. Check if the basename exists directly in mounted /recordings directory
    if (recording.url) {
      const baseName = path.basename(recording.url);
      const result = serveLocalFile(path.join('/recordings', baseName));
      if (result) return result;
    }

    // 3. Try the canonical callId-based FreeSWITCH recording path
    const callId = recording.call?.id || recording.callId;
    if (callId) {
      const fsPath = `/recordings/${callId}.wav`;
      const result = serveLocalFile(fsPath);
      if (result) return result;

      const tmpPath = `/tmp/recordings/${callId}.wav`;
      const tmpResult = serveLocalFile(tmpPath);
      if (tmpResult) return tmpResult;
    }

    // 4. Fallback to normal storage service flow if storageKey is present
    if (recording.storageKey) {
      try {
        const storage = getStorageService();
        return await storage.getRecordingStream(recording.storageKey);
      } catch (s3Error) {
        // If S3 fails, check if the file is in local uploads
        const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
        const localFilePath = path.join(localDir, recording.storageKey);
        const result = serveLocalFile(localFilePath);
        if (result) return result;

        if (recording.url && recording.url.includes('/local-stream/')) {
          const decodedKey = decodeURIComponent(recording.url.split('/local-stream/')[1]);
          const fallbackResult = serveLocalFile(path.join(localDir, decodedKey));
          if (fallbackResult) return fallbackResult;
        }

        throw s3Error;
      }
    }

    // 5. No storageKey — try local storage dir with callId pattern
    const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
    if (callId) {
      // Try common date-partitioned patterns in local dir
      const today = new Date();
      for (let daysBack = 0; daysBack < 7; daysBack++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysBack);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const datePath = path.join(localDir, `recordings/${y}/${m}/${dd}/${callId}.wav`);
        const result = serveLocalFile(datePath);
        if (result) return result;
      }
    }

    // 6. If recording.url is an external URL, try to stream from it directly
    if (recording.url && (recording.url.startsWith('http://') || recording.url.startsWith('https://'))) {
      try {
        const response = await fetch(recording.url);
        if (response.ok && response.body) {
          return {
            stream: Readable.fromWeb(response.body as any),
            contentType: response.headers.get('content-type') || 'audio/wav',
          };
        }
      } catch {
        // External URL fetch failed, fall through to error
      }
    }

    throw new Error(
      `Recording file not found. storageKey=${recording.storageKey || 'null'}, url=${recording.url || 'null'}, callId=${callId}`
    );
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
