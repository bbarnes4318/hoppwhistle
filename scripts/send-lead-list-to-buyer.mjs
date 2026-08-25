#!/usr/bin/env node
/**
 * Send every held lead in one list to the buyer, start to finish.
 *
 * The delivery panel in the import dialog does this, but only while that dialog
 * is open. Once it is closed there is no other UI route to a bulk send, and a
 * five-thousand-lead batch is not something to drive from a browser console.
 *
 * Runs INSIDE the api container, so it talks to the API over localhost and
 * needs no API key:
 *
 *   docker cp scripts/send-lead-list-to-buyer.mjs hopwhistle-api-dev:/app/send-leads.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/send-leads.mjs "fe-august-2026"
 *
 * Add --force to post leads that failed the readiness check. Do not, unless you
 * have read why they were held back — each one is a near-certain rejection that
 * still costs a ping.
 *
 * Safe to re-run: a MATCHED submission is never reselected, so leads already
 * sold are skipped rather than sold twice.
 */

import { PrismaClient } from '@prisma/client';

const API = process.env.SEND_API_BASE || 'http://127.0.0.1:3001';
const BATCH = 100;

const listName = process.argv[2];
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

if (!listName) {
  console.error('usage: node send-leads.mjs <list name> [--dry-run] [--force]');
  process.exit(1);
}

const prisma = new PrismaClient();

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : '0%';
}

async function api(path, body, tenantId) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-demo-tenant-id': tenantId },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (json.error) throw new Error(`${path}: ${json.error.message || json.error.code}`);
  return json;
}

async function main() {
  const list = await prisma.leadList.findFirst({
    where: { name: { equals: listName, mode: 'insensitive' } },
  });

  if (!list) {
    const all = await prisma.leadList.findMany({ select: { name: true }, take: 25 });
    console.error(`No lead list named "${listName}".`);
    console.error(`Lists that exist: ${all.map(l => l.name).join(', ') || '(none)'}`);
    process.exit(1);
  }

  console.log(`List "${list.name}"  vertical=${list.vertical}  id=${list.id}`);

  const pre = await api(
    '/api/v1/insurance-leads/delivery/preflight',
    { listId: list.id },
    list.tenantId
  );

  console.log('');
  console.log(
    `  mode            ${pre.mode}${pre.mode === 'TEST' ? '   <-- Test_Lead=1, these will NOT be bought' : ''}`
  );
  console.log(`  sendable        ${pre.sendable}`);
  console.log(`  ready           ${pre.ready}  (${pct(pre.ready, pre.sendable)})`);
  console.log(`  blocked         ${pre.blocked.count}`);
  console.log(`  already sold    ${pre.alreadyMatched}`);
  console.log(`  never validated ${pre.invalid}`);

  if (pre.blocked.reasons.length) {
    console.log('\n  why leads are blocked:');
    for (const r of pre.blocked.reasons)
      console.log(`    ${String(r.count).padStart(6)}  ${r.message}`);
  }
  if (pre.warnings.reasons.length) {
    console.log('\n  warnings (still sent):');
    for (const r of pre.warnings.reasons)
      console.log(`    ${String(r.count).padStart(6)}  ${r.message}`);
  }

  const willSend = force ? pre.sendable : pre.ready;
  if (!willSend) {
    console.log('\nNothing to send. Stopping.');
    return;
  }

  if (dryRun) {
    console.log(`\n--dry-run: would send ${willSend} lead(s)${force ? ' WITH --force' : ''}.`);
    console.log('Nothing was posted. Re-run without --dry-run to send.');
    return;
  }

  console.log(`\nSending ${willSend} lead(s)${force ? ' WITH --force' : ''}...\n`);

  const totals = { attempted: 0, matched: 0, unmatched: 0, errored: 0, notReady: 0 };
  const failures = [];
  let cursor = null;

  for (;;) {
    const batch = await api(
      '/api/v1/insurance-leads/delivery/send',
      { listId: list.id, limit: BATCH, force, ...(cursor ? { cursor } : {}) },
      list.tenantId
    );

    totals.attempted += batch.attempted;
    totals.matched += batch.matched;
    totals.unmatched += batch.unmatched;
    totals.errored += batch.errored;
    totals.notReady += batch.notReady;

    for (const r of batch.results || []) {
      if (r.outcome === 'ERROR')
        failures.push(`${r.phone} ${r.name}: ${r.message || 'unknown error'}`);
    }

    console.log(
      `  sent ${String(totals.attempted).padStart(5)}  ` +
        `matched ${String(totals.matched).padStart(5)}  ` +
        `unmatched ${String(totals.unmatched).padStart(5)}  ` +
        `errored ${String(totals.errored).padStart(4)}  ` +
        `held ${String(totals.notReady).padStart(4)}  ` +
        `remaining ${batch.remaining}`
    );

    cursor = batch.nextCursor;
    if (!cursor) break;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`MATCHED (sold)   ${totals.matched}`);
  console.log(`UNMATCHED        ${totals.unmatched}   reached the buyer, nobody bought`);
  console.log(`ERROR            ${totals.errored}   re-runnable`);
  console.log(`held back        ${totals.notReady}   failed readiness, never sent`);
  console.log('='.repeat(60));

  if (failures.length) {
    console.log(`\nFirst ${Math.min(20, failures.length)} error(s):`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  }

  if (totals.errored) {
    console.log('\nRe-run this same command to retry the errored leads. Sold leads are skipped.');
  }
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
