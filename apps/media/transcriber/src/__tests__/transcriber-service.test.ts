import { spawn } from 'child_process';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TranscriberService } from '../transcriber-service.js';

vi.mock('child_process');

describe('TranscriberService', () => {
  let service: TranscriberService;

  beforeEach(() => {
    service = new TranscriberService();
  });

  it('should parse successful transcription result', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
      }),
      kill: vi.fn(),
    };

    mockSpawn.mockReturnValue(mockProcess as any);

    // Mock stdout data
    const result = {
      ok: true,
      engine: 'whisperx',
      language: 'en',
      durationSec: 120,
      segments: [
        { start: 0, end: 5, speaker: 'SPEAKER_00', text: 'Hello' },
      ],
      fullText: 'Hello',
      stats: { numSegments: 1, numWords: 1, numChars: 5 },
    };

    let stdoutHandler: (data: Buffer) => void;
    mockProcess.stdout.on.mockImplementation((event, handler) => {
      if (event === 'data') {
        stdoutHandler = handler;
        setTimeout(() => {
          handler(Buffer.from(JSON.stringify(result) + '\n'));
        }, 5);
      }
    });

    const transcription = await service.transcribe({
      recordingUrl: 'https://example.com/recording.wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: true,
        model: 'tiny',
      },
    });

    expect(transcription.ok).toBe(true);
    expect(transcription.engine).toBe('whisperx');
    expect(transcription.fullText).toBe('Hello');
  });

  it('should handle transcription errors', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => handler(1), 10); // Non-zero exit code
        }
      }),
      kill: vi.fn(),
    };

    mockSpawn.mockReturnValue(mockProcess as any);

    const transcription = await service.transcribe({
      recordingUrl: 'https://example.com/recording.wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    expect(transcription.ok).toBe(false);
    expect(transcription.error).toBeDefined();
  });
});

