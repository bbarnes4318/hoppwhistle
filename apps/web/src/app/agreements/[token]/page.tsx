'use client';

import { Check, Copy, Download, FileText, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  IssuerBrandScope,
  IssuerLogo,
  NETENROLL_ISSUER,
  type PublicIssuer,
} from '@/components/agreements/issuer-brand';
import { Button } from '@/components/ui/button';
import { etDate, fileSize, saveBlob } from '@/lib/agreements';

/**
 * The client's executed agreements, from the link in the completion email:
 * `/agreements/<token>`. Each file streams through the API, which re-checks
 * its SHA-256 before sending a byte. No account, no session.
 */

const API = '/api/v1/public/agreements';

interface DownloadList {
  reference: string;
  agencyLegalName: string;
  completedAt: string;
  sealed: boolean;
  issuer?: PublicIssuer;
  documents: Array<{
    id: string;
    title: string;
    fileName: string;
    bytes: number | null;
    sha256: string;
  }>;
}

export default function AgreementDownloadPage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [list, setList] = useState<DownloadList | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** From the envelope, never the host. */
  const [issuer, setIssuer] = useState<PublicIssuer | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const response = await fetch(`${API}/download/${token}`, { referrerPolicy: 'no-referrer' });
        const body = (await response.json().catch(() => null)) as {
          data?: DownloadList;
          error?: { noticeEmail?: string; issuer?: PublicIssuer };
        } | null;
        if (response.ok && body?.data) {
          setList(body.data);
          setIssuer(body.data.issuer ?? NETENROLL_ISSUER);
        } else {
          setIssuer(body?.error?.issuer ?? NETENROLL_ISSUER);
          setExpired(body?.error?.noticeEmail ?? 'support@pvnvoice.com');
        }
      } catch {
        setError('The server is not answering right now. Try again in a moment.');
      }
    })();
  }, [token]);

  async function download(doc: DownloadList['documents'][number]): Promise<void> {
    setError(null);
    const response = await fetch(`${API}/download/${token}/${doc.id}.pdf`, {
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? 'That file could not be downloaded.');
      return;
    }
    saveBlob(await response.blob(), doc.fileName);
  }

  return (
    <IssuerBrandScope issuer={issuer}>
      <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-[720px] space-y-5">
          <header className="flex items-center justify-between">
            <IssuerLogo issuer={issuer} />
            <span className="text-[11px] uppercase tracking-[0.12em] text-ink-3">
              Executed agreements
            </span>
          </header>

          <section className="rounded-card border border-rule bg-surface p-5 sm:p-7">
            {!list && !expired && !error && (
              <div className="flex items-center justify-center py-8 text-ink-3">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading
              </div>
            )}

            {expired && (
              <>
                <h1 className="t-title text-ink">This link has expired</h1>
                <p className="t-body mt-2 text-ink-2">
                  This link has expired. Contact{' '}
                  <a className="text-brand-ink underline" href={`mailto:${expired}`}>
                    {expired}
                  </a>{' '}
                  for a new copy.
                </p>
              </>
            )}

            {list && (
              <>
                <h1 className="t-title text-ink">Agreements with {list.agencyLegalName}</h1>
                <p className="t-body mt-1 text-ink-2">
                  Fully executed on {etDate(list.completedAt)} · Reference {list.reference}
                </p>
                <ul className="mt-5 space-y-3">
                  {list.documents.map(doc => (
                    <li key={doc.id} className="rounded-control border border-rule p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <FileText className="h-4 w-4 text-brand-ink" />
                        <span className="flex-1 text-sm font-medium text-ink">{doc.title}</span>
                        <span className="text-xs text-ink-3">{fileSize(doc.bytes)}</span>
                        <Button size="sm" onClick={() => void download(doc)}>
                          <Download className="mr-1 h-3.5 w-3.5" />
                          Download
                        </Button>
                      </div>
                      <div className="mt-2 flex items-start gap-2">
                        <code className="flex-1 break-all font-mono text-[11px] text-ink-2">
                          SHA-256 {doc.sha256}
                        </code>
                        <button
                          type="button"
                          aria-label="Copy SHA-256"
                          className="text-ink-3 hover:text-ink"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(doc.sha256)
                              .then(() => setCopied(doc.id))
                          }
                        >
                          {copied === doc.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="t-meta mt-4 flex items-center gap-1.5 text-ink-3">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Each PDF ends with a Certificate of Completion.{' '}
                  <Link className="underline" href="/agreements/verify">
                    Verify a copy
                  </Link>
                </p>
              </>
            )}

            {error && <p className="mt-4 text-sm text-dropped-ink">{error}</p>}
          </section>
        </div>
      </main>
    </IssuerBrandScope>
  );
}
