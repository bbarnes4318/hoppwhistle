#!/usr/bin/env node
/**
 * Recover the buyer's lead ids for MANUAL_REVIEW submissions that lost them.
 *
 * repair-manual-review-submissions.mjs chose its text with
 *   ameriquoteResponseStatus || ameriquoteErrorMessage || ameriquoteResponseRaw
 * which takes the first truthy field rather than the one carrying the id. The
 * status field held "Unknown", so the pattern matched nothing while the real
 * "Lead ID <n> has to be manually approved." sat in the error message — which
 * the same update then set to null.
 *
 * The raw response body was never modified, so the ids are still there. This
 * reads them back out.
 *
 *   docker cp scripts/recover-manual-review-lead-ids.mjs hopwhistle-api-dev:/app/recover.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/recover.mjs            # dry run
 *   docker exec -u root hopwhistle-api-dev node /app/recover.mjs --apply
 *
 * Only ever fills a missing id. Never overwrites one that is already set, and
 * never touches any other field.
 */

import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

const PATTERN = /Lead ID\s+(\d+)\s+has to be manually approved/i;

/** Search every field that could hold it, not just the first non-empty one. */
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
  const rows = await prisma.insuranceLeadSubmission.findMany({
    where: { postStatus: 'MANUAL_REVIEW', ameriquoteLeadId: null },
    select: {
      id: true,
      ameriquoteResponseRaw: true,
      ameriquoteErrorMessage: true,
      ameriquoteResponseStatus: true,
      insuranceLead: { select: { phone: true } },
    },
  });

  if (!rows.length) {
    console.log('No MANUAL_REVIEW submissions are missing a buyer lead id.');
    return;
  }

  const found = [];
  const lost = [];
  for (const row of rows) {
    const leadId = findLeadId(row);
    if (leadId) found.push({ id: row.id, leadId, phone: row.insuranceLead.phone });
    else lost.push(row);
  }

  console.log(`${rows.length} MANUAL_REVIEW submission(s) have no buyer lead id.`);
  console.log(`  ${found.length} recoverable from the recorded response`);
  console.log(`  ${lost.length} not recoverable — no response body retained\n`);

  if (!found.length) {
    console.log('Nothing to recover.');
    return;
  }

  if (!apply) {
    console.log('DRY RUN — nothing changed. Re-run with --apply to write.');
    console.log('Sample:');
    for (const f of found.slice(0, 5)) console.log(`  ${f.phone}  ->  lead id ${f.leadId}`);
    return;
  }

  let done = 0;
  for (const f of found) {
    await prisma.insuranceLeadSubmission.update({
      where: { id: f.id },
      data: { ameriquoteLeadId: f.leadId },
    });
    done += 1;
    if (done % 50 === 0) console.log(`  recovered ${done}/${found.length}`);
  }

  console.log(`\nRecovered ${done} buyer lead id(s).`);
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
