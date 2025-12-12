import crypto from 'crypto';

import { Redis } from 'ioredis';

import { logger } from './logger.js';
import { TranscriptRepository } from './repository.js';
import { RecordingReadyEvent, TranscriptionReadyEvent } from './types.js';

export class TranscriberWorker {
  private redis: Redis;
  private repository: TranscriptRepository;
  private isRunning = false;
  private activeJobs = new Map<string, Promise<void>>();
  private maxConcurrency: number;
  private maxDurationSec: number;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);

    this.repository = new TranscriptRepository();

    this.maxConcurrency = parseInt(process.env.TRANSCRIBE_MAX_CONCURRENCY || '2', 10);
    this.maxDurationSec = parseInt(process.env.TRANSCRIBE_MAX_DURATION_SEC || '7200', 10);
  }

  async start(): Promise<void> {
    this.isRunning = true;

    // Initialize consumer groups
    try {
      await this.redis.xgroup('CREATE', 'events:stream', 'transcriber-group', '0', 'MKSTREAM');
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) throw err;
    }

    try {
      await this.redis.xgroup(
        'CREATE',
        'jobs:transcription:results',
        'result-group',
        '0',
        'MKSTREAM'
      );
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) throw err;
    }

    // Start consuming events and results
    this.consumeEvents();
    this.consumeResults();
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

            // Enqueue job
            await this.enqueueTranscriptionJob(event, messageId);
          } else {
            await this.redis.xack('events:stream', 'transcriber-group', messageId);
          }
        }
      } catch (error) {
        logger.error('Error consuming events:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async enqueueTranscriptionJob(
    event: RecordingReadyEvent,
    messageId: string
  ): Promise<void> {
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

      logger.info(`Enqueuing transcription job for call ${event.data.callId}`);

      const jobPayload = {
        jobId: crypto.randomUUID(),
        callId: event.data.callId,
        tenantId: event.tenantId,
        recordingUrl: event.data.recordingUrl,
        settings: {
          prefer: process.env.TRANSCRIBE_ENGINE_PREF || 'whisperx',
          fallback: 'whispercpp',
          diarize: true,
          model: 'tiny',
          language: 'en',
        },
        originalMessageId: messageId,
      };

      await this.redis.xadd('jobs:transcription', '*', 'payload', JSON.stringify(jobPayload));

      // Acknowledge the recording.ready event
      await this.redis.xack('events:stream', 'transcriber-group', messageId);
    } catch (error) {
      logger.error(`Error enqueuing transcription for call ${event.data.callId}:`, error);
    }
  }

  private async consumeResults(): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.redis.xreadgroup(
          'GROUP',
          'result-group',
          'result-worker',
          'COUNT',
          '1',
          'BLOCK',
          '1000',
          'STREAMS',
          'jobs:transcription:results',
          '>'
        );

        if (!messages || messages.length === 0) continue;

        const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];

        for (const [messageId, fields] of streamMessages) {
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            fieldMap[fields[i]] = fields[i + 1];
          }

          const result = JSON.parse(fieldMap.payload || '{}');
          await this.processResult(result, messageId);
        }
      } catch (error) {
        logger.error('Error consuming results:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processResult(result: any, messageId: string): Promise<void> {
    try {
      logger.info(`Processing transcription result for call ${result.callId}`);

      if (!result.ok) {
        logger.error(`Transcription failed for call ${result.callId}: ${result.error}`);
        // Handle failure
        await this.redis.xack('jobs:transcription:results', 'result-group', messageId);
        return;
      }

      // Store in database
      const transcriptId = await this.repository.upsertTranscript(result.tenantId, result.callId, {
        engine: result.engine,
        language: result.language || 'en',
        durationSec: result.durationSec,
        fullText: result.fullText,
        segments: result.segments,
        speakerLabels: result.segments.some((s: any) => s.speaker),
        analysis: result.analysis,
      });

      // Calculate stats
      const stats = {
        segments: result.stats.numSegments,
        words: result.stats.numWords || (result.fullText ? result.fullText.split(/\s+/).length : 0),
        speakerLabels: result.segments.some((s: any) => s.speaker),
        latencyMs: result.latencyMs || 0,
      };

      // Emit transcription.ready event
      const transcriptionEvent: any = {
        event: 'transcription.ready',
        tenantId: result.tenantId,
        data: {
          callId: result.callId,
          transcriptId,
          stats,
          fullText: result.fullText || '',
          segments: result.segments || [],
          language: result.language || 'en',
          durationSec: result.durationSec || 0,
          engine: result.engine || null,
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

      await this.redis.publish('transcription.ready', JSON.stringify(transcriptionEvent));

      logger.info(`Transcription completed and saved for call ${result.callId}`);

      await this.redis.xack('jobs:transcription:results', 'result-group', messageId);
    } catch (error) {
      logger.error(`Error processing result for call ${result.callId}:`, error);
    }
  }
}
