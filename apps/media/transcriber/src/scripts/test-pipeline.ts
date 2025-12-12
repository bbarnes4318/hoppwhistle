import crypto from 'crypto';

import { Redis } from 'ioredis';

import { RecordingReadyEvent } from '../types.js';
import { TranscriberWorker } from '../worker.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function runSimulation() {
  console.log('🚀 Starting Transcription Pipeline Simulation...');

  // 1. Start the Node.js Transcriber Worker
  const worker = new TranscriberWorker();
  await worker.start();
  console.log('✅ Node.js Transcriber Worker started');

  // 2. Mock Python Worker (consumes jobs, produces results)
  const mockPythonWorker = async () => {
    console.log('🐍 Mock Python Worker started');
    const pythonRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Create group if not exists
    try {
      await pythonRedis.xgroup(
        'CREATE',
        'jobs:transcription',
        'python-mock-group',
        '0',
        'MKSTREAM'
      );
    } catch (e: any) {
      if (!e.message.includes('BUSYGROUP')) throw e;
    }

    while (true) {
      const messages = await pythonRedis.xreadgroup(
        'GROUP',
        'python-mock-group',
        'mock-consumer',
        'COUNT',
        '1',
        'BLOCK',
        '100',
        'STREAMS',
        'jobs:transcription',
        '>'
      );

      if (!messages || messages.length === 0) continue;

      const [, streamMessages] = messages[0] as [string, Array<[string, string[]]>];

      for (const [messageId, fields] of streamMessages) {
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          fieldMap[fields[i]] = fields[i + 1];
        }

        const job = JSON.parse(fieldMap.payload || '{}');
        console.log(`🐍 Python Worker received job: ${job.jobId} for call ${job.callId}`);

        // Simulate processing time
        await new Promise(r => setTimeout(r, 500));

        // Create mock result
        const result = {
          ok: true,
          jobId: job.jobId,
          callId: job.callId,
          tenantId: job.tenantId,
          engine: 'mock-whisper',
          language: 'en',
          durationSec: 120,
          fullText: 'This is a simulated transcription result from the mock python worker.',
          segments: [
            { start: 0, end: 5, text: 'This is a simulated', speaker: 'SPEAKER_00' },
            { start: 5, end: 10, text: 'transcription result.', speaker: 'SPEAKER_00' },
          ],
          stats: {
            numSegments: 2,
            numWords: 10,
            latencyMs: 500,
          },
          analysis: null,
        };

        // Push result
        await pythonRedis.xadd(
          'jobs:transcription:results',
          '*',
          'payload',
          JSON.stringify(result)
        );
        console.log(`🐍 Python Worker published result for job: ${job.jobId}`);

        // Ack
        await pythonRedis.xack('jobs:transcription', 'python-mock-group', messageId);
      }
    }
  };

  // Start mock python worker in background
  mockPythonWorker().catch(console.error);

  // 3. Simulate Call Processor (Produces recording.ready events)
  const simulateCalls = async (count: number) => {
    console.log(`📞 Simulating ${count} incoming calls...`);

    for (let i = 0; i < count; i++) {
      const callId = `sim-call-${crypto.randomUUID().substring(0, 8)}`;
      const event: RecordingReadyEvent = {
        event: 'recording.ready',
        tenantId: 'tenant-123',
        data: {
          callId,
          recordingUrl: `https://example.com/rec/${callId}.wav`,
          durationSec: 120,
          format: 'wav',
        },
        timestamp: new Date().toISOString(),
      };

      await redis.xadd('events:stream', '*', 'payload', JSON.stringify(event));
      console.log(`📞 Published recording.ready for ${callId}`);
      await new Promise(r => setTimeout(r, 100)); // Stagger slightly
    }
  };

  // 4. Listen for final results
  const startTime = Date.now();
  let completed = 0;
  const totalCalls = 5;

  const subRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  await subRedis.subscribe('transcription.ready');

  subRedis.on('message', (channel: string, message: string) => {
    if (channel === 'transcription.ready') {
      const event = JSON.parse(message);
      console.log(`✅ Received transcription.ready for ${event.data.callId}`);
      completed++;

      if (completed >= totalCalls) {
        const duration = Date.now() - startTime;
        console.log(`\n🎉 Simulation Complete! Processed ${completed} calls in ${duration}ms`);
        process.exit(0);
      }
    }
  });

  // Run simulation
  await simulateCalls(totalCalls);
}

runSimulation().catch(console.error);
