'use client';

import { AlertCircle, Check, CheckCircle2, Download, FileText, Loader2, Mail } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PartyDetailsForm } from '@/components/agreements/party-details-form';
import { SignatureScript } from '@/components/agreements/signature-script';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { etDate, fileSize, saveBlob, type PartyDetails } from '@/lib/agreements';
import { cn } from '@/lib/utils';

/**
 * Reviewing and signing agreements from an emailed link: `/sign/<token>`.
 *
 * The signer has no account. The link names one envelope, and nothing beyond a
 * summary is shown until a one-time code emailed to the address the link was
 * sent to has been entered. Every later step carries the signing session the
 * code earns (`X-Signing-Session`); an expired session returns here to code
 * entry. After consenting, the signer enters the agency's own details (as a
 * business or as an individual licensed agent); the documents are then shown
 * completed with them, in sandboxed frames with no scripts, and each is marked
 * reviewed only once it has been scrolled to the end.
 */

const API = '/api/v1/public/agreements';

type Step = 'loading' | 'summary' | 'code' | 'review' | 'sign' | 'done' | 'inactive' | 'invalid';

interface Summary {
  status: string;
  agencyLegalName: string;
  documents: Array<{ title: string }>;
  signerEmailMasked: string;
  expiresAt: string;
}

interface DocumentsPayload {
  partyRequired: boolean;
  partyPrefill: PartyDetails | null;
  inviteeOrganization: string | null;
  individual: boolean;
  documents: Array<{
    id: string;
    kind: string;
    title: string;
    html: string;
    acceptanceStatement: string;
    reviewed: boolean;
  }>;
  disclosure: { version: string; html: string; text: string; checkboxLabel: string };
  consented: boolean;
  signer: { name: string; title: string; email: string };
  agencyLegalName: string;
  intentStatement: string | null;
  noticeEmail: string;
}

interface DownloadList {
  documents: Array<{
    id: string;
    title: string;
    fileName: string;
    bytes: number | null;
    sha256: string;
  }>;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; session?: string | null } = {}
): Promise<{
  status: number;
  data?: T;
  error?: { code?: string; message?: string; status?: string; noticeEmail?: string };
}> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.session) headers['X-Signing-Session'] = init.session;
  try {
    const response = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      referrerPolicy: 'no-referrer',
    });
    const json = (await response.json().catch(() => null)) as { data?: T; error?: never } | null;
    return { status: response.status, data: json?.data, error: json?.error };
  } catch {
    return {
      status: 0,
      error: { message: 'The server is not answering right now. Try again in a moment.' },
    };
  }
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('rounded-card border border-rule bg-surface p-5 sm:p-7', className)}>
      {children}
    </section>
  );
}

function Alert({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-control border border-dropped bg-dropped-tint px-3 py-2.5 text-dropped-ink"
    >
      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="t-body min-w-0">{children}</p>
    </div>
  );
}

export default function SignPage(): JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const sessionKey = `agreement-session:${token.slice(0, 16)}`;

  const [step, setStep] = useState<Step>('loading');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [inactive, setInactive] = useState<{ message: string; noticeEmail?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [resendIn, setResendIn] = useState(0);
  const [session, setSession] = useState<string | null>(null);

  const [docs, setDocs] = useState<DocumentsPayload | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consented, setConsented] = useState(false);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [activeDoc, setActiveDoc] = useState(0);

  const [typedName, setTypedName] = useState('');
  const [title, setTitle] = useState('');
  const [initials, setInitials] = useState('');
  const [method, setMethod] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [drawn, setDrawn] = useState(false);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [intent, setIntent] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [done, setDone] = useState<{
    message: string;
    email: string;
    downloadToken: string | null;
  } | null>(null);
  const [downloads, setDownloads] = useState<DownloadList | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesNote, setChangesNote] = useState('');

  /** Answer a non-2xx the way every step must: inactive link, lost session or a message. */
  const handleFailure = useCallback(
    (result: { status: number; error?: { message?: string; noticeEmail?: string } }): void => {
      if (result.status === 410) {
        setInactive({
          message: result.error?.message ?? 'This link no longer works.',
          noticeEmail: result.error?.noticeEmail,
        });
        setStep('inactive');
        return;
      }
      if (result.status === 404) {
        setStep('invalid');
        return;
      }
      if (result.status === 401) {
        try {
          sessionStorage.removeItem(sessionKey);
        } catch {
          // Storage may be unavailable; the in-memory session is cleared either way.
        }
        setSession(null);
        setError(
          result.error?.message ?? 'Your verification has expired. Verify your email again.'
        );
        setStep('code');
        return;
      }
      setError(result.error?.message ?? 'Something went wrong. Try again.');
    },
    [sessionKey]
  );

  const loadDocuments = useCallback(
    async (sessionToken: string) => {
      const result = await call<DocumentsPayload>(`/sign/${token}/documents`, {
        session: sessionToken,
      });
      if (!result.data) {
        handleFailure(result);
        return;
      }
      if ('status' in (result.data as object) && !('documents' in (result.data as object))) {
        setStep('done');
        return;
      }
      setDocs(result.data);
      setConsented(result.data.consented);
      setConsentChecked(result.data.consented);
      setReviewed(new Set(result.data.documents.filter(d => d.reviewed).map(d => d.id)));
      setTitle(result.data.signer.title);
      setTypedName('');
      setStep('review');
    },
    [token, handleFailure]
  );

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const result = await call<Summary>(`/sign/${token}`);
      if (!result.data) {
        handleFailure(result);
        return;
      }
      if (result.data.status === 'COMPLETED' || result.data.status === 'SIGNED') {
        setDone({
          message:
            result.data.status === 'COMPLETED'
              ? 'These agreements are signed. Your executed copies were emailed to you.'
              : 'Your signature is recorded. Your executed copies will be emailed to you shortly.',
          email: '',
          downloadToken: null,
        });
        setStep('done');
        return;
      }
      setSummary(result.data);
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(sessionKey);
      } catch {
        saved = null;
      }
      if (saved) {
        setSession(saved);
        await loadDocuments(saved);
        return;
      }
      setStep('summary');
    })();
  }, [token, sessionKey, handleFailure, loadDocuments]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function sendCode(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await call<{ sent: boolean }>(`/sign/${token}/otp`, {
      method: 'POST',
      body: {},
    });
    setBusy(false);
    if (!result.data) {
      handleFailure(result);
      return;
    }
    setCode(['', '', '', '', '', '']);
    setResendIn(60);
    setStep('code');
  }

  async function verifyCode(): Promise<void> {
    const value = code.join('');
    if (!/^\d{6}$/.test(value)) {
      setError('Enter all six digits.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await call<{ sessionToken: string }>(`/sign/${token}/verify`, {
      method: 'POST',
      body: { code: value },
    });
    setBusy(false);
    if (!result.data?.sessionToken) {
      handleFailure(result);
      return;
    }
    try {
      sessionStorage.setItem(sessionKey, result.data.sessionToken);
    } catch {
      // Not persisted across a reload; the signer verifies again.
    }
    setSession(result.data.sessionToken);
    await loadDocuments(result.data.sessionToken);
  }

  async function giveConsent(): Promise<void> {
    if (!docs) return;
    setBusy(true);
    setError(null);
    const result = await call(`/sign/${token}/consent`, {
      method: 'POST',
      body: { accepted: true, disclosureVersion: docs.disclosure.version },
      session,
    });
    setBusy(false);
    if (result.status !== 200) {
      handleFailure(result);
      return;
    }
    setConsented(true);
  }

  async function submitDetails(party: PartyDetails): Promise<void> {
    if (!session) return;
    setBusy(true);
    setError(null);
    const result = await call(`/sign/${token}/details`, {
      method: 'POST',
      body: party,
      session,
    });
    if (result.status !== 200 && result.error?.code !== 'DETAILS_ALREADY_ENTERED') {
      setBusy(false);
      handleFailure(result);
      return;
    }
    await loadDocuments(session);
    setBusy(false);
    setActiveDoc(0);
  }

  const markReviewed = useCallback(
    async (documentId: string) => {
      if (reviewed.has(documentId)) return;
      setReviewed(prev => new Set(prev).add(documentId));
      const result = await call(`/sign/${token}/reviewed`, {
        method: 'POST',
        body: { documentId },
        session,
      });
      if (result.status !== 200) {
        setReviewed(prev => {
          const next = new Set(prev);
          next.delete(documentId);
          return next;
        });
        handleFailure(result);
      }
    },
    [reviewed, token, session, handleFailure]
  );

  /** Watch a document frame; mark it reviewed once scrolled to the end. */
  function attachScrollWatch(frame: HTMLIFrameElement | null, documentId: string): void {
    if (!frame) return;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    const check = () => {
      const scroller = doc.scrollingElement ?? doc.documentElement;
      if (scroller.scrollTop + win.innerHeight >= scroller.scrollHeight - 24) {
        void markReviewed(documentId);
      }
    };
    win.addEventListener('scroll', check, { passive: true });
    check();
  }

  // Drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || method !== 'DRAWN') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f2a4a';
    let drawing = false;
    const point = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    const down = (e: PointerEvent) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const p = point(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setDrawn(true);
    };
    const up = () => {
      drawing = false;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', up);
    };
  }, [method, step]);

  function clearCanvas(): void {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setDrawn(false);
  }

  async function sign(): Promise<void> {
    if (!docs) return;
    setBusy(true);
    setError(null);
    const result = await call<{
      status: string;
      message?: string;
      email?: string;
      downloadToken?: string | null;
    }>(`/sign/${token}/sign`, {
      method: 'POST',
      session,
      body: {
        typedName,
        title: docs.individual ? 'Individually' : title,
        initials,
        method,
        drawnPng: method === 'DRAWN' ? canvasRef.current?.toDataURL('image/png') : undefined,
        acceptances: accepted,
        intentAccepted: intent,
      },
    });
    setBusy(false);
    if (!result.data) {
      handleFailure(result);
      return;
    }
    try {
      sessionStorage.removeItem(sessionKey);
    } catch {
      // Nothing to clean up.
    }
    setDone({
      message:
        result.data.status === 'COMPLETED'
          ? `Your agreements are signed. Executed copies have been emailed to ${docs.signer.email}.`
          : (result.data.message ??
            'Your signature is recorded. Your executed copies will be emailed to you shortly.'),
      email: docs.signer.email,
      downloadToken: result.data.downloadToken ?? null,
    });
    setStep('done');
  }

  // Once completed, list the executed copies for download.
  useEffect(() => {
    if (step !== 'done' || !done?.downloadToken) return;
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      const result = await call<DownloadList>(`/download/${done.downloadToken}`);
      if (cancelled) return;
      if (result.data) setDownloads(result.data);
      else if (attempts++ < 10) setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [step, done]);

  async function requestChanges(): Promise<void> {
    setBusy(true);
    const result = await call<{ noticeEmail: string }>(`/sign/${token}/request-changes`, {
      method: 'POST',
      body: { note: changesNote },
      session,
    });
    setBusy(false);
    if (!result.data) {
      setChangesOpen(false);
      handleFailure(result);
      return;
    }
    setChangesOpen(false);
    setInactive({
      message:
        'Your request has been sent to NetEnroll. This link no longer works; NetEnroll will send revised agreements.',
      noticeEmail: result.data.noticeEmail,
    });
    setStep('inactive');
  }

  const allReviewed = docs ? docs.documents.every(d => reviewed.has(d.id)) : false;
  const nameMatches =
    docs !== null &&
    typedName.trim().replace(/\s+/g, ' ').toLowerCase() ===
      docs.signer.name.trim().replace(/\s+/g, ' ').toLowerCase();
  const canSign =
    docs !== null &&
    nameMatches &&
    (docs.individual || title.trim().length > 0) &&
    /^[A-Za-z]{1,4}$/.test(initials) &&
    (method === 'TYPED' || drawn) &&
    docs.documents.every(d => accepted[d.id]) &&
    intent;

  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[880px] space-y-5">
        <header className="flex items-center justify-between">
          <Logo width={180} />
          <span className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Secure signing</span>
        </header>

        {step === 'loading' && (
          <Card className="flex items-center justify-center py-12 text-ink-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading
          </Card>
        )}

        {step === 'invalid' && (
          <Card>
            <h1 className="t-title text-ink">This link is not valid</h1>
            <p className="t-body mt-2 text-ink-2">
              Check that you opened the full link from your email. If it still does not work,
              contact NetEnroll at support@pvnvoice.com.
            </p>
          </Card>
        )}

        {step === 'inactive' && inactive && (
          <Card>
            <h1 className="t-title text-ink">This link no longer works</h1>
            <p className="t-body mt-2 text-ink-2">{inactive.message}</p>
            {inactive.noticeEmail && (
              <p className="t-body mt-2 text-ink-2">
                Questions? Contact{' '}
                <a className="text-brand-ink underline" href={`mailto:${inactive.noticeEmail}`}>
                  {inactive.noticeEmail}
                </a>
                .
              </p>
            )}
          </Card>
        )}

        {step === 'summary' && summary && (
          <Card>
            <h1 className="t-title text-ink">Agreements for {summary.agencyLegalName}</h1>
            <p className="t-body mt-2 text-ink-2">
              PVN LLC d/b/a NetEnroll has sent the following for your review and electronic
              signature. NetEnroll&rsquo;s authorized signatory has already signed.
            </p>
            <ul className="mt-4 space-y-2">
              {summary.documents.map(doc => (
                <li key={doc.title} className="flex items-center gap-2 text-sm text-ink">
                  <FileText className="h-4 w-4 text-brand-ink" />
                  {doc.title}
                </li>
              ))}
            </ul>
            <p className="t-body mt-4 text-ink-2">
              To protect these agreements we will email a one-time code to{' '}
              <strong>{summary.signerEmailMasked}</strong>.
            </p>
            <p className="t-meta mt-1 text-ink-3">
              This link expires on {etDate(summary.expiresAt)}.
            </p>
            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}
            <Button
              className="mt-5 w-full sm:w-auto"
              disabled={busy}
              onClick={() => void sendCode()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-1.5 h-4 w-4" />
              )}
              Send verification code
            </Button>
          </Card>
        )}

        {step === 'code' && (
          <Card>
            <h1 className="t-title text-ink">Enter your verification code</h1>
            <p className="t-body mt-2 text-ink-2">
              We emailed a 6-digit code to {summary?.signerEmailMasked ?? 'your email'}. It is valid
              for 10 minutes.
            </p>
            <form
              className="mt-5"
              onSubmit={e => {
                e.preventDefault();
                void verifyCode();
              }}
            >
              <div
                className="flex gap-2"
                onPaste={e => {
                  const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                  if (digits.length === 6) {
                    e.preventDefault();
                    setCode(digits.split(''));
                  }
                }}
              >
                {code.map((digit, i) => (
                  <Input
                    key={i}
                    id={`code-${i}`}
                    aria-label={`Digit ${i + 1}`}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={digit}
                    className="h-12 w-11 text-center font-mono text-lg"
                    onChange={e => {
                      const value = e.target.value.replace(/\D/g, '').slice(-1);
                      const next = [...code];
                      next[i] = value;
                      setCode(next);
                      if (value && i < 5) document.getElementById(`code-${i + 1}`)?.focus();
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Backspace' && !code[i] && i > 0)
                        document.getElementById(`code-${i - 1}`)?.focus();
                    }}
                  />
                ))}
              </div>
              {error && (
                <div className="mt-4">
                  <Alert>{error}</Alert>
                </div>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || resendIn > 0}
                  onClick={() => void sendCode()}
                >
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {step === 'review' && docs && (
          <>
            <Card>
              <h1 className="t-title text-ink">Consent to Electronic Records and Signatures</h1>
              <div
                className="prose-sm mt-3 max-h-72 space-y-2 overflow-y-auto rounded-control border border-rule bg-sunken p-4 text-sm text-ink-2 [&_h2]:hidden"
                // The disclosure is the server's own constant, escaped there.
                dangerouslySetInnerHTML={{ __html: docs.disclosure.html }}
              />
              <label className="mt-4 flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consentChecked}
                  disabled={consented}
                  onChange={e => setConsentChecked(e.target.checked)}
                />
                {docs.disclosure.checkboxLabel}
              </label>
              {!consented && (
                <Button
                  className="mt-3"
                  disabled={!consentChecked || busy}
                  onClick={() => void giveConsent()}
                >
                  Continue
                </Button>
              )}
              {consented && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-live-ink">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Consent recorded
                </p>
              )}
            </Card>

            {consented && docs.partyRequired && (
              <Card>
                <PartyDetailsForm
                  prefill={docs.partyPrefill}
                  signerName={docs.signer.name}
                  signerEmail={docs.signer.email}
                  organization={docs.inviteeOrganization}
                  busy={busy}
                  onSubmit={party => void submitDetails(party)}
                />
                <button
                  type="button"
                  className="mt-4 text-xs text-ink-2 underline"
                  onClick={() => setChangesOpen(true)}
                >
                  Request changes instead
                </button>
              </Card>
            )}

            {consented && !docs.partyRequired && (
              <Card className="p-3 sm:p-4">
                <p className="t-body px-1 text-ink-2">
                  Read each agreement to the end. Each turns green once you have scrolled through
                  it.
                </p>
                <div className="mt-3 flex flex-wrap gap-2" role="tablist">
                  {docs.documents.map((doc, i) => (
                    <button
                      key={doc.id}
                      type="button"
                      role="tab"
                      aria-selected={activeDoc === i}
                      onClick={() => setActiveDoc(i)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
                        reviewed.has(doc.id)
                          ? 'border-live bg-live-tint text-live-ink'
                          : 'border-rule-strong bg-surface text-ink-2',
                        activeDoc === i && 'ring-2 ring-brand-ink ring-offset-1'
                      )}
                    >
                      {reviewed.has(doc.id) ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {doc.title}
                    </button>
                  ))}
                </div>
                {docs.documents[activeDoc] && (
                  <iframe
                    key={docs.documents[activeDoc].id}
                    title={docs.documents[activeDoc].title}
                    srcDoc={docs.documents[activeDoc].html}
                    sandbox="allow-same-origin"
                    onLoad={e => attachScrollWatch(e.currentTarget, docs.documents[activeDoc].id)}
                    className="mt-3 h-[70vh] w-full rounded-control border border-rule bg-white"
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3 px-1">
                  {activeDoc < docs.documents.length - 1 && (
                    <Button variant="outline" onClick={() => setActiveDoc(activeDoc + 1)}>
                      Next document
                    </Button>
                  )}
                  <Button disabled={!allReviewed} onClick={() => setStep('sign')}>
                    Continue to sign
                  </Button>
                  {!allReviewed && (
                    <span className="text-xs text-ink-3">Review every document to continue.</span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-xs text-ink-2 underline"
                    onClick={() => setChangesOpen(true)}
                  >
                    Request changes
                  </button>
                </div>
              </Card>
            )}
            {error && <Alert>{error}</Alert>}
          </>
        )}

        {step === 'sign' && docs && (
          <Card>
            <h1 className="t-title text-ink">Sign</h1>
            <p className="t-body mt-1 text-ink-2">
              {docs.individual ? (
                <>
                  You are signing as <strong>{docs.signer.name}</strong>, on your own behalf.
                </>
              ) : (
                <>
                  You are signing as <strong>{docs.signer.name}</strong> for {docs.agencyLegalName}.
                </>
              )}
            </p>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="t-meta mb-1 block font-medium text-ink-2" htmlFor="typed-name">
                  Full name
                </label>
                <Input
                  id="typed-name"
                  value={typedName}
                  autoComplete="name"
                  onChange={e => setTypedName(e.target.value)}
                />
                {typedName && !nameMatches && (
                  <p className="mt-1 text-[11px] text-dropped-ink">
                    Type your name exactly as above: {docs.signer.name}.
                  </p>
                )}
              </div>
              {docs.individual ? (
                <div>
                  <span className="t-meta mb-1 block font-medium text-ink-2">Signing as</span>
                  <p className="pt-2 text-sm text-ink">An individual, on your own behalf</p>
                </div>
              ) : (
                <div>
                  <label
                    className="t-meta mb-1 block font-medium text-ink-2"
                    htmlFor="signer-title"
                  >
                    Title
                  </label>
                  <Input id="signer-title" value={title} onChange={e => setTitle(e.target.value)} />
                </div>
              )}
              <div>
                <label className="t-meta mb-1 block font-medium text-ink-2" htmlFor="initials">
                  Initials
                </label>
                <Input
                  id="initials"
                  value={initials}
                  maxLength={4}
                  className="w-24 uppercase"
                  onChange={e =>
                    setInitials(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())
                  }
                />
                <p className="mt-1 text-[11px] text-ink-3">
                  Printed on every page of the executed agreements.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="inline-flex rounded-control bg-sunken p-1" role="tablist">
                {(['TYPED', 'DRAWN'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={method === m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      'rounded-control px-3 py-1.5 text-xs font-medium text-ink-2',
                      method === m && 'bg-surface text-ink shadow-card'
                    )}
                  >
                    {m === 'TYPED' ? 'Type' : 'Draw'}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-control border border-rule bg-white p-3">
                {method === 'TYPED' ? (
                  <div className="flex h-[96px] items-end border-b border-ink px-2 pb-2">
                    <SignatureScript name={typedName} className="text-[36px]" />
                  </div>
                ) : (
                  <div>
                    <canvas
                      ref={canvasRef}
                      width={1000}
                      height={300}
                      className="h-[150px] w-full touch-none border-b border-ink"
                      aria-label="Draw your signature"
                    />
                    <button
                      type="button"
                      className="mt-1 text-xs text-ink-2 underline"
                      onClick={clearCanvas}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-3">
                  Authorized signature
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {docs.documents.map(doc => (
                <label key={doc.id} className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={accepted[doc.id] ?? false}
                    onChange={e => setAccepted({ ...accepted, [doc.id]: e.target.checked })}
                  />
                  {doc.acceptanceStatement}
                </label>
              ))}
            </div>

            <label className="mt-5 flex items-start gap-2 rounded-control border border-rule bg-sunken p-3 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={intent}
                onChange={e => setIntent(e.target.checked)}
              />
              <span>{docs.intentStatement}</span>
            </label>

            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button size="lg" disabled={!canSign || busy} onClick={() => void sign()}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Sign Agreements
              </Button>
              <Button variant="ghost" onClick={() => setStep('review')}>
                Back to the documents
              </Button>
              <button
                type="button"
                className="ml-auto text-xs text-ink-2 underline"
                onClick={() => setChangesOpen(true)}
              >
                Request changes
              </button>
            </div>
          </Card>
        )}

        {step === 'done' && done && (
          <Card>
            <div className="flex items-center gap-2 text-live-ink">
              <CheckCircle2 className="h-6 w-6" />
              <h1 className="t-title">Signed</h1>
            </div>
            <p className="t-body mt-3 text-ink">{done.message}</p>
            {downloads && downloads.documents.length > 0 && (
              <ul className="mt-5 space-y-2">
                {downloads.documents.map(doc => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center gap-3 rounded-control border border-rule p-3"
                  >
                    <FileText className="h-4 w-4 text-brand-ink" />
                    <span className="flex-1 text-sm">{doc.title}</span>
                    <span className="text-xs text-ink-3">{fileSize(doc.bytes)}</span>
                    <Button
                      size="sm"
                      onClick={() =>
                        void (async () => {
                          const response = await fetch(
                            `${API}/download/${done.downloadToken}/${doc.id}.pdf`,
                            {
                              referrerPolicy: 'no-referrer',
                            }
                          );
                          if (response.ok) saveBlob(await response.blob(), doc.fileName);
                          else
                            setError(
                              'That file could not be downloaded. Use the copy in your email.'
                            );
                        })()
                      }
                    >
                      <Download className="mr-1 h-3.5 w-3.5" />
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}
          </Card>
        )}

        <footer className="pb-6 text-center text-[11px] text-ink-3">
          PVN LLC d/b/a NetEnroll · Saint Augustine, Florida · Electronic signatures under the ESIGN
          Act and Fla. Stat. §668.50
        </footer>
      </div>

      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Tell NetEnroll what needs to change. This link will stop working, and NetEnroll will
              send revised agreements.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={5}
            maxLength={2000}
            value={changesNote}
            onChange={e => setChangesNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangesOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!changesNote.trim() || busy} onClick={() => void requestChanges()}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
