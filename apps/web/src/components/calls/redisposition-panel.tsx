'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ApplicationLogForm } from '@/components/call-center/ApplicationLogForm';
import type { ApplicationLogPayload } from '@/components/call-center/ApplicationLogForm';
import { apiClient } from '@/lib/api';
import { DISPOSITION_LABELS } from '@/lib/call-dispositions';

/**
 * Writing a call up after the fact, from the call log.
 *
 * ── Why this screen needs it ─────────────────────────────────────────────────
 *
 * Most final-expense business does not close on the call that produced it. The
 * agent talks to somebody on Monday, the customer signs on Thursday, and the
 * agent comes back into the call log, finds that customer, and marks the call
 * as an application submitted THEN.
 *
 * Until this panel there was nowhere to do that. The ledger rendered the
 * disposition as text and nothing else, so business that closed on a follow-up
 * was never recorded -- and business that is never recorded understates the
 * agency's closing percentage, which on the rate curve is a HIGHER price per
 * application. The agency paid more for having sold on the second call.
 *
 * ── An application submitted is a sale, and needs what a sale needs ──────────
 *
 * Choosing that disposition opens the same five-field form the live path uses:
 * carrier, coverage amount, annual premium, first name, last name. The server
 * records the application against this call and writes the disposition only if
 * it lands, so the call can never read as a sale with nothing behind it.
 *
 * A call that ALREADY carries a submitted application does not ask again. That
 * is the genuine correction case -- an agent fixing a write-up they got wrong
 * -- and asking for the form again would spend a second credit for one piece
 * of business.
 */
export function RedispositionPanel({
  callId,
  currentDisposition,
  currentNotes,
  hasSubmittedApplication,
  onSaved,
}: {
  callId: string;
  currentDisposition: string | null;
  currentNotes: string | null;
  hasSubmittedApplication: boolean;
  onSaved: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState(currentDisposition ?? '');
  const [notes, setNotes] = useState(currentNotes ?? '');
  const [application, setApplication] = useState<ApplicationLogPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A sale being recorded here for the first time needs the form filled in. */
  const needsApplication = disposition === 'APPLICATION_SUBMITTED' && !hasSubmittedApplication;
  const canSave = !!disposition && (!needsApplication || !!application) && !saving;

  const save = useCallback(async () => {
    if (!disposition) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.patch(`/api/v1/calls/${callId}/disposition`, {
        disposition,
        notes,
        ...(needsApplication && application ? { application } : {}),
      });
      if (response.error) throw new Error(response.error.message || 'The call could not be saved.');
      setOpen(false);
      onSaved();
    } catch (err) {
      /*
       * Nothing is closed and nothing is cleared. Retry reuses the same
       * `clientRequestId` the form generated when it mounted, so a save that
       * landed before the network gave up comes back as the row it wrote
       * rather than as a second application.
       */
      setError(
        err instanceof Error
          ? `${err.message} Nothing has been recorded — try again.`
          : 'Nothing has been recorded — try again.'
      );
    } finally {
      setSaving(false);
    }
  }, [callId, disposition, notes, needsApplication, application, onSaved]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-control border border-rule px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-ink-2 hover:border-rule-strong hover:bg-sunken hover:text-ink"
      >
        {currentDisposition ? 'Change disposition' : 'Write this call up'}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded border border-rule bg-sunken p-3">
      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-ink-2"
          htmlFor="redisposition"
        >
          Disposition
        </label>
        <select
          id="redisposition"
          value={disposition}
          onChange={e => setDisposition(e.target.value)}
          disabled={saving}
          className="w-full rounded border border-rule bg-surface px-2 py-1.5 text-xs text-ink"
        >
          <option value="">Select…</option>
          {Object.entries(DISPOSITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {disposition === 'APPLICATION_SUBMITTED' && hasSubmittedApplication ? (
        <p className="text-[10px] text-ink-3">
          This call already has a submitted application on it. It is not asked for again, and no
          second credit is spent.
        </p>
      ) : null}

      {needsApplication ? (
        <ApplicationLogForm onChange={setApplication} error={null} disabled={saving} />
      ) : null}

      <div>
        <label
          className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-ink-2"
          htmlFor="redisposition-notes"
        >
          Notes
        </label>
        <textarea
          id="redisposition-notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          disabled={saving}
          className="w-full resize-none rounded border border-rule bg-surface px-2 py-1.5 text-xs text-ink"
        />
      </div>

      {error ? (
        <p className="text-[10px] font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-ink hover:bg-brand-ink hover:text-surface disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={saving}
          className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-widest text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
