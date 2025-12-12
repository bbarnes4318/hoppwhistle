import { createHash } from 'crypto';
import { Readable } from 'stream';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // For MinIO compatibility
}

export interface UploadResult {
  storageKey: string;
  size: bigint;
  checksum: string;
  url: string;
}

export class StorageService {
  private s3Client: S3Client;
  private bucket: string;
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
    this.bucket = config.bucket;

    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true, // MinIO requires this
    });
  }

  /**
   * Upload a recording file to S3
   */
  async uploadRecording(
    file: Buffer | Readable,
    callId: string,
    format: string = 'wav',
    metadata?: Record<string, string>
  ): Promise<UploadResult> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    // Storage key: recordings/YYYY/MM/DD/call_id.format
    const storageKey = `recordings/${year}/${month}/${day}/${callId}.${format}`;

    // Convert to buffer if needed
    let body: Buffer;
    if (file instanceof Buffer) {
      body = file;
    } else {
      body = await this.streamToBuffer(file as Readable);
    }

    // Calculate checksum (from buffer)
    const checksum = this.calculateBufferChecksum(body);

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: body,
      ContentType: this.getContentType(format),
      Metadata: metadata || {},
      ChecksumSHA256: checksum,
    });

    await this.s3Client.send(command);

    // Get file size
    const headCommand = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const headResult = await this.s3Client.send(headCommand);
    const size = BigInt(headResult.ContentLength || 0);

    return {
      storageKey,
      size,
      checksum,
      url: this.getPublicUrl(storageKey),
    };
  }

  /**
   * Generate a signed URL for playback (time-bound)
   */
  async getSignedUrl(
    storageKey: string,
    expiresIn: number = 3600 // Default 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });
    return url;
  }

  /**
   * Generate a presigned PUT URL (for browser direct uploads)
   */
  async createPresignedPutUrl(args: {
    storageKey: string;
    contentType: string;
    metadata?: Record<string, string>;
    expiresInSec?: number;
  }): Promise<string> {
    const { storageKey, contentType, metadata, expiresInSec } = args;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType || 'application/octet-stream',
      Metadata: metadata || {},
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSec ?? 900 });
    return url;
  }

  /**
   * Get a streaming URL for playback
   */
  async getStreamUrl(storageKey: string): Promise<string> {
    // For streaming, use a longer expiration (24 hours)
    return this.getSignedUrl(storageKey, 86400);
  }

  /**
   * Check if a recording exists
   */
  async exists(storageKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get recording metadata
   */
  async getMetadata(storageKey: string): Promise<{
    size: bigint;
    contentType: string;
    lastModified: Date;
    checksum?: string;
  }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const result = await this.s3Client.send(command);

    return {
      size: BigInt(result.ContentLength || 0),
      contentType: result.ContentType || 'application/octet-stream',
      lastModified: result.LastModified || new Date(),
      checksum: result.ChecksumSHA256,
    };
  }

  /**
   * Move recording to warm storage (different storage class)
   */
  async moveToWarmStorage(storageKey: string): Promise<void> {
    // Copy object with new storage class
    // Note: S3 doesn't support moving, so we copy and delete
    // For simplicity, we'll use metadata to track tier
    // In production, use S3 lifecycle policies or copy with different storage class
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.s3Client.send(command);

    // Update metadata to mark as warm
    // In production, use S3 copy with storage class change
    // For now, we'll track this in the database
  }

  /**
   * Delete a recording
   */
  async deleteRecording(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * Calculate SHA256 checksum of a buffer
   */
  private calculateBufferChecksum(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('base64');
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Get content type for format
   */
  private getContentType(format: string): string {
    const contentTypes: Record<string, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      opus: 'audio/opus',
      ogg: 'audio/ogg',
    };
    return contentTypes[format.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Get public URL (if bucket is public)
   */
  private getPublicUrl(storageKey: string): string {
    if (this.config.endpoint) {
      // MinIO or custom endpoint
      return `${this.config.endpoint}/${this.bucket}/${storageKey}`;
    }
    // AWS S3
    return `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/${storageKey}`;
  }
}

// Singleton instance
let storageService: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageService) {
    const config: StorageConfig = {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || 'recordings',
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    };

    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 credentials not configured');
    }

    storageService = new StorageService(config);
  }

  return storageService;
}
