'use client';

import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  EVENT_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  VERTICALS,
  VERTICAL_NAMES,
  downloadWithSession,
  etDateTime,
  fileSize,
  type EnvelopeSummary,
} from '@/lib/agreements';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * One envelope: its frozen terms, its documents and their hashes, every event
 * on its audit trail, and the actions still open on it.
 */

interface AgreementDetail extends EnvelopeSummary {
  terms: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- frozen JSON, read for display
  existingMsa: { id: string; reference: string } | null;
  netenrollSignatoryName: string;
  netenrollSignatoryTitle: string;
  netenrollSignedAt: string;
  netenrollSignedIp: string | null;
  sentByEmail: string | null;
  voidReason: string | null;
  changesNote: string | null;
  signerTypedSignature: string | null;
  signerInitials: string | null;
  signatureMethod: 'TYPED' | 'DRAWN' | null;
  documents: Array<{
    id: string;
    kind: string;
    title: string;
    templateVersion: string;
    sentHtmlSha256: string;
    contentPdfSha256: string | null;
    executedPdfSha256: string | null;
    executedPdfBytes: number | null;
    pageCount: number | null;
    fileName: string;
  }>;
  events: Array<{
    seq: number;
    type: string;
    occurredAt: string;
    actorType: string;
    actorEmail: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    detail: Record<string, unknown>;
    hash: string;
  }>;
  chainValid: boolean;
  chainBrokenAt: number | null;
}

function Hash({ value }: { value: string | null }): JSX.Element {
  if (!value) return <span className="text-ink-3">—</span>;
  return (
    <code className="break-all font-mono text-[11px] text-ink-2" title={value}>
      {value}
    </code>
  );
}

function money(value: unknown): string {
  return typeof value === 'number'
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-rule py-1.5 text-sm last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

export default function AgreementDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [detail, setDetail] = useState<AgreementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [sentHtml, setSentHtml] = useState<{ title: string; html: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const response = await apiClient.get<Envelope<AgreementDetail>>(
      `/api/v1/platform/agreements/${id}`
    );
    setError(response.error ? response.error.message : null);
    setDetail(payload(response) ?? null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(
    name: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown> | null> {
    setBusy(name);
    setError(null);
    setNotice(null);
    const response = await apiClient.post<Envelope<Record<string, unknown>>>(path, body ?? {});
    setBusy(null);
    if (response.error) {
      setError(response.error.message);
      await load();
      return null;
    }
    await load();
    return payload(response) ?? null;
  }

  if (!detail) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12 text-ink-3">
          {error ?? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading agreement
            </>
          )}
        </div>
      </div>
    );
  }

  const terms = detail.terms;
  const open = detail.status === 'SENT' || detail.status === 'VIEWED';

  return (
    <div className="page-canvas">
      <PageHeader
        title={`${detail.reference} · ${detail.agencyLegalName}`}
        description={`Sent ${etDateTime(detail.sentAt)}${detail.sentByEmail ? ` by ${detail.sentByEmail}` : ''}. Expires ${etDateTime(detail.expiresAt)}.`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_TONES[detail.status]}>{STATUS_LABELS[detail.status]}</Badge>
            {detail.status === 'COMPLETED' &&
              (detail.sealed ? (
                <Badge variant="success">Sealed</Badge>
              ) : (
                <Badge
                  variant="warning"
                  title="No seal certificate was configured when this completed"
                >
                  Unsealed
                </Badge>
              ))}
            {detail.chainValid ? (
              <span className="inline-flex items-center gap-1 text-xs text-live-ink">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Audit trail verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-dropped-ink">
                <ShieldAlert className="h-3.5 w-3.5" />
                Audit trail failed verification at event {detail.chainBrokenAt}
              </span>
            )}
          </div>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/agreements">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Agreements
            </Link>
          </Button>
        }
      />

      {error && <p className="text-sm text-dropped-ink">{error}</p>}
      {notice && <p className="text-sm text-ink-2">{notice}</p>}
      {link && (
        <Panel className="border-ringing bg-ringing-tint">
          <PanelBody className="space-y-2">
            <p className="text-sm font-medium">
              The email was not sent. Send the signer this link yourself.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-control bg-surface p-2 text-xs">
                {link}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard.writeText(link)}
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </PanelBody>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel>
            <PanelHeader>
              <PanelTitle>Documents</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-4">
              {detail.documents.map(doc => (
                <div
                  key={doc.id}
                  className="space-y-1 border-b border-rule pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{doc.title}</span>
                    <Badge variant="outline" className="t-meta">
                      {doc.templateVersion}
                    </Badge>
                    {doc.pageCount && (
                      <span className="text-xs text-ink-3">{doc.pageCount} pages</span>
                    )}
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void (async () => {
                            const token = localStorage.getItem('token');
                            const response = await fetch(
                              `/api/v1/platform/agreements/${detail.id}/documents/${doc.id}/sent.html`,
                              { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                            );
                            if (response.ok)
                              setSentHtml({ title: doc.title, html: await response.text() });
                            else setError('The as-sent document could not be loaded.');
                          })()
                        }
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        View as sent
                      </Button>
                      {detail.status === 'COMPLETED' && doc.executedPdfSha256 && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void (async () => {
                              const failure = await downloadWithSession(
                                `/api/v1/platform/agreements/${detail.id}/documents/${doc.id}.pdf`,
                                doc.fileName
                              );
                              if (failure) setError(failure);
                            })()
                          }
                        >
                          <Download className="mr-1 h-3.5 w-3.5" />
                          Download PDF{' '}
                          {fileSize(doc.executedPdfBytes) !== '—' &&
                            `(${fileSize(doc.executedPdfBytes)})`}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-ink-3">As-sent SHA-256</span>
                    <Hash value={doc.sentHtmlSha256} />
                    <span className="text-ink-3">Executed PDF SHA-256</span>
                    <Hash value={doc.executedPdfSha256} />
                  </div>
                </div>
              ))}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Timeline</PanelTitle>
            </PanelHeader>
            <PanelBody className="overflow-x-auto p-0 min-[1440px]:p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Time (ET)</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Actor</th>
                    <th className="px-3 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.events.map(event => (
                    <tr key={event.seq} className="border-b border-rule align-top last:border-0">
                      <td className="px-3 py-1.5 text-xs text-ink-3">{event.seq}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {etDateTime(event.occurredAt)}
                      </td>
                      <td className="px-3 py-1.5">
                        <div title={JSON.stringify(event.detail, null, 2)}>
                          {EVENT_LABELS[event.type] ?? event.type}
                        </div>
                        {event.type === 'COMPLETION_FAILED' &&
                          typeof event.detail.error === 'string' && (
                            <div className="text-xs text-dropped-ink">{event.detail.error}</div>
                          )}
                        {event.type === 'DOCUMENT_REVIEWED' && (
                          <div className="text-xs text-ink-3">
                            {String(event.detail.kind ?? '')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {event.actorType === 'NETENROLL'
                          ? 'NetEnroll'
                          : event.actorType === 'SIGNER'
                            ? 'Signer'
                            : 'System'}
                        {event.actorEmail && <div className="text-ink-3">{event.actorEmail}</div>}
                      </td>
                      <td
                        className="px-3 py-1.5 font-mono text-xs"
                        title={event.userAgent ?? undefined}
                      >
                        {event.ipAddress ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>Actions</PanelTitle>
            </PanelHeader>
            <PanelBody className="flex flex-col gap-2">
              {open && (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void (async () => {
                      const result = await action(
                        'resend',
                        `/api/v1/platform/agreements/${detail.id}/resend`
                      );
                      if (!result) return;
                      if (result.emailSent) setNotice('The signing link was emailed again.');
                      else setLink(String(result.signUrl));
                    })()
                  }
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  Resend link
                </Button>
              )}
              {detail.status === 'SIGNED' && (
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    void (async () => {
                      const result = await action(
                        'complete',
                        `/api/v1/platform/agreements/${detail.id}/complete`
                      );
                      if (result) setNotice('Completed. The executed copies were emailed.');
                    })()
                  }
                >
                  {busy === 'complete' ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                  )}
                  Retry completion
                </Button>
              )}
              {detail.status === 'COMPLETED' && (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void (async () => {
                      const result = await action(
                        'copies',
                        `/api/v1/platform/agreements/${detail.id}/send-copies`
                      );
                      if (!result) return;
                      setNotice(
                        result.emailSent
                          ? 'Copies sent again with a new 12-month download link.'
                          : `The email was not sent. New download link: ${String(result.downloadUrl)}`
                      );
                    })()
                  }
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  Send copies again
                </Button>
              )}
              {detail.status !== 'COMPLETED' && detail.status !== 'VOIDED' && (
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => setVoidOpen(true)}
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  Void
                </Button>
              )}
              {detail.status === 'COMPLETED' && (
                <p className="text-[11px] text-ink-3">
                  A completed agreement is not voidable here. It is terminated under Section 15 of
                  the MSA.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Parties &amp; terms</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <Row label="Agency">{terms.agency.legalName}</Row>
              <Row label="State / entity">{terms.agency.stateEntityType}</Row>
              <Row label="Notice address">{terms.agency.noticeAddress}</Row>
              <Row label="Principal">
                {terms.agency.principalName}, {terms.agency.principalTitle}
              </Row>
              <Row label="Notice">
                {terms.agency.noticeEmail} · {terms.agency.noticePhone}
              </Row>
              <Row label="Billing">
                {terms.agency.billingEmail} · {terms.agency.billingPhone}
              </Row>
              <Row label="Effective date">{terms.effectiveDate}</Row>
              {detail.existingMsa && (
                <Row label="Existing MSA">
                  <Link className="underline" href={`/admin/agreements/${detail.existingMsa.id}`}>
                    {detail.existingMsa.reference}
                  </Link>{' '}
                  (effective {terms.msaEffectiveDate})
                </Row>
              )}
              <Row label="Signer">
                {detail.signerName}, {detail.signerTitle}
                <div className="text-xs text-ink-3">{detail.signerEmail}</div>
              </Row>
              {detail.ccEmails.length > 0 && (
                <Row label="Copies to">{detail.ccEmails.join(', ')}</Row>
              )}
              <Row label="NetEnroll">
                {detail.netenrollSignatoryName}, {detail.netenrollSignatoryTitle}
                <div className="text-xs text-ink-3">
                  Signed {etDateTime(detail.netenrollSignedAt)}
                  {detail.netenrollSignedIp && ` from ${detail.netenrollSignedIp}`}
                </div>
              </Row>
              {detail.signedAt && (
                <Row label="Agency signature">
                  {detail.signerTypedSignature} ({detail.signerInitials}) ·{' '}
                  {detail.signatureMethod === 'DRAWN' ? 'drawn' : 'typed'}
                  <div className="text-xs text-ink-3">Signed {etDateTime(detail.signedAt)}</div>
                </Row>
              )}
              {detail.voidReason && <Row label="Void reason">{detail.voidReason}</Row>}
              {detail.changesNote && <Row label="Changes requested">{detail.changesNote}</Row>}
              {(['cpa', 'cpl'] as const).map(kind =>
                terms[kind] ? (
                  <div key={kind} className="mt-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                      {kind.toUpperCase()} terms
                    </div>
                    {VERTICALS.filter(v => terms[kind].verticals[v].selected).map(v => {
                      const row = terms[kind].verticals[v];
                      return (
                        <Row key={v} label={VERTICAL_NAMES[v]}>
                          {money(row.rate)} · daily block {row.dailyBlock}
                          {kind === 'cpl' && ` · buffer ${row.bufferSeconds}s`}
                        </Row>
                      );
                    })}
                    <Row label="Delivery">
                      {terms[kind].deliveryDays.join(', ')} · {terms[kind].deliveryStart}–
                      {terms[kind].deliveryEnd} ET
                      {terms[kind].firstDeliveryDay &&
                        ` · first day ${terms[kind].firstDeliveryDay}`}
                    </Row>
                  </div>
                ) : null
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {detail.reference}</DialogTitle>
            <DialogDescription>
              The signing link stops working and the signer is emailed that the agreements were
              withdrawn. The reason is recorded on the audit trail; it is not sent to the signer.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
            placeholder="Why are these agreements being withdrawn?"
            rows={3}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!voidReason.trim() || busy !== null}
              onClick={() =>
                void (async () => {
                  const result = await action(
                    'void',
                    `/api/v1/platform/agreements/${detail.id}/void`,
                    {
                      reason: voidReason.trim(),
                    }
                  );
                  if (result) {
                    setVoidOpen(false);
                    setNotice('Voided.');
                  }
                })()
              }
            >
              Void agreements
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sentHtml !== null} onOpenChange={o => !o && setSentHtml(null)}>
        <DialogContent className="flex h-[92vh] max-w-[min(96vw,1000px)] flex-col gap-3 p-4">
          <DialogHeader>
            <DialogTitle>{sentHtml?.title} — as sent</DialogTitle>
            <DialogDescription>
              The exact document the signer reviewed, before signature.
            </DialogDescription>
          </DialogHeader>
          {sentHtml && (
            <iframe
              title={sentHtml.title}
              srcDoc={sentHtml.html}
              sandbox=""
              className="min-h-0 w-full flex-1 rounded-control border border-rule bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
