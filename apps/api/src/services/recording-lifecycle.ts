import { RecordingStorageTier } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

import { getStorageService } from './storage.js';

export interface LifecyclePolicy {
  tenantId: string;
  hotToWarmDays: number; // Days before moving to warm storage
  warmToColdDays: number; // Days before moving to cold storage
  retentionDays: number; // Days before deletion
  enabled: boolean;
}

export class RecordingLifecycleService {
  private prisma = getPrismaClient();

  /**
   * Process lifecycle for a recording
   */
  async processLifecycle(recordingId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
      include: { call: true },
    });

    if (!recording || recording.status !== 'COMPLETED') {
      return;
    }

    // Get tenant lifecycle policy
    const policy = await this.getLifecyclePolicy(recording.call.tenantId);

    if (!policy || !policy.enabled) {
      return;
    }

    const ageInDays = this.getAgeInDays(recording.createdAt);

    // Move to warm storage
    if (
      recording.storageTier === 'HOT' &&
      ageInDays >= policy.hotToWarmDays &&
      !recording.movedToWarmAt
    ) {
      await this.moveToWarm(recordingId, recording.storageKey);
    }

    // Move to cold storage (if implemented)
    if (
      recording.storageTier === 'WARM' &&
      ageInDays >= policy.hotToWarmDays + policy.warmToColdDays
    ) {
      await this.moveToCold(recordingId, recording.storageKey);
    }

    // Schedule deletion
    if (ageInDays >= policy.retentionDays && !recording.scheduledDeletionAt) {
      const deletionDate = new Date(recording.createdAt);
      deletionDate.setDate(deletionDate.getDate() + policy.retentionDays);

      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          scheduledDeletionAt: deletionDate,
        },
      });
    }

    // Delete if scheduled
    if (
      recording.scheduledDeletionAt &&
      new Date() >= recording.scheduledDeletionAt &&
      !recording.deletedAt
    ) {
      await this.deleteRecording(recordingId, recording.storageKey);
    }
  }

  /**
   * Process all recordings that need lifecycle updates
   */
  async processAllRecordings(limit: number = 100): Promise<number> {
    const recordings = await this.prisma.recording.findMany({
      where: {
        status: 'COMPLETED',
        deletedAt: null,
      },
      take: limit,
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        call: true,
      },
    });

    let processed = 0;
    for (const recording of recordings) {
      try {
        await this.processLifecycle(recording.id);
        processed++;
      } catch (error) {
        console.error(`Error processing lifecycle for recording ${recording.id}:`, error);
      }
    }

    return processed;
  }

  /**
   * Move recording to warm storage
   */
  private async moveToWarm(recordingId: string, storageKey: string | null): Promise<void> {
    if (!storageKey) {
      return;
    }

    const storage = getStorageService();
    
    try {
      // In production, use S3 copy with storage class change
      // For now, we'll just update the database
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          storageTier: 'WARM',
          movedToWarmAt: new Date(),
        },
      });
    } catch (error) {
      console.error(`Error moving recording ${recordingId} to warm storage:`, error);
      throw error;
    }
  }

  /**
   * Move recording to cold storage
   */
  private async moveToCold(recordingId: string, storageKey: string | null): Promise<void> {
    if (!storageKey) {
      return;
    }

    try {
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          storageTier: 'COLD',
        },
      });
    } catch (error) {
      console.error(`Error moving recording ${recordingId} to cold storage:`, error);
      throw error;
    }
  }

  /**
   * Delete a recording
   */
  private async deleteRecording(recordingId: string, storageKey: string | null): Promise<void> {
    if (!storageKey) {
      // Mark as deleted even if no storage key
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          deletedAt: new Date(),
        },
      });
      return;
    }

    const storage = getStorageService();

    try {
      // Delete from storage
      await storage.deleteRecording(storageKey);

      // Mark as deleted in database
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: {
          deletedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(`Error deleting recording ${recordingId}:`, error);
      throw error;
    }
  }

  /**
   * Get lifecycle policy for tenant
   */
  private async getLifecyclePolicy(tenantId: string): Promise<LifecyclePolicy | null> {
    // In production, store policies in database
    // For now, use defaults or environment variables
    const defaultPolicy: LifecyclePolicy = {
      tenantId,
      hotToWarmDays: parseInt(process.env.RECORDING_HOT_TO_WARM_DAYS || '30', 10),
      warmToColdDays: parseInt(process.env.RECORDING_WARM_TO_COLD_DAYS || '90', 10),
      retentionDays: parseInt(process.env.RECORDING_RETENTION_DAYS || '365', 10),
      enabled: process.env.RECORDING_LIFECYCLE_ENABLED !== 'false',
    };

    return defaultPolicy;
  }

  /**
   * Calculate age in days
   */
  private getAgeInDays(date: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}

