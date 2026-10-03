/**
 * Completion: from a committed signature (SIGNED) to sealed, stored, delivered
 * executed PDFs (COMPLETED).
 *
 * For each document, in order: fill the five signature markers in the as-sent
 * HTML (and prove nothing else changed), print it, print its Certificate of
 * Completion, merge the two, seal the result when a seal certificate is
 * configured, hash it and store it under a key that is never overwritten.
 * Then the envelope is marked COMPLETED with a `COMPLETED` event naming every
 * executed hash, a download token is minted and the copies are emailed.
 *
 * Idempotent. A document already stored by an earlier, interrupted run is
 * kept (its hash re-checked) rather than produced again, and an envelope that
 * is already COMPLETED is left alone. Runs for one envelope are serialised in
 * process so a signer's request and an admin's retry cannot race.
 */

import type { AgreementDocument, PrismaClient } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { defaultPortalUrl } from '../../lib/tenant-brand.js';
import { auditLog } from '../audit.js';
import { getAgreementsStorageService } from '../storage.js';

import { renderCertificate } from './certificate.js';
import { sendCompletedEmail, sendInternalCompletedEmail, type ExecutedFile } from './emails.js';
import { appendEvent } from './events.js';
import { renderExecutedHtml } from './executed.js';
import { etDateIso, sha256Hex, slugify } from './format.js';
import {
  certificateFooterTemplate,
  documentFooterTemplate,
  headerTemplate,
  mergePdfs,
  pdfPageCount,
  printHtml,
  sealConfig,
  sealPdf,
  warnUnsealed,
  withBrowser,
} from './pdf.js';
import { loadAgreementSettings, noticeEmailOf } from './settings.js';
import type { FrozenTerms } from './terms.js';
import { mintToken } from './tokens.js';

export const DOWNLOAD_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const RUNNING_HEADERS: Record<string, string> = {
  MSA: 'MASTER SERVICES AGREEMENT',
  CPA: 'CPA AGREEMENT · PAY-PER-APPLICATION',
  CPL: 'CPL AGREEMENT · PAY-PER-CALL',
};

export function executedFileName(agencyLegalName: string, kind: string, reference: string): string {
  return `${slugify(agencyLegalName)}-${kind.toLowerCase()}-executed-${reference}.pdf`;
}

export function adminEnvelopeUrl(envelopeId: string): string {
  return `${defaultPortalUrl()}/admin/agreements/${envelopeId}`;
}

export function downloadPageUrl(token: string): string {
  return `${defaultPortalUrl()}/agreements/${token}`;
}

/** Read a stored executed PDF and refuse it unless its hash matches. */
export async function readVerifiedPdf(doc: AgreementDocument): Promise<Buffer> {
  if (!doc.executedPdfKey || !doc.executedPdfSha256) {
    throw new Error(`Document ${doc.id} has no executed PDF`);
  }
  const bytes = await getAgreementsStorageService().getObjectBuffer(doc.executedPdfKey);
  const actual = sha256Hex(bytes);
  if (actual !== doc.executedPdfSha256) {
    const error = new Error(
      `Executed PDF ${doc.executedPdfKey} does not match its recorded SHA-256`
    ) as Error & { code: string; actual: string };
    error.code = 'AGREEMENT_PDF_HASH_MISMATCH';
    error.actual = actual;
    throw error;
  }
  return bytes;
}

export interface CompletionResult {
  status: 'COMPLETED';
  /** Only when this run minted it. */
  downloadToken: string | null;
  alreadyCompleted: boolean;
}

const inFlight = new Map<string, Promise<CompletionResult>>();

export function completeEnvelope(
  envelopeId: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<CompletionResult> {
  const running = inFlight.get(envelopeId);
  if (running) return running;
  const run = runCompletion(envelopeId, prisma).finally(() => inFlight.delete(envelopeId));
  inFlight.set(envelopeId, run);
  return run;
}

async function runCompletion(envelopeId: string, prisma: PrismaClient): Promise<CompletionResult> {
  const envelope = await prisma.agreementEnvelope.findUnique({
    where: { id: envelopeId },
    include: { documents: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!envelope) throw new Error(`Envelope ${envelopeId} not found`);
  if (envelope.status === 'COMPLETED') {
    return { status: 'COMPLETED', downloadToken: null, alreadyCompleted: true };
  }
  if (envelope.status !== 'SIGNED') {
    throw new Error(`Envelope ${envelope.reference} is ${envelope.status}, not SIGNED`);
  }
  if (!envelope.signedAt || !envelope.signerTypedSignature || !envelope.signerInitials) {
    throw new Error(`Envelope ${envelope.reference} has no committed signature`);
  }

  const terms = envelope.terms as unknown as FrozenTerms;
  const settings = await loadAgreementSettings(prisma);
  const noticeEmail = noticeEmailOf(settings);
  const storage = getAgreementsStorageService();
  const completedAt = new Date();
  const seal = sealConfig();
  if (!seal) warnUnsealed();

  const [events, sender] = await Promise.all([
    prisma.agreementEvent.findMany({ where: { envelopeId }, orderBy: { seq: 'asc' } }),
    prisma.user.findUnique({ where: { id: envelope.sentByUserId }, select: { email: true } }),
  ]);
  const signedEvent = [...events].reverse().find(e => e.type === 'SIGNED');
  const signedDetail = (signedEvent?.detail ?? {}) as Record<string, unknown>;
  const signerTitle =
    typeof signedDetail.title === 'string' ? signedDetail.title : envelope.signerTitle;

  let drawnPngDataUri: string | null = null;
  if (envelope.signatureMethod === 'DRAWN' && envelope.signatureImageKey) {
    const png = await storage.getObjectBuffer(envelope.signatureImageKey);
    drawnPngDataUri = `data:image/png;base64,${png.toString('base64')}`;
  }

  const pending = envelope.documents.filter(doc => !doc.executedPdfKey);
  if (pending.length > 0) {
    await withBrowser(async browser => {
      for (const doc of pending) {
        const executedHtml = renderExecutedHtml(doc.sentHtml, {
          method: envelope.signatureMethod === 'DRAWN' ? 'DRAWN' : 'TYPED',
          typedName: envelope.signerTypedSignature!,
          drawnPngDataUri,
          printedName: envelope.signerName,
          title: signerTitle,
          signedDate: etDateIso(envelope.signedAt!),
        });

        const contentPdf = await printHtml(browser, executedHtml, {
          header: headerTemplate(RUNNING_HEADERS[doc.kind]),
          footer: documentFooterTemplate(envelope.reference, envelope.signerInitials),
        });
        const contentSha256 = sha256Hex(contentPdf);
        const contentPageCount = await pdfPageCount(contentPdf);

        const certificateHtml = renderCertificate({
          portalUrl: defaultPortalUrl(),
          envelope,
          document: doc,
          contentSha256,
          contentPageCount,
          completedAt,
          agencyLegalName: terms.agency.legalName,
          drawnPngDataUri,
          netenrollAdminEmail: sender?.email ?? null,
          internalCopyEmails: settings.internalCopyEmails,
          events,
        });
        const certificatePdf = await printHtml(browser, certificateHtml, {
          header: '<span></span>',
          footer: certificateFooterTemplate(envelope.reference),
        });

        const merged = await mergePdfs(contentPdf, certificatePdf, {
          title: `${doc.title} — ${terms.agency.legalName}`,
          author: 'PVN LLC d/b/a NetEnroll',
          subject: `Executed agreement ${envelope.reference}`,
          keywords: [envelope.reference],
          creator: 'NetEnroll Agreements',
          creationDate: completedAt,
        });
        const finalPdf = seal
          ? await sealPdf(merged, seal, {
              reason: `Executed agreement ${envelope.reference}`,
              location: 'Saint Augustine, Florida',
              contactInfo: noticeEmail,
              name: 'PVN LLC d/b/a NetEnroll',
              signingTime: completedAt,
            })
          : merged;

        const executedPdfSha256 = sha256Hex(finalPdf);
        const key = `agreements/${envelope.id}/${doc.id}-executed.pdf`;
        await storage.putObjectOnce(key, finalPdf, 'application/pdf');
        await prisma.agreementDocument.update({
          where: { id: doc.id },
          data: {
            contentPdfSha256: contentSha256,
            executedPdfKey: key,
            executedPdfSha256,
            executedPdfBytes: finalPdf.length,
            pageCount: contentPageCount,
          },
        });
      }
    });
  }

  const documents = await prisma.agreementDocument.findMany({
    where: { envelopeId },
    orderBy: { sortOrder: 'asc' },
  });
  // Every stored file is re-read and re-hashed before it is declared executed.
  const files: Array<ExecutedFile & { kind: string }> = [];
  for (const doc of documents) {
    const content = await readVerifiedPdf(doc);
    files.push({
      kind: doc.kind,
      filename: executedFileName(terms.agency.legalName, doc.kind, envelope.reference),
      sha256: doc.executedPdfSha256!,
      content,
    });
  }

  const download = mintToken();
  const finished = await prisma.$transaction(async tx => {
    const claimed = await tx.agreementEnvelope.updateMany({
      where: { id: envelopeId, status: 'SIGNED' },
      data: {
        status: 'COMPLETED',
        completedAt,
        sealed: seal !== null,
        downloadTokenHash: download.hash,
        downloadTokenExpiresAt: new Date(completedAt.getTime() + DOWNLOAD_TOKEN_TTL_MS),
      },
    });
    if (claimed.count === 0) return false;
    await appendEvent(tx, envelopeId, {
      type: 'COMPLETED',
      actorType: 'SYSTEM',
      occurredAt: completedAt,
      detail: {
        sealed: seal !== null,
        documents: documents.map(doc => ({
          documentId: doc.id,
          kind: doc.kind,
          executedPdfSha256: doc.executedPdfSha256,
          contentPdfSha256: doc.contentPdfSha256,
          pageCount: doc.pageCount,
        })),
      },
    });
    return true;
  });
  if (!finished) {
    return { status: 'COMPLETED', downloadToken: null, alreadyCompleted: true };
  }

  // The full set for the client: the earlier executed MSA when this envelope
  // only carried campaign agreements.
  const attachments: ExecutedFile[] = [...files];
  if (!envelope.includesMsa && envelope.existingMsaEnvelopeId) {
    try {
      const msaEnvelope = await prisma.agreementEnvelope.findUnique({
        where: { id: envelope.existingMsaEnvelopeId },
        include: { documents: { where: { kind: 'MSA' } } },
      });
      const msaDoc = msaEnvelope?.documents[0];
      if (msaEnvelope && msaDoc?.executedPdfKey) {
        const msaTerms = msaEnvelope.terms as unknown as FrozenTerms;
        attachments.push({
          filename: executedFileName(msaTerms.agency.legalName, 'MSA', msaEnvelope.reference),
          sha256: msaDoc.executedPdfSha256!,
          content: await readVerifiedPdf(msaDoc),
        });
      }
    } catch (error) {
      logger.error({ msg: 'Could not attach the earlier executed MSA', envelopeId, err: error });
    }
  }

  await deliverExecutedCopies({
    prisma,
    envelopeId,
    trigger: 'completion',
    downloadToken: download.token,
    attachments,
    senderEmail: sender?.email ?? null,
  });

  if (envelope.tenantId) {
    await auditLog({
      tenantId: envelope.tenantId,
      action: 'agreements.completed',
      entityType: 'AgreementEnvelope',
      entityId: envelope.id,
      changes: {
        reference: envelope.reference,
        documents: documents.map(doc => ({
          kind: doc.kind,
          executedPdfSha256: doc.executedPdfSha256,
        })),
        sealed: seal !== null,
      },
      success: true,
    });
  }

  return { status: 'COMPLETED', downloadToken: download.token, alreadyCompleted: false };
}

/**
 * Email the executed PDFs: one message to the signer (copy recipients in CC),
 * and NetEnroll's own copy to the internal addresses and the sending admin.
 * Records a COPIES_SENT event either way, naming what was accepted.
 */
export async function deliverExecutedCopies(params: {
  prisma: PrismaClient;
  envelopeId: string;
  trigger: 'completion' | 'admin';
  downloadToken: string;
  attachments?: ExecutedFile[];
  senderEmail?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ signerSent: boolean; internalSent: boolean }> {
  const { prisma } = params;
  const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
    where: { id: params.envelopeId },
    include: { documents: { orderBy: { sortOrder: 'asc' } } },
  });
  const terms = envelope.terms as unknown as FrozenTerms;
  const settings = await loadAgreementSettings(prisma);
  const noticeEmail = noticeEmailOf(settings);

  let attachments = params.attachments;
  if (!attachments) {
    attachments = [];
    for (const doc of envelope.documents) {
      attachments.push({
        filename: executedFileName(terms.agency.legalName, doc.kind, envelope.reference),
        sha256: doc.executedPdfSha256!,
        content: await readVerifiedPdf(doc),
      });
    }
  }

  const signer = await sendCompletedEmail({
    to: envelope.signerEmail,
    cc: envelope.ccEmails,
    agencyLegalName: terms.agency.legalName,
    reference: envelope.reference,
    files: attachments,
    downloadUrl: downloadPageUrl(params.downloadToken),
    noticeEmail,
  });

  const internalTo = Array.from(
    new Set(
      [...settings.internalCopyEmails, params.senderEmail ?? '']
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const internal = await sendInternalCompletedEmail({
    to: internalTo,
    agencyLegalName: terms.agency.legalName,
    reference: envelope.reference,
    files: attachments,
    adminUrl: adminEnvelopeUrl(envelope.id),
  });

  await prisma.$transaction(tx =>
    appendEvent(tx, envelope.id, {
      type: 'COPIES_SENT',
      actorType: params.trigger === 'admin' ? 'NETENROLL' : 'SYSTEM',
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      detail: {
        trigger: params.trigger,
        sent: signer.sent,
        reason: signer.reason ?? null,
        to: envelope.signerEmail,
        cc: envelope.ccEmails,
        internal: internalTo,
        internalSent: internal.sent,
        files: attachments.map(a => ({ filename: a.filename, sha256: a.sha256 })),
      },
    })
  );

  return { signerSent: signer.sent, internalSent: internal.sent };
}
