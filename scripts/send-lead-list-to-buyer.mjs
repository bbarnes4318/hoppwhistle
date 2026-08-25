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

/**
 * Halt once this many leads in a row come back unmatched. A healthy file
 * matches steadily; a flat zero means the buyer stopped buying, and every
 * further post spends a lead for nothing while still entering their 90-day
 * duplicate window. 0 disables the guard.
 */
const stopAfterArg = process.argv.indexOf('--stop-after-unmatched');
const stopAfter = stopAfterArg > -1 ? Number(process.argv[stopAfterArg + 1]) : 50;

if (!Number.isFinite(stopAfter) || stopAfter < 0) {
  console.error('--stop-after-unmatched needs a non-negative number');
  process.exit(1);
}

/**
 * Stop after this many leads total. The point of a small --max is to answer a
 * question cheaply: post twenty and read what comes back, rather than commit
 * thousands to a theory about what the buyer will do.
 */
const maxArg = process.argv.indexOf('--max');
const maxLeads = maxArg > -1 ? Number(process.argv[maxArg + 1]) : Infinity;

if (!(maxLeads > 0)) {
  console.error('--max needs a positive number');
  process.exit(1);
}

if (!listName) {
  console.error(
    'usage: node send-leads.mjs <list name> [--dry-run] [--force] [--max <n>] [--stop-after-unmatched <n>]'
  );
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

  const willSend = Math.min(force ? pre.sendable : pre.ready, maxLeads);
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

  const totals = {
    attempted: 0,
    matched: 0,
    unmatched: 0,
    manualReview: 0,
    errored: 0,
    notReady: 0,
  };
  const failures = [];
  let cursor = null;

  // Buyers cap. On 2026-08-25 this list matched at 67% for 1,475 leads, hit a
  // ceiling at exactly 1,000 sold, and the next 3,417 posts all came back
  // Unmatched — each one still registered with the buyer and so locked out of
  // their 90-day duplicate window. A run that stops matching entirely is not a
  // run to keep feeding: stop and let the rest stay sellable tomorrow.
  let sinceLastMatch = 0;
  let stoppedOnWall = false;

  for (;;) {
    const room = maxLeads - totals.attempted;
    const batch = await api(
      '/api/v1/insurance-leads/delivery/send',
      {
        listId: list.id,
        limit: Math.max(1, Math.min(BATCH, room)),
        force,
        ...(cursor ? { cursor } : {}),
      },
      list.tenantId
    );

    totals.attempted += batch.attempted;
    totals.matched += batch.matched;
    totals.unmatched += batch.unmatched;
    totals.errored += batch.errored;
    totals.notReady += batch.notReady;

    totals.manualReview += batch.manualReview || 0;

    for (const r of batch.results || []) {
      if (r.outcome === 'ERROR')
        failures.push(`${r.phone} ${r.name}: ${r.message || 'unknown error'}`);

      // Count in posting order so the streak is real, not a per-batch average.
      // MANUAL_REVIEW is an acceptance, so it breaks the streak like a match.
      if (r.outcome === 'MATCHED' || r.outcome === 'MANUAL_REVIEW') sinceLastMatch = 0;
      else if (r.outcome === 'UNMATCHED') sinceLastMatch += 1;
    }

    console.log(
      `  sent ${String(totals.attempted).padStart(5)}  ` +
        `matched ${String(totals.matched).padStart(5)}  ` +
        `unmatched ${String(totals.unmatched).padStart(5)}  ` +
        `errored ${String(totals.errored).padStart(4)}  ` +
        `held ${String(totals.notReady).padStart(4)}  ` +
        `remaining ${batch.remaining}`
    );

    if (stopAfter > 0 && sinceLastMatch >= stopAfter) {
      stoppedOnWall = true;
      break;
    }

    if (totals.attempted >= maxLeads) {
      console.log(`\n  Reached --max ${maxLeads}. Everything else is untouched.`);
      break;
    }

    cursor = batch.nextCursor;
    if (!cursor) break;
  }

  if (stoppedOnWall) {
    console.log(`\n  STOPPED: ${sinceLastMatch} leads in a row went unmatched.`);
    console.log('  That is a buyer-side ceiling, not bad data — the rate does not');
    console.log('  fall to zero and stay there on its own. Everything not yet sent');
    console.log('  is untouched and still sellable. Re-run when the cap resets, or');
    console.log(`  pass --stop-after-unmatched <n> to change the threshold (now ${stopAfter}).`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`MATCHED (sold)   ${totals.matched}`);
  console.log(`MANUAL_REVIEW    ${totals.manualReview}   accepted, awaiting the buyer's approval`);
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
