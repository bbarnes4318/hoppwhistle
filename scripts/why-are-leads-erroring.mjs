#!/usr/bin/env node
/**
 * Show exactly what the buyer said about every lead that did not sell.
 *
 * A bulk send reports how many failed but the counts alone never say why. This
 * reads the recorded responses straight from the submission rows: the grouped
 * reasons first, then a line per lead so a specific one can be chased down,
 * then one raw response verbatim in case the parsed message lost detail.
 *
 *   docker cp scripts/why-are-leads-erroring.mjs hopwhistle-api-dev:/app/why.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/why.mjs                 # lists your lists
 *   docker exec -u root hopwhistle-api-dev node /app/why.mjs fe-august-2026  # one list
 *   docker exec -u root hopwhistle-api-dev node /app/why.mjs fe-august-2026 --all
 *
 * Read-only. Posts nothing, changes nothing.
 */

import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2).filter(a => a !== '--all');
const showEveryLead = process.argv.includes('--all');
const listName = args[0];

const prisma = new PrismaClient();

/** Statuses that mean the lead is not with the buyer. */
const FAILED_STATUSES = ['ERROR', 'UNMATCHED', 'SKIPPED', 'PENDING'];

/** Collapse ids/phones/timestamps so the same complaint groups as one. */
function shape(message) {
  return String(message || '')
    .replace(/\b\d{10,}\b/g, '<number>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+/g, '<timestamp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * The parsed message is empty on rows written before the parser learned to
 * keep the body, so fall back through everything that might hold the reason.
 */
function reasonFor(row) {
  const parsed = shape(row.ameriquoteErrorMessage);
  if (parsed) return parsed;

  const raw = shape(row.ameriquoteResponseRaw);
  if (raw) return `(no parsed message) raw: ${raw}`;

  if (row.postStatus === 'PENDING') return '(never got a reply — post timed out or was cut off)';
  if (row.postStatus === 'SKIPPED') return '(never sent — failed our own validation)';
  return `(nothing recorded; status ${row.ameriquoteResponseStatus || row.postStatus})`;
}

async function listTheLists() {
  const lists = await prisma.leadList.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { name: true, createdAt: true },
  });

  if (!lists.length) {
    console.error('No lead lists exist yet.');
    return;
  }

  console.error('usage: node why.mjs <list name> [--all]\n\nrecent lists:');
  for (const list of lists) {
    console.error(`  ${list.createdAt.toISOString().slice(0, 10)}  ${list.name}`);
  }
}

async function main() {
  if (!listName) {
    await listTheLists();
    process.exitCode = 1;
    return;
  }

  const list = await prisma.leadList.findFirst({
    where: { name: { equals: listName, mode: 'insensitive' } },
  });
  if (!list) {
    console.error(`No lead list named "${listName}".\n`);
    await listTheLists();
    process.exitCode = 1;
    return;
  }

  const where = { tenantId: list.tenantId, insuranceLead: { listId: list.id } };

  const byStatus = await prisma.insuranceLeadSubmission.groupBy({
    by: ['postStatus'],
    where,
    _count: true,
  });

  console.log(`List "${list.name}"  id=${list.id}\n`);
  console.log('current status of every submission:');
  for (const row of byStatus.sort((a, b) => b._count - a._count)) {
    console.log(`  ${String(row._count).padStart(6)}  ${row.postStatus}`);
  }

  const failed = await prisma.insuranceLeadSubmission.findMany({
    where: { ...where, postStatus: { in: FAILED_STATUSES } },
    select: {
      postStatus: true,
      ameriquoteErrorMessage: true,
      ameriquoteResponseRaw: true,
      ameriquoteResponseStatus: true,
      lastAttemptAt: true,
      insuranceLead: { select: { firstName: true, lastName: true, phone: true } },
    },
    orderBy: { lastAttemptAt: 'desc' },
    take: 5000,
  });

  if (!failed.length) {
    console.log('\nEvery submission reached the buyer. Nothing to explain.');
    return;
  }

  const groups = new Map();
  for (const row of failed) {
    const key = `${row.postStatus}  ${reasonFor(row)}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  console.log(`\nwhy ${failed.length} lead(s) did not reach the buyer:`);
  for (const [reason, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${reason}`);
  }

  const shown = showEveryLead ? failed : failed.slice(0, 25);
  console.log(
    `\nper lead${showEveryLead ? '' : ` (first ${shown.length}; pass --all for every one)`}:`
  );
  for (const row of shown) {
    const lead = row.insuranceLead;
    const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || '(unnamed)';
    console.log(
      `  ${row.postStatus.padEnd(9)} ${lead.phone.padEnd(12)} ${name.padEnd(24)} ${reasonFor(row)}`
    );
  }

  // The parsed message is often empty on older rows; the raw body is the only
  // place the real reason survives.
  const sample = failed.find(r => r.ameriquoteResponseRaw);
  if (sample) {
    console.log('\none raw response, verbatim:');
    console.log('  ' + String(sample.ameriquoteResponseRaw).slice(0, 600).replace(/\n/g, '\n  '));
  } else {
    console.log('\nNo raw response body was recorded — these failed before the buyer replied');
    console.log('(timeout, connection reset, or a throw on our side).');
  }
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
