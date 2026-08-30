#!/usr/bin/env node
/**
 * Reclassify submissions the buyer accepted for manual approval but which were
 * recorded as ERROR by the old response parser.
 *
 * Boberdoo answers some posts with "Lead ID <n> has to be manually approved."
 * The parser only understood Matched/Unmatched/Error, so those landed on ERROR
 * — which is a re-sendable status. Re-running a bulk send would post an
 * already-accepted lead a second time, the buyer would reject it as a 90-day
 * duplicate, and the lead would be unsellable for good.
 *
 * This moves them to MANUAL_REVIEW (never re-sent) and recovers the lead id
 * from the recorded response.
 *
 *   docker cp scripts/repair-manual-review-submissions.mjs hopwhistle-api-dev:/app/repair.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/repair.mjs            # dry run
 *   docker exec -u root hopwhistle-api-dev node /app/repair.mjs --apply
 *
 * Identifies rows only by what the buyer actually said, so it cannot touch a
 * genuine failure. Safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

const PATTERN = /Lead ID\s+(\d+)\s+has to be manually approved/i;

function findLeadId(row) {
  for (const source of [
    row.ameriquoteResponseRaw,
    row.ameriquoteErrorMessage,
    row.ameriquoteResponseStatus,
  ]) {
    const hit = source ? PATTERN.exec(String(source)) : null;
    if (hit) return hit[1];
  }
  return null;
}

async function main() {
  const candidates = await prisma.insuranceLeadSubmission.findMany({
    where: {
      postStatus: 'ERROR',
      OR: [
        { ameriquoteResponseStatus: { contains: 'has to be manually approved' } },
        { ameriquoteErrorMessage: { contains: 'has to be manually approved' } },
        { ameriquoteResponseRaw: { contains: 'has to be manually approved' } },
      ],
    },
    select: {
      id: true,
      ameriquoteLeadId: true,
      ameriquoteResponseStatus: true,
      ameriquoteErrorMessage: true,
      ameriquoteResponseRaw: true,
    },
  });

  if (!candidates.length) {
    console.log('Nothing to repair — no ERROR rows carry a manual-approval response.');
    return;
  }

  console.log(`${candidates.length} submission(s) were accepted for manual approval but`);
  console.log('are recorded as ERROR, which makes them eligible to be posted again.\n');

  let withId = 0;
  const updates = [];

  for (const row of candidates) {
    // Search every field that could carry it. Picking the first non-empty one
    // reads "Unknown" out of the status column and misses the id sitting in
    // the error message — and the update below then blanks that message.
    const leadId = row.ameriquoteLeadId || findLeadId(row);
    if (leadId) withId += 1;
    updates.push({ id: row.id, leadId });
  }

  console.log(`  ${withId} carry a recoverable buyer lead id`);
  console.log(`  ${candidates.length - withId} do not (status will still be corrected)\n`);

  if (!apply) {
    console.log('DRY RUN — nothing changed. Re-run with --apply to write.');
    console.log('Sample:');
    for (const u of updates.slice(0, 5)) {
      console.log(`  ${u.id}  ->  MANUAL_REVIEW  leadId=${u.leadId ?? '(none)'}`);
    }
    return;
  }

  let done = 0;
  for (const u of updates) {
    await prisma.insuranceLeadSubmission.update({
      where: { id: u.id },
      data: {
        postStatus: 'MANUAL_REVIEW',
        ameriquoteResponseStatus: 'ManualReview',
        // Only clear the message once its lead id is safely stored. Blanking
        // it first destroys the only copy when extraction has failed.
        ...(u.leadId ? { ameriquoteLeadId: u.leadId, ameriquoteErrorMessage: null } : {}),
      },
    });
    done += 1;
    if (done % 50 === 0) console.log(`  repaired ${done}/${updates.length}`);
  }

  console.log(`\nRepaired ${done} submission(s). They will not be re-sent.`);
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
