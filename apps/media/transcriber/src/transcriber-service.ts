import { spawn } from 'child_process';

import { logger } from './logger.js';

export interface TranscriptionOptions {
  prefer: 'whisperx' | 'whispercpp';
  fallback: 'whispercpp';
  diarize: boolean;
  model: string;
}

export interface TranscriptionResult {
  ok: boolean;
  engine?: string;
  language?: string;
  durationSec?: number;
  segments?: Array<{
    start: number;
    end: number;
    speaker?: string;
    text: string;
  }>;
  fullText?: string;
  stats?: {
    numSegments: number;
    numWords?: number;
    numChars: number;
  };
  analysis?: {
    billable: string;
    applicationSubmitted: string;
    reasoning: string;
  } | null;
  error?: string;
  stage?: string;
}

export class TranscriberService {
  private pythonBin: string;
  private timeoutMs: number;

  constructor() {
    this.pythonBin = process.env.PYTHON_BIN || 'python';
    this.timeoutMs = parseInt(process.env.PY_SVC_TIMEOUT_MS || '900000', 10); // 15 minutes default
  }

  async transcribe(
    input: {
      recordingUrl: string;
      format?: string;
      options: TranscriptionOptions;
    }
  ): Promise<TranscriptionResult> {
    const job = {
      job: 'transcribe',
      recordingUrl: input.recordingUrl,
      options: input.options,
    };

    return new Promise((resolve, reject) => {
      const pythonProcess = spawn(this.pythonBin, ['-u', 'main.py'], {
        cwd: process.env.PYTHON_WORKDIR || '/app/python',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      /**
       * Finish the job and stop the watchdog that would outlive it.
       *
       * The timeout below used to be assigned and never cleared, so every
       * transcription left a timer pending for the full PY_SVC_TIMEOUT_MS --
       * fifteen minutes by default. A pending timer holds the event loop open,
       * so a worker that had finished its work would not exit promptly and a
       * busy one accumulated a live timer per job. Worse, when the stale timer
       * eventually fired it sent SIGTERM to a PID that had exited long before
       * and that the OS may since have reused.
       *
       * Every path that settles this promise goes through here, so there is one
       * place that has to remember, rather than four.
       */
      let timeout: NodeJS.Timeout | undefined;
      const settle = (result: TranscriptionResult) => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        resolve(result);
      };

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.debug(`Python stderr: ${data.toString()}`);
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          logger.error(`Python process exited with code ${code}`);
          logger.error(`Stderr: ${stderr}`);
          settle({
            ok: false,
            error: `Process exited with code ${code}`,
            stage: 'process',
          });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          settle(result);
        } catch (error) {
          logger.error(`Failed to parse Python output: ${stdout}`);
          settle({
            ok: false,
            error: 'Failed to parse result',
            stage: 'parse',
          });
        }
      });

      pythonProcess.on('error', (error) => {
        logger.error(`Failed to spawn Python process: ${error}`);
        settle({
          ok: false,
          error: `Failed to spawn process: ${error.message}`,
          stage: 'spawn',
        });
      });

      // Send job to stdin
      pythonProcess.stdin.write(JSON.stringify(job));
      pythonProcess.stdin.end();

      // Watchdog. `settle` clears it on every other path, so it only ever
      // fires for a job that really is still running.
      timeout = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        settle({
          ok: false,
          error: 'Transcription timeout',
          stage: 'timeout',
        });
      }, this.timeoutMs);
    });
  }
}

