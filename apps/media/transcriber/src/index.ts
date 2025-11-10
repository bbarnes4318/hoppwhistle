import 'dotenv-flow/config';
import { logger } from './logger.js';
import { TranscriberWorker } from './worker.js';

const worker = new TranscriberWorker();

async function main() {
  try {
    logger.info('Starting transcription worker...');
    await worker.start();
    logger.info('Transcription worker started');
  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down...');
    await worker.stop();
    process.exit(0);
  });
}

main();

