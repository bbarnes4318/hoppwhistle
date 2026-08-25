#!/usr/bin/env node
/**
 * Group the buyer's error responses for one list, most common first.
 *
 * A bulk send reports how many errored but not why until it finishes, and a
 * high error rate mid-run is the moment you most need to know. This reads what
 * the buyer actually said back, straight from the submission records.
 *
 *   docker cp scripts/why-are-leads-erroring.mjs hopwhistle-api-dev:/app/why.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/why.mjs fe-august-2026
 *
 * Read-only. Posts nothing, changes nothing.
 */

import { PrismaClient } from '@prisma/client';

const listName = process.argv[2];
if (!listName) {
  console.error('usage: node why.mjs <list name>');
  process.exit(1);
}

const prisma = new PrismaClient();

/** Collapse ids/phones/timestamps so the same complaint groups as one. */
function shape(message) {
  return String(message || '(no message recorded)')
    .replace(/\b\d{10,}\b/g, '<number>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+/g, '<timestamp>')
    .trim()
    .slice(0, 200);
}

async function main() {
  const list = await prisma.leadList.findFirst({
    where: { name: { equals: listName, mode: 'insensitive' } },
  });
  if (!list) {
    console.error(`No lead list named "${listName}".`);
    process.exit(1);
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

  const errored = await prisma.insuranceLeadSubmission.findMany({
    where: { ...where, postStatus: 'ERROR' },
    select: {
      ameriquoteErrorMessage: true,
      ameriquoteResponseRaw: true,
      ameriquoteResponseStatus: true,
    },
    take: 5000,
  });

  if (!errored.length) {
    console.log('\nNo errored submissions.');
    return;
  }

  const groups = new Map();
  for (const row of errored) {
    const key = shape(row.ameriquoteErrorMessage || row.ameriquoteResponseStatus);
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  console.log(`\nwhat the buyer said, across ${errored.length} errored lead(s):`);
  for (const [message, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${message}`);
  }

  // The parsed message is often empty when the gateway answered with something
  // unexpected; the raw body is the only place the real reason survives.
  const sample = errored.find(r => r.ameriquoteResponseRaw);
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
