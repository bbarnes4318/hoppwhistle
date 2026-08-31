#!/usr/bin/env node
/**
 * Export what the buyer did with every lead: accepted, rejected, or never sent.
 *
 * The send output and the acceptance report both summarise. This does not — it
 * writes one row per submission with the buyer's own response attached, so a
 * disputed lead can be looked up by phone number and answered with the exact
 * text Boberdoo returned.
 *
 *   docker cp scripts/export-buyer-disposition.mjs hopwhistle-api-dev:/app/disposition.mjs
 *   docker exec -u root hopwhistle-api-dev node /app/disposition.mjs fe-august-2026
 *   docker cp hopwhistle-api-dev:/app/fe-august-2026-all.csv .
 *
 * Omit the list name to cover every submission in the tenant.
 *
 * Writes four files inside the container:
 *   <list>-all.csv          every lead, with its outcome
 *   <list>-accepted.csv     reached the buyer AND was taken
 *   <list>-rejected.csv     reached the buyer AND was refused
 *   <list>-never-sent.csv   never reached the buyer at all
 *
 * Read-only against the database.
 */

import { writeFileSync } from 'fs';

import { PrismaClient } from '@prisma/client';

const listName = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

const prisma = new PrismaClient();

const DUPLICATE = /Duplicate lead value/i;
const BLOCKED = /Blocked value/i;
const MANUAL = /has to be manually approved/i;

/**
 * Outcome codes. ACCEPTED_* means the buyer has the lead and owes us for it or
 * is deciding. REJECTED_* means it reached them and came back — none of those
 * are fixable, and re-posting them burns the 90-day duplicate window. Only
 * NEVER_SENT_* is recoverable work.
 */
const OUTCOME = {
  SOLD: 'ACCEPTED_SOLD',
  PENDING: 'ACCEPTED_PENDING_APPROVAL',
  NO_BUYER: 'REJECTED_NO_BUYER_WANTED',
  DUPLICATE: 'REJECTED_DUPLICATE_90_DAY',
  BLOCKED: 'REJECTED_BLOCKED_NUMBER',
  REFUSED: 'REJECTED_OTHER',
  INVALID: 'NEVER_SENT_FAILED_VALIDATION',
  HELD: 'NEVER_SENT_MISSING_REQUIRED_FIELD',
  POST_FAILED: 'NEVER_SENT_POST_FAILED',
  UNKNOWN: 'UNKNOWN',
};

const ACCEPTED = new Set([OUTCOME.SOLD, OUTCOME.PENDING]);
const REJECTED = new Set([OUTCOME.NO_BUYER, OUTCOME.DUPLICATE, OUTCOME.BLOCKED, OUTCOME.REFUSED]);

/** Buyer column name -> lead field -> normalized payload key. */
const LEAD_COLUMNS = [
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
];

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One line, bounded — a raw Boberdoo body can be an entire XML document. */
function flatten(value, limit = 400) {
  if (!value) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function pick(row, field) {
  const lead = row.insuranceLead || {};
  const norm = row.normalizedPayload || {};
  const raw = row.rawPayload || {};
  const value = lead[field] ?? norm[field] ?? raw[field];
  return value === undefined || value === null ? '' : value;
}

function classify(row, said) {
  if (row.postStatus === 'MATCHED') return OUTCOME.SOLD;
  if (row.postStatus === 'MANUAL_REVIEW' || MANUAL.test(said)) return OUTCOME.PENDING;
  if (row.postStatus === 'UNMATCHED') return OUTCOME.NO_BUYER;
  if (DUPLICATE.test(said)) return OUTCOME.DUPLICATE;
  if (BLOCKED.test(said)) return OUTCOME.BLOCKED;
  if (row.validationStatus !== 'VALID') return OUTCOME.INVALID;
  if (row.postStatus === 'HOLD' || row.postStatus === 'PENDING') return OUTCOME.HELD;
  // An ERROR that carries a response body is the buyer refusing us for a reason
  // we have not named above. One that carries nothing never left the building.
  if (row.postStatus === 'ERROR') {
    return row.ameriquoteResponseRaw ? OUTCOME.REFUSED : OUTCOME.POST_FAILED;
  }
  return OUTCOME.UNKNOWN;
}

/** Why a never-sent lead is stuck, in words that say what to go fix. */
function reasonFor(row, outcome) {
  if (outcome === OUTCOME.INVALID) {
    const errs = Array.isArray(row.validationErrors) ? row.validationErrors : [];
    if (errs.length) return errs.map(e => `${e.path}: ${e.message}`).join('; ');
  }
  if (outcome === OUTCOME.HELD || outcome === OUTCOME.INVALID) {
    const empty = LEAD_COLUMNS.filter(([, f]) => !String(pick(row, f)).trim()).map(([c]) => c);
    if (empty.length) return `missing: ${empty.join(', ')}`;
  }
  return '';
}

const HEADER = [
  'Outcome',
  'ReachedBuyer',
  'Accepted',
  ...LEAD_COLUMNS.map(([col]) => col),
  'Origin_Lead_Date',
  'BuyerLeadId',
  'BuyerPrice',
  'BuyerStatus',
  'BuyerSaid',
  'PostedAt',
  'PostMode',
  'Attempts',
  'Reason',
];

function toRow(r) {
  const said = flatten(
    [r.ameriquoteErrorMessage, r.ameriquoteResponseStatus, r.ameriquoteResponseRaw]
      .filter(Boolean)
      .join(' | ')
  );
  const outcome = classify(
    r,
    `${r.ameriquoteErrorMessage || ''} ${r.ameriquoteResponseStatus || ''} ${r.ameriquoteResponseRaw || ''}`
  );
  const reached = ACCEPTED.has(outcome) || REJECTED.has(outcome);

  return {
    outcome,
    cells: [
      outcome,
      reached ? 'YES' : 'NO',
      ACCEPTED.has(outcome) ? 'YES' : 'NO',
      ...LEAD_COLUMNS.map(([, f]) => pick(r, f)),
      pick(r, 'datePosted'),
      r.ameriquoteLeadId || '',
      r.ameriquotePrice || '',
      r.ameriquoteResponseStatus || '',
      said,
      r.postedAt ? r.postedAt.toISOString() : '',
      r.postMode || '',
      r.attemptCount ?? '',
      reasonFor(r, outcome),
    ],
  };
}

function write(path, rows) {
  writeFileSync(path, [HEADER.join(','), ...rows].join('\n') + '\n', 'utf8');
}

async function main() {
  let where = {};
  let slug = 'all-leads';

  if (listName) {
    const list = await prisma.leadList.findFirst({
      where: { name: { equals: listName, mode: 'insensitive' } },
    });
    if (!list) {
      console.error(`No lead list named "${listName}".`);
      process.exit(1);
    }
    where = { tenantId: list.tenantId, insuranceLead: { listId: list.id } };
    slug = list.name.replace(/[^a-z0-9-]/gi, '_');
  }

  const rows = await prisma.insuranceLeadSubmission.findMany({
    where,
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true,
      postStatus: true,
      postMode: true,
      validationStatus: true,
      validationErrors: true,
      normalizedPayload: true,
      rawPayload: true,
      ameriquoteLeadId: true,
      ameriquotePrice: true,
      ameriquoteResponseStatus: true,
      ameriquoteErrorMessage: true,
      ameriquoteResponseRaw: true,
      postedAt: true,
      attemptCount: true,
      insuranceLead: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          birthDate: true,
          gender: true,
          trustedFormUrl: true,
        },
      },
    },
  });

  if (!rows.length) {
    console.error(listName ? `List "${listName}" has no submissions.` : 'No submissions found.');
    process.exit(1);
  }

  const all = [];
  const accepted = [];
  const rejected = [];
  const neverSent = [];
  const tally = new Map();

  for (const r of rows) {
    const { outcome, cells } = toRow(r);
    const line = cells.map(csvCell).join(',');
    all.push(line);
    if (ACCEPTED.has(outcome)) accepted.push(line);
    else if (REJECTED.has(outcome)) rejected.push(line);
    else neverSent.push(line);
    tally.set(outcome, (tally.get(outcome) || 0) + 1);
  }

  write(`/app/${slug}-all.csv`, all);
  write(`/app/${slug}-accepted.csv`, accepted);
  write(`/app/${slug}-rejected.csv`, rejected);
  write(`/app/${slug}-never-sent.csv`, neverSent);

  const pad = n => String(n).padStart(6);

  console.log(`${listName ? `List "${listName}"` : 'All lists'} — ${rows.length} submission(s)\n`);
  console.log('ACCEPTED BY THE BUYER');
  console.log(`  ${pad(tally.get(OUTCOME.SOLD) || 0)}  sold`);
  console.log(`  ${pad(tally.get(OUTCOME.PENDING) || 0)}  accepted, awaiting their approval`);
  console.log(`  ${pad(accepted.length)}  total\n`);

  console.log('REACHED THE BUYER AND WAS REJECTED');
  console.log(`  ${pad(tally.get(OUTCOME.NO_BUYER) || 0)}  no buyer wanted it`);
  console.log(`  ${pad(tally.get(OUTCOME.DUPLICATE) || 0)}  already submitted in the last 90 days`);
  console.log(`  ${pad(tally.get(OUTCOME.BLOCKED) || 0)}  blocked number (DNC / litigator)`);
  console.log(`  ${pad(tally.get(OUTCOME.REFUSED) || 0)}  refused for another reason`);
  console.log(`  ${pad(rejected.length)}  total\n`);

  console.log('NEVER REACHED THE BUYER');
  console.log(`  ${pad(tally.get(OUTCOME.INVALID) || 0)}  failed validation on import`);
  console.log(`  ${pad(tally.get(OUTCOME.HELD) || 0)}  held: missing a field the buyer requires`);
  console.log(
    `  ${pad(tally.get(OUTCOME.POST_FAILED) || 0)}  post failed before the buyer answered`
  );
  if (tally.get(OUTCOME.UNKNOWN)) console.log(`  ${pad(tally.get(OUTCOME.UNKNOWN))}  unclassified`);
  console.log(`  ${pad(neverSent.length)}  total\n`);

  console.log(`reached the buyer at all: ${accepted.length + rejected.length} of ${rows.length}`);
  console.log('\nWrote (inside the container):');
  for (const [file, count] of [
    [`${slug}-all.csv`, all.length],
    [`${slug}-accepted.csv`, accepted.length],
    [`${slug}-rejected.csv`, rejected.length],
    [`${slug}-never-sent.csv`, neverSent.length],
  ]) {
    console.log(`  /app/${file}  (${count} row${count === 1 ? '' : 's'})`);
  }
  console.log('\nCopy them out with:');
  console.log(`  docker cp hopwhistle-api-dev:/app/${slug}-all.csv .`);
}

main()
  .catch(err => {
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
