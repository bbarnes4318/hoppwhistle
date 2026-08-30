#!/usr/bin/env node
/**
 * What actually happened during a bulk send, from the recorded responses.
 *
 * A run that matches steadily and then stops matching dead is not a run with a
 * poor match rate — it is a run that hit a cap partway through and kept posting
 * afterwards. The distinction matters: every lead posted after the wall is
 * spent for nothing and still enters the buyer's 90-day duplicate window.
 *
 *   docker cp scripts/analyze-send-run.mjs hopwhistle-api-dev:/app/analyze.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/analyze.mjs fe-august-2026
 *
 * Read-only.
 */

import { PrismaClient } from '@prisma/client';

const listName = process.argv[2];
if (!listName) {
  console.error('usage: node analyze.mjs <list name>');
  process.exit(1);
}

const prisma = new PrismaClient();

function bar(n, max, width = 30) {
  return '#'.repeat(Math.round((n / (max || 1)) * width));
}

async function main() {
  const list = await prisma.leadList.findFirst({
    where: { name: { equals: listName, mode: 'insensitive' } },
  });
  if (!list) {
    console.error(`No lead list named "${listName}".`);
    process.exit(1);
  }

  const rows = await prisma.insuranceLeadSubmission.findMany({
    where: { tenantId: list.tenantId, insuranceLead: { listId: list.id }, postedAt: { not: null } },
    select: {
      postedAt: true,
      postStatus: true,
      ameriquotePrice: true,
      ameriquoteResponseStatus: true,
      ameriquoteResponseRaw: true,
    },
    orderBy: { postedAt: 'asc' },
  });

  if (!rows.length) {
    console.log('Nothing has been posted for this list.');
    return;
  }

  console.log(`List "${list.name}" — ${rows.length} posted submission(s)`);
  console.log(`first post  ${rows[0].postedAt?.toISOString()}`);
  console.log(`last post   ${rows[rows.length - 1].postedAt?.toISOString()}\n`);

  // --- Did matching stop? Walk in order and find the last MATCHED. ---
  let lastMatchIndex = -1;
  let matchedTotal = 0;
  rows.forEach((r, i) => {
    if (r.postStatus === 'MATCHED') {
      lastMatchIndex = i;
      matchedTotal += 1;
    }
  });

  console.log(`MATCHED total                 ${matchedTotal}`);
  console.log(`last match at position        ${lastMatchIndex + 1} of ${rows.length}`);
  if (lastMatchIndex >= 0 && lastMatchIndex < rows.length - 1) {
    const after = rows.length - lastMatchIndex - 1;
    console.log(`posted AFTER the last match   ${after}`);
    console.log(`  ^ these bought nothing and still enter the 90-day duplicate window`);
    console.log(`  wall reached at             ${rows[lastMatchIndex].postedAt?.toISOString()}`);
  }

  // --- Match rate in blocks of 250, so a cliff is visible. ---
  console.log('\nmatch rate in order of posting (blocks of 250):');
  const BLOCK = 250;
  for (let i = 0; i < rows.length; i += BLOCK) {
    const block = rows.slice(i, i + BLOCK);
    const m = block.filter(r => r.postStatus === 'MATCHED').length;
    const rate = Math.round((m / block.length) * 100);
    console.log(
      `  ${String(i + 1).padStart(5)}-${String(i + block.length).padEnd(5)} ` +
        `${String(m).padStart(4)}/${String(block.length).padEnd(4)} ` +
        `${String(rate).padStart(3)}%  ${bar(m, BLOCK)}`
    );
  }

  // --- What did the buyer say to the ones that did not match? ---
  const unmatched = rows.filter(r => r.postStatus === 'UNMATCHED');
  console.log(`\nUNMATCHED ${unmatched.length}`);
  if (unmatched.length) {
    const shapes = new Map();
    for (const r of unmatched.slice(0, 2000)) {
      const key = String(r.ameriquoteResponseRaw || '(no body recorded)')
        .replace(/\d{6,}/g, '<n>')
        .slice(0, 180);
      shapes.set(key, (shapes.get(key) || 0) + 1);
    }
    for (const [body, count] of [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${String(count).padStart(5)}  ${body}`);
    }
  }

  // --- Revenue, where the buyer told us a price. ---
  const priced = rows.map(r => parseFloat(r.ameriquotePrice || '')).filter(n => !isNaN(n) && n > 0);
  if (priced.length) {
    const total = priced.reduce((a, b) => a + b, 0);
    console.log(`\nprices returned on ${priced.length} lead(s)`);
    console.log(`  total   $${total.toFixed(2)}`);
    console.log(`  average $${(total / priced.length).toFixed(2)}`);
  } else {
    console.log('\nNo prices were returned on any matched lead.');
  }
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
