#!/usr/bin/env tsx
/**
 * CLI tool to backfill recording metadata
 * Usage: tsx src/cli/backfill-recordings.ts [--limit=100] [--recording-id=xxx]
 */

import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';
import { RecordingService } from '../services/recording-service.js';

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith('--limit='));
  const recordingIdArg = args.find((arg) => arg.startsWith('--recording-id='));
  const helpArg = args.includes('--help') || args.includes('-h');

  if (helpArg) {
    console.log(`
Usage: tsx src/cli/backfill-recordings.ts [options]

Options:
  --limit=N          Process N recordings at a time (default: 100)
  --recording-id=ID  Backfill specific recording by ID
  --help, -h         Show this help message

Examples:
  tsx src/cli/backfill-recordings.ts
  tsx src/cli/backfill-recordings.ts --limit=50
  tsx src/cli/backfill-recordings.ts --recording-id=abc-123-def
`);
    process.exit(0);
  }

  const recordingService = new RecordingService();
  const prisma = getPrismaClient();

  try {
    if (recordingIdArg) {
      // Backfill specific recording
      const recordingId = recordingIdArg.split('=')[1];
      console.log(`Backfilling metadata for recording: ${recordingId}`);

      await recordingService.backfillMetadata(recordingId);

      const recording = await prisma.recording.findUnique({
        where: { id: recordingId },
      });

      console.log('✓ Metadata backfilled successfully');
      console.log(`  Size: ${recording?.size?.toString() || 'N/A'} bytes`);
      console.log(`  Checksum: ${recording?.checksum || 'N/A'}`);
    } else {
      // Backfill all recordings missing metadata
      const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;
      console.log(`Backfilling metadata for up to ${limit} recordings...`);

      let totalProcessed = 0;
      let batchProcessed = 0;

      do {
        batchProcessed = await recordingService.backfillAllMetadata(limit);
        totalProcessed += batchProcessed;

        if (batchProcessed > 0) {
          console.log(`Processed ${batchProcessed} recordings (total: ${totalProcessed})`);
        }
      } while (batchProcessed > 0);

      console.log(`\n✓ Completed! Total recordings processed: ${totalProcessed}`);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

