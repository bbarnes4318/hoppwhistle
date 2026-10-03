/**
 * Printing, merging and sealing the executed PDFs.
 *
 * Headless Chrome prints each document (and its Certificate of Completion)
 * with the running header and page footer as puppeteer templates, so they
 * repeat on every page. pdf-lib merges the two and writes the metadata. When a
 * seal certificate is configured, the merged file is signed with it (PKCS#7,
 * detached) so any later byte change is visible in every PDF reader.
 */

import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { SignPdf } from '@signpdf/signpdf';
import { PDFDocument } from 'pdf-lib';
import { launch, type Browser } from 'puppeteer';

import { logger } from '../../lib/logger.js';
import { chromeExecutable } from '../statements/statements.js';

import { esc } from './format.js';

/** One browser for a whole completion: every document prints in it. */
export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    executablePath: chromeExecutable(),
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

const TEMPLATE_FONT =
  "font-family: Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', 'FreeSans', sans-serif;";

/** The running header, top right, small grey caps. */
export function headerTemplate(runningHeader: string): string {
  return `<div style="${TEMPLATE_FONT} width:100%; padding:0 14mm; font-size:7pt; letter-spacing:0.12em; color:#6b7280; text-align:right; text-transform:uppercase;">${esc(runningHeader)}</div>`;
}

/** The page footer of an agreement. `initials` null prints the blank line. */
export function documentFooterTemplate(reference: string, initials: string | null): string {
  const initialsText = initials ? esc(initials) : '____';
  return `<div style="${TEMPLATE_FONT} width:100%; padding:0 14mm; font-size:7.5pt; color:#4b5563;">
<div style="display:flex; justify-content:space-between; align-items:center;">
<span style="flex:1; text-align:left;">PVN LLC d/b/a NetEnroll · Confidential</span>
<span style="flex:1; text-align:center;">Agency Initials: ${initialsText}</span>
<span style="flex:1; text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>
<div style="margin-top:2px; font-size:7pt; color:#9ca3af;">Ref ${esc(reference)}</div>
</div>`;
}

export function certificateFooterTemplate(reference: string): string {
  return `<div style="${TEMPLATE_FONT} width:100%; padding:0 14mm; font-size:7.5pt; color:#4b5563; text-align:center;">Certificate of Completion · Ref ${esc(reference)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;
}

export async function printHtml(
  browser: Browser,
  html: string,
  templates: { header: string; footer: string }
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    // No network: everything is inlined, and a request would be a bug.
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (url.startsWith('data:') || url === 'about:blank') void request.continue();
      else void request.abort();
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const pdf = await page.pdf({
      format: 'Letter',
      margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: templates.header,
      footerTemplate: templates.footer,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPageCount();
}

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  creator: string;
  creationDate: Date;
}

/** Content pages, then the certificate, with the metadata set. */
export async function mergePdfs(
  content: Buffer,
  certificate: Buffer,
  meta: PdfMetadata
): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const source of [content, certificate]) {
    const doc = await PDFDocument.load(source);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  merged.setTitle(meta.title, { showInWindowTitleBar: true });
  merged.setAuthor(meta.author);
  merged.setSubject(meta.subject);
  merged.setKeywords(meta.keywords);
  merged.setCreator(meta.creator);
  merged.setProducer('NetEnroll Agreements');
  merged.setCreationDate(meta.creationDate);
  merged.setModificationDate(meta.creationDate);
  return Buffer.from(await merged.save({ useObjectStreams: false }));
}

export interface SealConfig {
  p12: Buffer;
  passphrase: string;
}

/** The seal certificate from the environment, or null when unset. */
export function sealConfig(): SealConfig | null {
  const b64 = process.env.AGREEMENT_SEAL_P12_BASE64?.trim();
  const passphrase = process.env.AGREEMENT_SEAL_P12_PASSPHRASE;
  if (!b64 || passphrase === undefined || passphrase === '') return null;
  return { p12: Buffer.from(b64, 'base64'), passphrase };
}

let warnedUnsealed = false;

/** Say once per process that executed PDFs are going out unsealed. */
export function warnUnsealed(): void {
  if (warnedUnsealed) return;
  warnedUnsealed = true;
  const msg =
    'AGREEMENT_SEAL_P12_BASE64 / AGREEMENT_SEAL_P12_PASSPHRASE are not set: executed agreements are produced UNSEALED. See docs/AGREEMENTS.md.';
  if (process.env.NODE_ENV === 'production') logger.error({ msg });
  else logger.warn({ msg });
}

/** Sign the PDF with the seal certificate. */
export async function sealPdf(
  pdf: Buffer,
  seal: SealConfig,
  params: { reason: string; location: string; contactInfo: string; name: string; signingTime: Date }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: params.reason,
    location: params.location,
    contactInfo: params.contactInfo,
    name: params.name,
    signingTime: params.signingTime,
    signatureLength: 16_384,
  });
  const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
  const signer = new P12Signer(seal.p12, { passphrase: seal.passphrase });
  return new SignPdf().sign(withPlaceholder, signer, params.signingTime);
}
