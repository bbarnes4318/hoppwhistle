import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Calls by recordingStatus ---');
  const callGroups = await prisma.call.groupBy({
    by: ['recordingStatus'],
    _count: true,
  });
  console.log(callGroups);

  console.log('\n--- Sample calls with recordings ---');
  const callsWithRecordings = await prisma.call.findMany({
    where: {
      OR: [
        { primaryRecordingId: { not: null } },
        { recordingUrl: { not: null } },
      ],
    },
    take: 5,
    include: {
      recordings: true,
    },
  });

  if (callsWithRecordings.length === 0) {
    console.log('No calls with recordings found.');
  } else {
    for (const call of callsWithRecordings) {
      console.log(`Call ID: ${call.id}`);
      console.log(`  recordingStatus: ${call.recordingStatus}`);
      console.log(`  recordingUrl: ${call.recordingUrl}`);
      console.log(`  primaryRecordingId: ${call.primaryRecordingId}`);
      console.log(`  Recordings count: ${call.recordings.length}`);
      for (const rec of call.recordings) {
        console.log(`    Recording ID: ${rec.id}`);
        console.log(`      status: ${rec.status}`);
        console.log(`      storageKey: ${rec.storageKey}`);
        console.log(`      url: ${rec.url}`);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
