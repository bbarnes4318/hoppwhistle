import { spawn } from 'child_process';

import { Redis } from 'ioredis';

import { logger } from './logger.js';
import { TranscriptRepository } from './repository.js';
import { TranscriberService } from './transcriber-service.js';
import { RecordingReadyEvent, TranscriptionReadyEvent } from './types.js';

export class TranscriberWorker {
  private redis: Redis;
  private transcriber: TranscriberService;
  private repository: TranscriptRepository;
  private isRunning = false;
  private activeJobs = new Map<string, Promise<void>>();
  private maxConcurrency: number;
  private maxDurationSec: number;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
    
    this.transcriber = new TranscriberService();
    this.repository = new TranscriptRepository();
    
    this.maxConcurrency = parseInt(process.env.TRANSCRIBE_MAX_CONCURRENCY || '2', 10);
    this.maxDurationSec = parseInt(process.env.TRANSCRIBE_MAX_DURATION_SEC || '7200', 10);
  }

  async start(): Promise<void> {
    this.isRunning = true;
    
    // Initialize consumer group
    try {
      await this.redis.xgroup('CREATE', 'events:stream', 'transcriber-group', '0', 'MKSTREAM');
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) {
        throw err;
      }
    }

    // Start consuming events
    this.consumeEvents();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Wait for active jobs to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeJobs.size > 0 && Date.now() - startTime < timeout) {
      await Promise.race(Array.from(this.activeJobs.values()));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.redis.quit();
  }

  private async consumeEvents(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check concurrency limit
        if (this.activeJobs.size >= this.maxConcurrency) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // Read from stream
        const messages = await this.redis.xreadgroup(
          'GROUP',
          'transcriber-group',
          'transcriber-worker',
          'COUNT',
          '1',
          'BLOCK',
          '1000',
          'STREAMS',
          'events:stream',
          '>'
        );

        if (!messages || messages.length === 0) {
          continue;
        }

        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];
        
        for (const [messageId, fields] of streamMessages) {
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          const payload = JSON.parse(fieldMap.payload || '{}');
          
          // Check if this is a recording.ready event
          if (payload.event === 'recording.ready') {
            const event = payload as RecordingReadyEvent;
            
            // Check idempotency
            const idempotencyKey = `transcribe:${event.data.callId}`;
            const existing = await this.redis.get(idempotencyKey);
            if (existing) {
              logger.info(`Skipping duplicate transcription for call ${event.data.callId}`);
              await this.redis.xack('events:stream', 'transcriber-group', messageId);
              continue;
            }

            // Process in background
            const jobPromise = this.processRecording(event, messageId);
            this.activeJobs.set(event.data.callId, jobPromise);
            
            jobPromise.finally(() => {
              this.activeJobs.delete(event.data.callId);
            });
          } else {
            // Not our event, acknowledge and skip
            await this.redis.xack('events:stream', 'transcriber-group', messageId);
          }
        }
      } catch (error) {
        logger.error('Error consuming events:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processRecording(
    event: RecordingReadyEvent,
    messageId: string
  ): Promise<void> {
    const startTime = Date.now();
    const idempotencyKey = `transcribe:${event.data.callId}`;
    
    try {
      // Set idempotency key (expires in 24 hours)
      await this.redis.setex(idempotencyKey, 86400, '1');

      // Check duration limit
      const durationSec = event.data.durationSec || 0;
      if (durationSec > this.maxDurationSec) {
        logger.warn(`Recording too long: ${durationSec}s (max: ${this.maxDurationSec}s)`);
        await this.redis.xack('events:stream', 'transcriber-group', messageId);
        return;
      }

      logger.info(`Processing transcription for call ${event.data.callId}`);

      // Transcribe
      const result = await this.transcriber.transcribe({
        recordingUrl: event.data.recordingUrl,
        format: event.data.format,
        options: {
          prefer: process.env.TRANSCRIBE_ENGINE_PREF || 'whisperx',
          fallback: 'whispercpp',
          diarize: true,
          model: 'tiny',
        },
      });

      if (!result.ok) {
        throw new Error(`Transcription failed: ${result.error} (stage: ${result.stage})`);
      }

      // Store in database
      const transcriptId = await this.repository.upsertTranscript(
        event.tenantId,
        event.data.callId,
        {
          engine: result.engine,
          language: result.language || 'en',
          durationSec: result.durationSec,
          fullText: result.fullText,
          segments: result.segments,
          speakerLabels: result.segments.some((s: any) => s.speaker),
          analysis: result.analysis,
        }
      );

      // Calculate stats
      const latencyMs = Date.now() - startTime;
      const stats = {
        segments: result.stats.numSegments,
        words: result.stats.numWords || result.fullText.split(/\s+/).length,
        speakerLabels: result.segments.some((s: any) => s.speaker),
        latencyMs,
      };

      // Emit transcription.ready event
      const transcriptionEvent: TranscriptionReadyEvent = {
        event: 'transcription.ready',
        tenantId: event.tenantId,
        data: {
          callId: event.data.callId,
          transcriptId,
          stats,
        },
      };

      await this.redis.xadd(
        'events:stream',
        '*',
        'channel',
        'recording.*',
        'payload',
        JSON.stringify(transcriptionEvent)
      );

      // Also publish to pub/sub
      await this.redis.publish('transcription.ready', JSON.stringify(transcriptionEvent));

      logger.info(`Transcription completed for call ${event.data.callId} (${latencyMs}ms)`);

      // Acknowledge message
      await this.redis.xack('events:stream', 'transcriber-group', messageId);
    } catch (error) {
      logger.error(`Error processing transcription for call ${event.data.callId}:`, error);
      
      // Retry logic (simple exponential backoff)
      const retryCount = await this.redis.incr(`${idempotencyKey}:retries`);
      if (retryCount < 3) {
        const backoffMs = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
        logger.info(`Retrying transcription (attempt ${retryCount}/3) after ${backoffMs}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        // Re-queue by not acknowledging
      } else {
        logger.error(`Max retries exceeded for call ${event.data.callId}`);
        await this.redis.xack('events:stream', 'transcriber-group', messageId);
      }
    }
  }
}

