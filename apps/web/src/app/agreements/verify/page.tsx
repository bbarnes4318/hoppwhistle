'use client';

import { CheckCircle2, FileUp, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Logo } from '@/components/brand/logo';
import { etDate } from '@/lib/agreements';
import { cn } from '@/lib/utils';

/**
 * Check a PDF against NetEnroll's executed agreements: `/agreements/verify`.
 *
 * The file never leaves the browser. Its SHA-256 is computed here with
 * `crypto.subtle` and only the hash is sent; the API answers whether an
 * executed agreement has exactly that hash.
 */

interface Match {
  match: boolean;
  reference?: string;
  documentTitle?: string;
  agencyLegalName?: string;
  completedAt?: string;
  sealed?: boolean;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function VerifyAgreementPage(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Match | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function check(selected: File): Promise<void> {
    setFile(selected);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const digest = await sha256Hex(selected);
      setHash(digest);
      const response = await fetch(`/api/v1/public/agreements/verify?sha256=${digest}`, {
        referrerPolicy: 'no-referrer',
      });
      const body = (await response.json().catch(() => null)) as {
        data?: Match;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data)
        setError(body?.error?.message ?? 'The file could not be checked. Try again.');
      else setResult(body.data);
    } catch {
      setError('The file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[640px] space-y-5">
        <header className="flex items-center justify-between">
          <Logo width={180} />
          <span className="text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Verify an agreement
          </span>
        </header>

        <section className="rounded-card border border-rule bg-surface p-5 sm:p-7">
          <h1 className="t-title text-ink">Verify an executed agreement</h1>
          <p className="t-body mt-2 text-ink-2">
            Choose a PDF to check it against NetEnroll&rsquo;s records. The file stays on your
            device: only its SHA-256 fingerprint is sent.
          </p>

          <label
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) void check(dropped);
            }}
            className={cn(
              'mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed px-4 py-10 text-center',
              dragging ? 'border-brand-strong bg-brand-tint' : 'border-rule-strong bg-sunken'
            )}
          >
            <FileUp className="h-6 w-6 text-ink-3" />
            <span className="text-sm text-ink">
              {file ? file.name : 'Drop a PDF here, or choose one'}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={e => {
                const chosen = e.target.files?.[0];
                if (chosen) void check(chosen);
              }}
            />
          </label>

          {busy && (
            <p className="mt-4 flex items-center text-sm text-ink-3">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking
            </p>
          )}

          {hash && !busy && (
            <p className="mt-4 break-all font-mono text-[11px] text-ink-3">SHA-256 {hash}</p>
          )}

          {result?.match && (
            <div className="mt-4 rounded-control border border-live bg-live-tint p-4 text-live-ink">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-5 w-5" />
                This is an executed NetEnroll agreement.
              </p>
              <dl className="mt-3 grid grid-cols-[130px_1fr] gap-y-1 text-sm text-ink">
                <dt className="text-ink-2">Document</dt>
                <dd>{result.documentTitle}</dd>
                <dt className="text-ink-2">Agency</dt>
                <dd>{result.agencyLegalName}</dd>
                <dt className="text-ink-2">Reference</dt>
                <dd>{result.reference}</dd>
                <dt className="text-ink-2">Completed</dt>
                <dd>{etDate(result.completedAt)}</dd>
                <dt className="text-ink-2">Seal</dt>
                <dd>
                  {result.sealed ? 'Digitally sealed by PVN LLC d/b/a NetEnroll' : 'Not sealed'}
                </dd>
              </dl>
            </div>
          )}

          {result && !result.match && (
            <div className="mt-4 flex items-start gap-2 rounded-control border border-dropped bg-dropped-tint p-4 text-dropped-ink">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm">
                No executed NetEnroll agreement matches this file. A file that has been altered in
                any way will not match.
              </p>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-dropped-ink">{error}</p>}
        </section>
      </div>
    </main>
  );
}
