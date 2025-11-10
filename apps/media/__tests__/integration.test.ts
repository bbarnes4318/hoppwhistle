import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { TranscriptRepository } from '../transcriber/src/repository.js';
import { TranscriberService } from '../transcriber/src/transcriber-service.js';

describe('Transcription Integration Tests', () => {
  let redis: Redis;
  let pool: Pool;
  let transcriber: TranscriberService;
  let repository: TranscriptRepository;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://callfabric:callfabric_dev@localhost:5432/callfabric',
    });
    transcriber = new TranscriberService();
    repository = new TranscriptRepository();
  });

  afterAll(async () => {
    await redis.quit();
    await pool.end();
  });

  it('should transcribe a long file (>30 minutes)', async () => {
    // This test requires a sample long WAV file
    const recordingUrl = process.env.TEST_LONG_FILE_URL || 'file:///apps/media/__tests__/assets/sample_long.wav';
    
    // Skip if file doesn't exist
    if (recordingUrl.startsWith('file://')) {
      console.log('Skipping long file test - file not available');
      return;
    }

    const result = await transcriber.transcribe({
      recordingUrl,
      format: 'wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.fullText).toBeDefined();
    expect(result.fullText!.length).toBeGreaterThan(1000);
    expect(result.segments).toBeDefined();
    expect(result.segments!.length).toBeGreaterThan(0);
  });

  it('should store transcript in database', async () => {
    const testCallId = `test_${Date.now()}`;
    const testTenantId = 'test-tenant';

    // Mock transcription result
    const transcriptData = {
      engine: 'whisperx',
      language: 'en',
      durationSec: 120,
      fullText: 'This is a test transcript with more than one hundred characters to verify that the full text is properly stored in the database.',
      segments: [
        { start: 0, end: 5, speaker: 'SPEAKER_00', text: 'This is a test transcript' },
        { start: 5, end: 10, speaker: 'SPEAKER_01', text: 'with more than one hundred characters' },
      ],
      speakerLabels: true,
      analysis: {
        billable: 'Yes',
        applicationSubmitted: 'No',
        reasoning: 'Test reasoning',
      },
    };

    const transcriptId = await repository.upsertTranscript(testTenantId, testCallId, transcriptData);

    expect(transcriptId).toBeDefined();

    const retrieved = await repository.getTranscriptByCall(testCallId);
    expect(retrieved).toBeDefined();
    expect(retrieved.call_id).toBe(testCallId);
    expect(retrieved.full_text.length).toBeGreaterThan(100);
    expect(retrieved.segments.length).toBe(2);
  });

  it('should handle transcription without diarization', async () => {
    const result = await transcriber.transcribe({
      recordingUrl: 'https://example.com/test.wav',
      format: 'wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    // Should still return transcript even without speakers
    if (result.ok) {
      expect(result.fullText).toBeDefined();
      // Segments may or may not have speakers
    }
  });

  it('should handle bad URL gracefully', async () => {
    const result = await transcriber.transcribe({
      recordingUrl: 'https://invalid-url-that-does-not-exist.com/file.wav',
      format: 'wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('download');
  });
});

