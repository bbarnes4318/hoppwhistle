/**
 * Monthly statements: closing a month, listing a party's months, and handing
 * one over as a page, a PDF or a CSV.
 *
 * ── Closed months are stored; the running month is not ───────────────────────
 *
 * `closeMonth` writes one `statements` row per party per month -- the figures
 * (with their line items) and the rendered HTML -- and never touches an
 * existing row unless asked to `rebuild`. A closed month is read back exactly
 * as it was written.
 *
 * The current month is always there as "Month to date": built on request from
 * the live data and not stored, so it can never be mistaken for a closed one.
 *
 * ── Who is on a tenant's statements ──────────────────────────────────────────
 *
 * For every tenant: each of its buyers, each of its publishers, the agency
 * itself, and each child agency it onboarded (`Tenant.parentTenantId`). A
 * child agency is a tenant too, so it also gets an AGENCY statement of its own
 * calls; its CHILD_AGENCY statement is the one its parent issues it, and is
 * stored under the parent's tenant id.
 */

import { existsSync } from 'node:fs';

import type { PrismaClient } from '@prisma/client';
import { executablePath, launch } from 'puppeteer';

import { emailBrandForTenant } from '../email-brand.js';

import {
  buildStatement,
  StatementReconciliationError,
  type PartyType,
  type StatementData,
  type StatementParty,
} from './statement-data.js';
import {
  currentMonth,
  isStatementMonth,
  monthLabel,
  type StatementMonth,
} from './statement-month.js';
import {
  letterheadOf,
  renderStatementCsv,
  renderStatementHtml,
  type StatementLetterhead,
} from './statement-render.js';

export const CURRENT = 'current';

/** A statement ready to hand over. */
export interface StatementDocument {
  month: StatementMonth;
  live: boolean;
  html: string;
  data: StatementData;
}

/** The letterhead a tenant's statements carry: its brand, or its parent's. */
export async function statementLetterhead(tenantId: string): Promise<StatementLetterhead> {
  return letterheadOf(await emailBrandForTenant(tenantId));
}

/** Build and render one statement, without storing it. */
export async function renderStatement(
  prisma: PrismaClient,
  party: StatementParty,
  month: StatementMonth,
  options: { now?: Date; letterhead?: StatementLetterhead } = {}
): Promise<StatementDocument> {
  const [data, letterhead] = await Promise.all([
    buildStatement(prisma, party, month, { now: options.now }),
    options.letterhead ?? statementLetterhead(party.tenantId),
  ]);
  return { month, live: data.live, html: renderStatementHtml(data, letterhead), data };
}

export interface StatementMonthEntry {
  /** 'YYYY-MM', or 'current' for the live month. */
  month: string;
  label: string;
  live: boolean;
  createdAt: string | null;
}

/** A party's statements, newest first, with "Month to date" at the top. */
export async function listStatementMonths(
  prisma: PrismaClient,
  party: StatementParty,
  now: Date = new Date()
): Promise<StatementMonthEntry[]> {
  const rows = await prisma.statement.findMany({
    where: { tenantId: party.tenantId, partyType: party.partyType, partyId: party.partyId },
    select: { month: true, createdAt: true },
    orderBy: { month: 'desc' },
  });
  const running = currentMonth(now);
  return [
    {
      month: CURRENT,
      label: `Month to date (${monthLabel(running)})`,
      live: true,
      createdAt: null,
    },
    ...rows
      .filter(row => row.month !== running)
      .map(row => ({
        month: row.month,
        label: monthLabel(row.month),
        live: false,
        createdAt: row.createdAt.toISOString(),
      })),
  ];
}

/**
 * One statement: the stored page for a closed month, or the live one for
 * `current` (or for the running month named by its label). Null for a past
 * month that has not been closed.
 */
export async function getStatementDocument(
  prisma: PrismaClient,
  party: StatementParty,
  month: string,
  now: Date = new Date()
): Promise<StatementDocument | null> {
  const running = currentMonth(now);
  if (month === CURRENT || month === running) {
    return renderStatement(prisma, party, running, { now });
  }
  if (!isStatementMonth(month)) return null;

  const row = await prisma.statement.findUnique({
    where: {
      tenantId_partyType_partyId_month: {
        tenantId: party.tenantId,
        partyType: party.partyType,
        partyId: party.partyId,
        month,
      },
    },
    select: { html: true, totals: true },
  });
  if (!row) return null;
  return { month, live: false, html: row.html, data: row.totals as unknown as StatementData };
}

export function statementCsv(document: StatementDocument): string {
  return renderStatementCsv(document.data);
}

/** System Chromes, for a host where puppeteer's own download is not installed. */
const SYSTEM_CHROMES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/**
 * The Chrome to print with: `PUPPETEER_EXECUTABLE_PATH` when set, puppeteer's
 * own download when it is installed, else a system Chrome. Undefined leaves the
 * choice to puppeteer, which then says plainly what it could not find.
 *
 * `pnpm install` does not always fetch puppeteer's Chrome -- a cached store, a
 * CI runner, a slim image -- and without this fallback every PDF on such a
 * host fails even though a perfectly good Chrome is installed beside it.
 */
export function chromeExecutable(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  try {
    const bundled = executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // Not downloaded: fall through to the system's.
  }
  return SYSTEM_CHROMES.find(path => existsSync(path));
}

/**
 * The PDF of a statement's page, through the same headless Chrome the invoice
 * PDFs use (`routes/admin-billing.ts`), found by `chromeExecutable`.
 */
export async function statementPdf(html: string): Promise<Buffer> {
  const browser = await launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: chromeExecutable(),
  });
  try {
    const page = await browser.newPage();
    // A logo that cannot be fetched must not hold the statement up.
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
    const pdf = await page.pdf({
      format: 'Letter',
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** A file name for a statement: the party's name and the month, nothing about the platform. */
export function statementFileName(document: StatementDocument, extension: 'pdf' | 'csv'): string {
  const slug =
    document.data.partyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'statement';
  return `statement-${slug}-${document.month}${document.live ? '-to-date' : ''}.${extension}`;
}

/* ── Closing a month ───────────────────────────────────────────────────────── */

export interface CloseMonthResult {
  month: StatementMonth;
  written: number;
  skipped: number;
  errors: Array<{ party: StatementParty; message: string }>;
}

/** Every party with a statement in one tenant. */
export async function partiesOf(prisma: PrismaClient, tenantId: string): Promise<StatementParty[]> {
  const [buyers, publishers, children] = await Promise.all([
    prisma.buyer.findMany({ where: { tenantId }, select: { id: true }, orderBy: { name: 'asc' } }),
    prisma.publisher.findMany({
      where: { tenantId },
      select: { id: true },
      orderBy: { name: 'asc' },
    }),
    prisma.tenant.findMany({
      where: { parentTenantId: tenantId },
      select: { id: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const party = (partyType: PartyType, partyId: string): StatementParty => ({
    tenantId,
    partyType,
    partyId,
  });
  return [
    party('AGENCY', tenantId),
    ...buyers.map(b => party('BUYER', b.id)),
    ...publishers.map(p => party('PUBLISHER', p.id)),
    ...children.map(c => party('CHILD_AGENCY', c.id)),
  ];
}

/**
 * Write every tenant's statements for a closed month.
 *
 * Idempotent: a statement already written is left alone unless `rebuild`. One
 * party failing -- a wallet that does not reconcile -- is reported and the rest
 * are still written, so one bad buyer does not cost every other party its
 * statement.
 */
export async function closeMonth(
  prisma: PrismaClient,
  month: StatementMonth,
  options: { rebuild?: boolean; tenantIds?: string[]; now?: Date } = {}
): Promise<CloseMonthResult> {
  const now = options.now ?? new Date();
  if (month >= currentMonth(now)) {
    throw new Error(`${month} has not ended yet; only a closed month can be written.`);
  }

  const tenants = await prisma.tenant.findMany({
    where: options.tenantIds ? { id: { in: options.tenantIds } } : {},
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: CloseMonthResult = { month, written: 0, skipped: 0, errors: [] };

  for (const tenant of tenants) {
    const [parties, existing, letterhead] = await Promise.all([
      partiesOf(prisma, tenant.id),
      prisma.statement.findMany({
        where: { tenantId: tenant.id, month },
        select: { partyType: true, partyId: true },
      }),
      statementLetterhead(tenant.id),
    ]);
    const done = new Set(existing.map(row => `${row.partyType}:${row.partyId}`));

    for (const party of parties) {
      if (!options.rebuild && done.has(`${party.partyType}:${party.partyId}`)) {
        result.skipped++;
        continue;
      }
      try {
        const document = await renderStatement(prisma, party, month, { now, letterhead });
        const totals = JSON.parse(JSON.stringify(document.data)) as object;
        await prisma.statement.upsert({
          where: {
            tenantId_partyType_partyId_month: {
              tenantId: party.tenantId,
              partyType: party.partyType,
              partyId: party.partyId,
              month,
            },
          },
          create: { ...party, month, totals, html: document.html },
          update: { totals, html: document.html, createdAt: new Date() },
        });
        result.written++;
      } catch (error) {
        result.errors.push({
          party,
          message:
            error instanceof StatementReconciliationError || error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }
  }

  return result;
}
