#!/usr/bin/env node
/**
 * What the buyer accepted, what it refused, and which refusals are fixable.
 *
 * The send output mixes three different things under "error": leads the buyer
 * accepted but our parser misread, leads it refused for good (duplicates,
 * blocked numbers), and leads that never left the building because our own
 * data was incomplete. Only the last group is worth anyone's time, and it is
 * the one the raw counts bury.
 *
 *   docker cp scripts/lead-acceptance-report.mjs hopwhistle-api-dev:/app/report.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/report.mjs fe-august-2026
 *
 * Writes the fixable leads to /app/<list>-fixable.csv inside the container,
 * in the buyer's own column names, ready to correct and re-import as a new
 * list. Read-only against the database.
 */

import { writeFileSync } from 'fs';

import { PrismaClient } from '@prisma/client';

const listName = process.argv[2];
if (!listName) {
  console.error('usage: node report.mjs <list name>');
  process.exit(1);
}

const prisma = new PrismaClient();

const DUPLICATE = /Duplicate lead value/i;
const BLOCKED = /Blocked value/i;
const MANUAL = /has to be manually approved/i;

/** Buyer column name -> the normalized field it comes from. */
const CSV_COLUMNS = [
  ['FirstName', 'firstName'],
  ['LastName', 'lastName'],
  ['Primary_Phone', 'phone'],
  ['Email', 'email'],
  ['Address', 'address'],
  ['City', 'city'],
  ['State', 'state'],
  ['ZipCode', 'zipCode'],
  ['Birth_Date', 'birthDate'],
  ['Gender', 'gender'],
  ['IP_Address', 'ipAddress'],
  ['Trusted_Form_URL', 'trustedFormUrl'],
  ['Origin_Lead_Date', 'datePosted'],
];

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pick(submission, field) {
  const norm = submission.normalizedPayload || {};
  const raw = submission.rawPayload || {};
  return norm[field] ?? raw[field] ?? '';
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
    where: { tenantId: list.tenantId, insuranceLead: { listId: list.id } },
    select: {
      id: true,
      postStatus: true,
      validationStatus: true,
      validationErrors: true,
      normalizedPayload: true,
      rawPayload: true,
      ameriquoteErrorMessage: true,
      ameriquoteResponseStatus: true,
      ameriquoteResponseRaw: true,
      insuranceLead: { select: { phone: true, firstName: true, lastName: true } },
    },
  });

  const buckets = {
    sold: [],
    pendingApproval: [],
    notBought: [],
    duplicate: [],
    blocked: [],
    incompleteData: [],
    failedValidation: [],
    neverSent: [],
    other: [],
  };

  for (const r of rows) {
    const said = `${r.ameriquoteErrorMessage || ''} ${r.ameriquoteResponseStatus || ''} ${r.ameriquoteResponseRaw || ''}`;

    if (r.postStatus === 'MATCHED') buckets.sold.push(r);
    else if (r.postStatus === 'MANUAL_REVIEW' || MANUAL.test(said)) buckets.pendingApproval.push(r);
    else if (r.postStatus === 'UNMATCHED') buckets.notBought.push(r);
    else if (DUPLICATE.test(said)) buckets.duplicate.push(r);
    else if (BLOCKED.test(said)) buckets.blocked.push(r);
    else if (r.validationStatus !== 'VALID') buckets.failedValidation.push(r);
    else if (r.postStatus === 'HOLD' || r.postStatus === 'PENDING') buckets.neverSent.push(r);
    else buckets.other.push(r);
  }

  const n = k => buckets[k].length;
  const accepted = n('sold') + n('pendingApproval');
  const reachedBuyer = accepted + n('notBought') + n('duplicate') + n('blocked');

  console.log(`List "${list.name}" — ${rows.length} lead(s)\n`);
  console.log('ACCEPTED BY THE BUYER');
  console.log(`  ${String(n('sold')).padStart(6)}  sold (MATCHED)`);
  console.log(
    `  ${String(n('pendingApproval')).padStart(6)}  accepted, awaiting their manual approval`
  );
  console.log(`  ${String(accepted).padStart(6)}  total accepted\n`);

  console.log('REACHED THE BUYER, NOT ACCEPTED');
  console.log(
    `  ${String(n('notBought')).padStart(6)}  no buyer wanted it (Unmatched)  -- NOT fixable, and`
  );
  console.log('          re-posting these hits the 90-day duplicate rule');
  console.log(
    `  ${String(n('duplicate')).padStart(6)}  already submitted in the last 90 days  -- NOT fixable`
  );
  console.log(
    `  ${String(n('blocked')).padStart(6)}  blocked number (DNC / litigator)  -- NOT fixable\n`
  );

  console.log('NEVER REACHED THE BUYER  -- these are the fixable ones');
  console.log(`  ${String(n('failedValidation')).padStart(6)}  failed validation on import`);
  console.log(`  ${String(n('neverSent')).padStart(6)}  held: missing a field the buyer requires`);
  if (n('other')) console.log(`  ${String(n('other')).padStart(6)}  other`);

  const fixable = [...buckets.failedValidation, ...buckets.neverSent, ...buckets.other];
  console.log(`  ${String(fixable.length).padStart(6)}  total recoverable\n`);

  console.log(`reached the buyer at all: ${reachedBuyer} of ${rows.length}`);

  if (!fixable.length) {
    console.log('\nNothing recoverable.');
    return;
  }

  // --- Why is each one stuck? ---
  const reasons = new Map();
  for (const r of fixable) {
    const errs = Array.isArray(r.validationErrors) ? r.validationErrors : [];
    const keys = errs.length
      ? errs.map(e => `${e.path}: ${e.message}`)
      : CSV_COLUMNS.filter(([, f]) => !String(pick(r, f)).trim()).map(([col]) => `${col} is empty`);
    for (const k of new Set(keys.length ? keys : ['(no recorded reason)'])) {
      reasons.set(k, (reasons.get(k) || 0) + 1);
    }
  }

  console.log('\nwhat is wrong with them:');
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(count).padStart(6)}  ${reason}`);
  }

  // --- Export for correction and re-import ---
  const header = [...CSV_COLUMNS.map(([col]) => col), 'WhatIsWrong'].join(',');
  const lines = fixable.map(r => {
    const errs = Array.isArray(r.validationErrors) ? r.validationErrors : [];
    const why = errs.length
      ? errs.map(e => `${e.path}: ${e.message}`).join('; ')
      : CSV_COLUMNS.filter(([, f]) => !String(pick(r, f)).trim())
          .map(([col]) => `${col} is empty`)
          .join('; ');
    return [...CSV_COLUMNS.map(([, f]) => csvCell(pick(r, f))), csvCell(why)].join(',');
  });

  const out = `/app/${list.name.replace(/[^a-z0-9-]/gi, '_')}-fixable.csv`;
  writeFileSync(out, [header, ...lines].join('\n') + '\n', 'utf8');

  console.log(`\nWrote ${fixable.length} lead(s) to ${out} (inside the container).`);
  console.log('Copy it out, fix the WhatIsWrong column, delete that column, and');
  console.log('import it as a NEW list — these never reached the buyer, so they');
  console.log('carry no duplicate exposure.');
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
