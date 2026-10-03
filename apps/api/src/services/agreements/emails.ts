/**
 * Every email the agreements feature sends.
 *
 * In the ISSUER's name and brand: the suite that sent the envelope, frozen on
 * it (`issuer.ts`). A NetEnroll envelope reads exactly as it always has --
 * "PVN LLC d/b/a NetEnroll", NetEnroll's look, links on the default portal. A
 * white-label issuer's reads in its own legal name and brand, from its own
 * display name, with links on its own portal domain. The RECIPIENT agency's
 * brand and the host anybody is on play no part.
 *
 * Best-effort, in the posture of `services/agent-invite-email.ts`: a failed
 * send never fails the record. Each function says whether a transport accepted
 * the message, and the caller records and reports that.
 */

import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { logger } from '../../lib/logger.js';
import { defaultPortalUrl } from '../../lib/tenant-brand.js';
import { netEnrollEmailBrand, type EmailBrand } from '../email-brand.js';
import { escapeHtml, renderEmail } from '../publisher-email.js';

import { etLongDate, joinList } from './format.js';
import { documentBrandFor, legacyNetEnrollIssuer, type IssuerPresentation } from './issuer.js';

/** The issuer an email is sent for. NetEnroll when a caller passes none. */
type MaybeIssuer = { issuer?: IssuerPresentation };

function issuerOr(params: MaybeIssuer, noticeEmail: string): IssuerPresentation {
  return params.issuer ?? legacyNetEnrollIssuer(noticeEmail);
}

function fromHeader(displayName: string): string {
  const configured = process.env.SMTP_FROM || 'noreply@netenroll.com';
  const match = /<([^>]+)>/.exec(configured);
  const address = match ? match[1] : configured;
  const safeName = displayName.replace(/["<>\r\n]/g, '').trim();
  return `${safeName} <${address}>`;
}

/** The email frame for an issuer: NetEnroll's own for NetEnroll. */
export function emailBrandForIssuer(issuer: IssuerPresentation): EmailBrand {
  if (issuer.scope === 'PLATFORM') return netEnrollEmailBrand();
  return {
    branded: true,
    productName: issuer.displayName,
    logoUrl: issuer.brandTheme
      ? `${defaultPortalUrl()}/brands/${issuer.brandTheme}/logo.png`
      : null,
    linkBase: issuer.linkOrigin,
    from: fromHeader(issuer.displayName),
    signOff: `The ${issuer.displayName} team`,
  };
}

export interface EmailResult {
  sent: boolean;
  reason?: 'not_configured' | 'send_failed' | 'no_recipients';
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function transporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  return createTransport({
    host,
    port,
    // TLS is required, not opportunistic. See services/agent-invite-email.ts.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
  });
}

const BUTTON =
  'display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;';

function button(href: string, label: string, issuer?: IssuerPresentation): string {
  const style =
    issuer && issuer.scope !== 'PLATFORM'
      ? BUTTON.replace('#10b981', documentBrandFor(issuer).accent)
      : BUTTON;
  return `<p style="margin:20px 0;"><a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a></p>`;
}

async function send(message: {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  title: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  kind: string;
  issuer?: IssuerPresentation;
}): Promise<EmailResult> {
  const to = message.to.filter(Boolean);
  if (to.length === 0) return { sent: false, reason: 'no_recipients' };
  const transport = transporter();
  if (!transport) {
    logger.info({ msg: `Agreement email not sent: SMTP is not configured`, kind: message.kind });
    return { sent: false, reason: 'not_configured' };
  }
  const brand = message.issuer ? emailBrandForIssuer(message.issuer) : netEnrollEmailBrand();
  try {
    await transport.sendMail({
      from: brand.from,
      to,
      cc: message.cc && message.cc.length > 0 ? message.cc : undefined,
      replyTo: message.replyTo || undefined,
      subject: message.subject,
      text: `${message.text}\n\nBest regards,\n${brand.signOff}`,
      html: renderEmail({ brand, title: message.title, body: message.html }),
      attachments: message.attachments?.map(a => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType ?? 'application/pdf',
      })),
    });
    logger.info({ msg: 'Agreement email sent', kind: message.kind });
    return { sent: true };
  } catch (error) {
    logger.error({ msg: 'Agreement email could not be sent', kind: message.kind, err: error });
    return { sent: false, reason: 'send_failed' };
  }
}

// ── 1. Invitation ────────────────────────────────────────────────────────────

export function sendInvitationEmail(
  params: {
    to: string;
    signerName: string;
    /** NetEnroll's label for the agency, when it gave one. */
    agencyLegalName: string | null;
    documentTitles: string[];
    signUrl: string;
    /** Whether the agency still has to enter its own details. */
    detailsToEnter?: boolean;
    expiresAt: Date;
    noticeEmail: string;
    resend?: boolean;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, params.noticeEmail);
  const expires = etLongDate(params.expiresAt);
  const list = params.documentTitles;
  const text = `Hello ${params.signerName},

${issuer.legalName} has prepared the following for your review and electronic signature:
${list.map(t => `  - ${t}`).join('\n')}

${issuer.shortName}'s authorized signatory has already signed.${
    params.detailsToEnter === false
      ? ''
      : `

Before you sign you will be asked for your details: your business (legal name, state, entity type, principal) or, if you contract as an individual licensed agent, your own.`
  }

Review and sign:
${params.signUrl}

For your security we will email a one-time verification code to this address when you open the link.

This link expires on ${expires}.

Questions? Reply to ${params.noticeEmail}.`;

  const html = `<p>Hello ${escapeHtml(params.signerName)},</p>
<p>${escapeHtml(issuer.legalName)} has prepared the following for your review and electronic signature:</p>
<ul>${list.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
<p>${escapeHtml(issuer.shortName)}'s authorized signatory has already signed.</p>
${params.detailsToEnter === false ? '' : '<p>Before you sign you will be asked for your details: your business (legal name, state, entity type, principal) or, if you contract as an individual licensed agent, your own.</p>'}
${button(params.signUrl, 'Review and sign', issuer)}
<p style="color:#55524b;">For your security we will email a one-time verification code to this address when you open the link.</p>
<p style="color:#55524b;">This link expires on <strong>${escapeHtml(expires)}</strong>.</p>
<p style="color:#55524b;">Questions? Reply to ${escapeHtml(params.noticeEmail)}.</p>`;

  return send({
    kind: params.resend ? 'invitation-resend' : 'invitation',
    issuer: params.issuer,
    to: [params.to],
    replyTo: issuer.replyToEmail,
    subject: params.agencyLegalName
      ? `Agreements from ${issuer.shortName} ready for your signature: ${params.agencyLegalName}`
      : `Agreements from ${issuer.shortName} ready for your signature`,
    title: 'Agreements ready for your signature',
    html,
    text,
  });
}

// ── 2. Verification code ─────────────────────────────────────────────────────

export function sendOtpEmail(
  params: {
    to: string;
    code: string;
    noticeEmail: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, params.noticeEmail);
  const text = `Your ${issuer.shortName} verification code is ${params.code}

It is valid for 10 minutes. If you did not request it, you can ignore this message.`;
  const html = `<p>Your ${escapeHtml(issuer.shortName)} verification code is:</p>
<p style="margin:16px 0;font-size:28px;font-weight:700;letter-spacing:0.25em;font-family:Menlo,Consolas,monospace;">${escapeHtml(params.code)}</p>
<p style="color:#55524b;">It is valid for 10 minutes. If you did not request it, you can ignore this message.</p>`;
  return send({
    kind: 'otp',
    issuer: params.issuer,
    to: [params.to],
    replyTo: issuer.replyToEmail,
    subject: `Your ${issuer.shortName} verification code`,
    title: 'Your verification code',
    html,
    text,
  });
}

// ── 3. Completed ─────────────────────────────────────────────────────────────

export interface ExecutedFile {
  filename: string;
  sha256: string;
  content: Buffer;
}

function completedBody(params: {
  agencyLegalName: string;
  reference: string;
  files: ExecutedFile[];
  downloadUrl: string | null;
  issuer: IssuerPresentation;
}): { html: string; text: string } {
  const text = `The agreements between ${params.agencyLegalName} and ${params.issuer.legalName} are fully executed (reference ${params.reference}).

${params.files.map(f => `${f.filename}\n  SHA-256: ${f.sha256}`).join('\n')}
${params.downloadUrl ? `\nDownload your agreements (link valid for 12 months):\n${params.downloadUrl}\n` : ''}
Keep these PDFs with your records. Each one includes a Certificate of Completion.`;
  const html = `<p>The agreements between ${escapeHtml(params.agencyLegalName)} and ${escapeHtml(params.issuer.legalName)} are fully executed (reference <strong>${escapeHtml(params.reference)}</strong>).</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:8px 0;">${params.files
    .map(
      f =>
        `<tr><td style="padding:6px 0;border-top:1px solid #e4e0d8;"><div style="font-weight:600;">${escapeHtml(f.filename)}</div><div style="font-family:Menlo,Consolas,monospace;font-size:11px;color:#55524b;word-break:break-all;">SHA-256 ${escapeHtml(f.sha256)}</div></td></tr>`
    )
    .join('')}</table>
${params.downloadUrl ? `${button(params.downloadUrl, 'Download your agreements', params.issuer)}<p style="color:#8a867c;font-size:13px;">The download link is valid for 12 months.</p>` : ''}
<p>Keep these PDFs with your records. Each one includes a Certificate of Completion.</p>`;
  return { html, text };
}

export function sendCompletedEmail(
  params: {
    to: string;
    cc: string[];
    agencyLegalName: string;
    reference: string;
    files: ExecutedFile[];
    downloadUrl: string;
    noticeEmail: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, params.noticeEmail);
  const { html, text } = completedBody({ ...params, issuer });
  return send({
    kind: 'completed',
    issuer: params.issuer,
    to: [params.to],
    cc: params.cc,
    replyTo: issuer.replyToEmail,
    subject: `Executed agreements: ${params.agencyLegalName} and ${issuer.shortName} (${params.reference})`,
    title: 'Your agreements are fully executed',
    html,
    text,
    attachments: params.files.map(f => ({ filename: f.filename, content: f.content })),
  });
}

/** The issuer's own copy: its internal addresses and the sending user. */
export function sendInternalCompletedEmail(
  params: {
    to: string[];
    agencyLegalName: string;
    reference: string;
    files: ExecutedFile[];
    adminUrl: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, '');
  const body = completedBody({ ...params, downloadUrl: null, issuer });
  return send({
    kind: 'internal-completed',
    issuer: params.issuer,
    to: params.to,
    subject: `Executed agreements: ${params.agencyLegalName} and ${issuer.shortName} (${params.reference})`,
    title: 'Agreements fully executed',
    html: `${body.html}${button(params.adminUrl, `Open in ${issuer.shortName}`, issuer)}`,
    text: `${body.text}\n\nOpen in ${issuer.shortName}: ${params.adminUrl}`,
    attachments: params.files.map(f => ({ filename: f.filename, content: f.content })),
  });
}

// ── 4. Voided ────────────────────────────────────────────────────────────────

export function sendVoidedEmail(
  params: {
    to: string;
    reference: string;
    documentTitles: string[];
    noticeEmail: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, params.noticeEmail);
  const docs = joinList(params.documentTitles.map(t => `the ${t}`));
  const sentence = `${issuer.shortName} has withdrawn ${docs} sent to you for signature under reference ${params.reference}. The signing link no longer works and nothing further is needed from you. If you have questions, contact ${params.noticeEmail}.`;
  return send({
    kind: 'voided',
    issuer: params.issuer,
    to: [params.to],
    replyTo: issuer.replyToEmail,
    subject: `Agreements withdrawn: ${params.reference}`,
    title: 'Agreements withdrawn',
    html: `<p>${escapeHtml(sentence)}</p>`,
    text: sentence,
  });
}

// ── 5. Internal alerts ───────────────────────────────────────────────────────

export function sendChangesRequestedAlert(
  params: {
    to: string[];
    reference: string;
    agencyLegalName: string;
    signerName: string;
    signerEmail: string;
    note: string;
    adminUrl: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, '');
  const text = `${params.signerName} (${params.signerEmail}) asked for changes to the agreements for ${params.agencyLegalName} (${params.reference}). The signing link no longer works.

Their note:
${params.note}

Open in ${issuer.shortName}: ${params.adminUrl}`;
  const html = `<p>${escapeHtml(params.signerName)} (${escapeHtml(params.signerEmail)}) asked for changes to the agreements for <strong>${escapeHtml(params.agencyLegalName)}</strong> (${escapeHtml(params.reference)}). The signing link no longer works.</p>
<p style="margin:12px 0 4px;font-weight:600;">Their note</p>
<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #10b981;background:#f5f9f7;white-space:pre-wrap;">${escapeHtml(params.note)}</blockquote>
${button(params.adminUrl, `Open in ${issuer.shortName}`, issuer)}`;
  return send({
    kind: 'changes-requested',
    issuer: params.issuer,
    to: params.to,
    replyTo: params.signerEmail,
    subject: `Changes requested: ${params.agencyLegalName} (${params.reference})`,
    title: 'Changes requested',
    html,
    text,
  });
}

export function sendCompletionFailedAlert(
  params: {
    to: string[];
    reference: string;
    agencyLegalName: string;
    error: string;
    adminUrl: string;
  } & MaybeIssuer
): Promise<EmailResult> {
  const issuer = issuerOr(params, '');
  const text = `The signature on ${params.reference} (${params.agencyLegalName}) is recorded, but producing the executed PDFs failed:

${params.error}

The envelope stays SIGNED. Retry completion from: ${params.adminUrl}`;
  const html = `<p>The signature on <strong>${escapeHtml(params.reference)}</strong> (${escapeHtml(params.agencyLegalName)}) is recorded, but producing the executed PDFs failed:</p>
<pre style="white-space:pre-wrap;background:#f5f5f4;padding:8px;border-radius:4px;font-size:12px;">${escapeHtml(params.error)}</pre>
<p>The envelope stays SIGNED. Retry completion from the agreement's page.</p>
${button(params.adminUrl, `Open in ${issuer.shortName}`, issuer)}`;
  return send({
    kind: 'completion-failed',
    issuer: params.issuer,
    to: params.to,
    subject: `Completion failed: ${params.reference}`,
    title: 'Completion failed',
    html,
    text,
  });
}
