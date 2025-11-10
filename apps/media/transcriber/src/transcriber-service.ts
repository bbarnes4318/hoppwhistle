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
          resolve({
            ok: false,
            error: `Process exited with code ${code}`,
            stage: 'process',
          });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (error) {
          logger.error(`Failed to parse Python output: ${stdout}`);
          resolve({
            ok: false,
            error: 'Failed to parse result',
            stage: 'parse',
          });
        }
      });

      pythonProcess.on('error', (error) => {
        logger.error(`Failed to spawn Python process: ${error}`);
        resolve({
          ok: false,
          error: `Failed to spawn process: ${error.message}`,
          stage: 'spawn',
        });
      });

      // Send job to stdin
      pythonProcess.stdin.write(JSON.stringify(job));
      pythonProcess.stdin.end();

      // Timeout
      const timeout = setTimeout(() => {
        pythonProcess.kill('SIGTERM');
        resolve({
          ok: false,
          error: 'Transcription timeout',
          stage: 'timeout',
        });
      }, this.timeoutMs);
    });
  }
}

