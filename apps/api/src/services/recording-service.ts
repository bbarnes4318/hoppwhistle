import { getPrismaClient } from '../lib/prisma.js';
import { getStorageService } from './storage.js';
import { Readable } from 'stream';

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
   * Upload a recording from FreeSWITCH callback
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
      select: { tenantId: true },
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
        metadata: data.metadata || {},
      },
    });

    // Emit recording.ready event for transcription
    const { eventBus } = await import('./event-bus.js');
    const signedUrl = await storage.getSignedUrl(uploadResult.storageKey, 3600);
    
    await eventBus.publish('recording.*', {
      event: 'recording.ready',
      tenantId: call.tenantId,
      data: {
        callId: data.callId,
        recordingUrl: signedUrl,
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

