import { spawn } from 'child_process';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TranscriberService } from '../transcriber-service.js';

vi.mock('child_process');

/**
 * A stand-in for the Python child process, whose events the test drives.
 *
 * ── Why the handlers are captured rather than fired on timers ───────────────
 *
 * This mock used to deliver stdout on a 5ms `setTimeout` and process close on a
 * 10ms one, so the assertions held only while the first timer landed before the
 * second. Nothing enforced that ordering.
 *
 * On 2026-09-21 CI ran this file twice inside one job — `@callfabric/media`
 * had no `include`, so its vitest walked into this package — and reported
 * `✓ (2 tests) 34ms` for one copy and `1 failed` for the other, on the same
 * commit. The failing copy logged `Failed to parse Python output:` with an
 * empty buffer: `close` had run with nothing accumulated, so `JSON.parse('')`
 * threw and the service resolved `{ ok: false, stage: 'parse' }` — which is
 * `expected false to be true` at the first assertion.
 *
 * `transcribe()` registers every listener synchronously inside its Promise
 * executor, so the handlers exist as soon as the call returns and the test can
 * deliver data and close in the order it means. Same assertions, no timing left
 * to lose.
 */
function mockChildProcess() {
  const handlers: {
    stdout?: (data: Buffer) => void;
    stderr?: (data: Buffer) => void;
    close?: (code: number) => void;
  } = {};

  const proc = {
    stdout: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'data') handlers.stdout = handler;
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (data: Buffer) => void) => {
        if (event === 'data') handlers.stderr = handler;
      }),
    },
    stdin: { write: vi.fn(), end: vi.fn() },
    on: vi.fn((event: string, handler: (code: number) => void) => {
      if (event === 'close') handlers.close = handler;
    }),
    kill: vi.fn(),
  };

  return { proc, handlers };
}

describe('TranscriberService', () => {
  let service: TranscriberService;

  beforeEach(() => {
    // `vi.mock` hoists one module mock for the file, so a return value left on
    // `spawn` by one test would otherwise still be there for the next.
    vi.clearAllMocks();
    service = new TranscriberService();
  });

  afterEach(() => {
    // Only one test fakes them, but leaving fake timers installed would change
    // how every test after it behaves.
    vi.useRealTimers();
  });

  it('should parse successful transcription result', async () => {
    const { proc, handlers } = mockChildProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(spawn).mockReturnValue(proc as any);

    const result = {
      ok: true,
      engine: 'whisperx',
      language: 'en',
      durationSec: 120,
      segments: [{ start: 0, end: 5, speaker: 'SPEAKER_00', text: 'Hello' }],
      fullText: 'Hello',
      stats: { numSegments: 1, numWords: 1, numChars: 5 },
    };

    const pending = service.transcribe({
      recordingUrl: 'https://example.com/recording.wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: true,
        model: 'tiny',
      },
    });

    expect(handlers.stdout).toBeDefined();
    expect(handlers.close).toBeDefined();

    // The order the real process produces: output first, then exit.
    handlers.stdout!(Buffer.from(JSON.stringify(result) + '\n'));
    handlers.close!(0);

    const transcription = await pending;

    expect(transcription.ok).toBe(true);
    expect(transcription.engine).toBe('whisperx');
    expect(transcription.fullText).toBe('Hello');
  });

  it('should handle transcription errors', async () => {
    const { proc, handlers } = mockChildProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(spawn).mockReturnValue(proc as any);

    const pending = service.transcribe({
      recordingUrl: 'https://example.com/recording.wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    expect(handlers.close).toBeDefined();

    handlers.close!(1); // Non-zero exit code

    const transcription = await pending;

    expect(transcription.ok).toBe(false);
    expect(transcription.error).toBeDefined();
  });

  /**
   * The watchdog must not outlive the job it watches.
   *
   * `transcribe()` arms a SIGTERM timer for PY_SVC_TIMEOUT_MS -- fifteen
   * minutes by default -- and used to leave it pending after the process had
   * already exited. A pending timer holds the Node event loop open, so a
   * finished worker would not exit promptly and a busy one accumulated one per
   * job; when the stale timer finally fired it signalled a PID that had exited
   * long before and that the OS may since have reused.
   *
   * Fake timers here, because the alternative is a test that waits a quarter of
   * an hour to find out.
   */
  it('clears the timeout once the process has finished', async () => {
    vi.useFakeTimers();

    const { proc, handlers } = mockChildProcess();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(spawn).mockReturnValue(proc as any);

    const pending = service.transcribe({
      recordingUrl: 'https://example.com/recording.wav',
      options: {
        prefer: 'whisperx',
        fallback: 'whispercpp',
        diarize: false,
        model: 'tiny',
      },
    });

    // Armed while the job is in flight -- otherwise this test would pass even
    // if the timeout were deleted outright.
    expect(vi.getTimerCount()).toBe(1);

    handlers.stdout!(Buffer.from(JSON.stringify({ ok: true, fullText: 'Hello' }) + '\n'));
    handlers.close!(0);
    await pending;

    expect(vi.getTimerCount()).toBe(0);

    // Past the full default timeout: nothing left to fire, and no signal sent
    // to a process that exited a quarter of an hour ago.
    vi.advanceTimersByTime(900_000 + 1_000);
    expect(proc.kill).not.toHaveBeenCalled();
  });
});
