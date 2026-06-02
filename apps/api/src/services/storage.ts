import { createHash } from 'crypto';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';

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
  private s3Client?: S3Client;
  private bucket: string;
  private config: StorageConfig;
  private isLocal = false;
  private localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';

  constructor(config: StorageConfig) {
    this.config = config;
    this.bucket = config.bucket;

    if (!config.accessKeyId || !config.secretAccessKey) {
      this.isLocal = true;
      // Ensure local directory exists
      if (!fs.existsSync(this.localDir)) {
        fs.mkdirSync(this.localDir, { recursive: true });
      }
      return;
    }

    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true, // MinIO requires this
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 2000,
        socketTimeout: 3000,
      }),
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

    if (this.isLocal) {
      const filePath = path.join(this.localDir, storageKey);
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, body);

      return {
        storageKey,
        size: BigInt(body.length),
        checksum,
        url: `/api/v1/recordings/local-stream/${encodeURIComponent(storageKey)}`,
      };
    }

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: body,
      ContentType: this.getContentType(format),
      Metadata: metadata || {},
      ChecksumSHA256: checksum,
    });

    try {
      if (!this.s3Client) {
        throw new Error('S3 Client not initialized');
      }

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
    } catch (s3Error) {
      console.warn('S3 upload failed, falling back to local storage:', s3Error);

      const filePath = path.join(this.localDir, storageKey);
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, body);

      return {
        storageKey,
        size: BigInt(body.length),
        checksum,
        url: `/api/v1/recordings/local-stream/${encodeURIComponent(storageKey)}`,
      };
    }
  }

  /**
   * Generate a signed URL for playback (time-bound)
   */
  async getSignedUrl(
    storageKey: string,
    expiresIn: number = 3600 // Default 1 hour
  ): Promise<string> {
    const localFilePath = path.join(this.localDir, storageKey);
    if (this.isLocal || fs.existsSync(localFilePath)) {
      return `/api/v1/recordings/local-stream/${encodeURIComponent(storageKey)}`;
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

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
    if (this.isLocal) {
      return `/api/v1/recordings/local-stream/${encodeURIComponent(args.storageKey)}`;
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

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
   * Get a readable stream for a recording
   */
  async getRecordingStream(storageKey: string): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: bigint;
  }> {
    const localFilePath = path.join(this.localDir, storageKey);
    if (this.isLocal || fs.existsSync(localFilePath)) {
      if (!fs.existsSync(localFilePath)) {
        throw new Error('Recording file not found locally');
      }
      const stat = fs.statSync(localFilePath);
      const stream = fs.createReadStream(localFilePath);
      return {
        stream,
        contentType: this.getContentType(path.extname(storageKey).slice(1)),
        contentLength: BigInt(stat.size),
      };
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error('S3 object body is empty');
    }

    return {
      stream: response.Body as Readable,
      contentType: response.ContentType || 'audio/wav',
      contentLength: response.ContentLength ? BigInt(response.ContentLength) : undefined,
    };
  }

  /**
   * Check if a recording exists
   */
  async exists(storageKey: string): Promise<boolean> {
    const localFilePath = path.join(this.localDir, storageKey);
    if (this.isLocal || fs.existsSync(localFilePath)) {
      return true;
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

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
    const localFilePath = path.join(this.localDir, storageKey);
    if (this.isLocal || fs.existsSync(localFilePath)) {
      if (!fs.existsSync(localFilePath)) {
        throw new Error('Recording file not found locally');
      }
      const stat = fs.statSync(localFilePath);
      return {
        size: BigInt(stat.size),
        contentType: this.getContentType(path.extname(storageKey).slice(1)),
        lastModified: stat.mtime,
        checksum: this.calculateBufferChecksum(fs.readFileSync(localFilePath)),
      };
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

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
    if (this.isLocal) {
      return;
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * Delete a recording
   */
  async deleteRecording(storageKey: string): Promise<void> {
    if (this.isLocal) {
      const filePath = path.join(this.localDir, storageKey);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    if (!this.s3Client) {
      throw new Error('S3 Client not initialized');
    }

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

    storageService = new StorageService(config);
  }

  return storageService;
}
