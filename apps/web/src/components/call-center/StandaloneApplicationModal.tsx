'use client';

import { useCallback, useState } from 'react';

import { apiClient } from '@/lib/api';

import { ApplicationLogForm } from './ApplicationLogForm';
import type { ApplicationLogPayload } from './ApplicationLogForm';

/**
 * Logging business written outside a softphone session.
 *
 * An agent who takes a callback on their own phone, or writes an application
 * the morning after the call that produced it, has no call to attach and no
 * disposition to file. Without a way in, that business is written and never
 * counted -- which understates the agency's closing percentage and raises its
 * price, the exact failure the agent-entry path exists to remove.
 *
 * So this posts the application alone, with no `callId`. The server allows that
 * deliberately: attribution is by submission timestamp, not by the call.
 */
export function StandaloneApplicationModal({
  onClose,
  onLogged,
}: {
  onClose: () => void;
  onLogged: () => void;
}) {
  const [payload, setPayload] = useState<ApplicationLogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!payload) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post('/api/v1/applications', payload);
      if (response.error) {
        throw new Error(response.error.message || 'The application could not be saved.');
      }
      setSaved(true);
      setTimeout(onLogged, 1200);
    } catch (err) {
      /*
       * Nothing is cleared and the modal stays open. Retry reuses the same
       * `clientRequestId` the form generated when it mounted, so a submit that
       * landed before the network gave up comes back as the row it wrote rather
       * than as a second application.
       */
      setError(
        err instanceof Error
          ? `${err.message} The application has not been recorded — try again.`
          : 'The application has not been recorded — try again.'
      );
    } finally {
      setSaving(false);
    }
  }, [payload, onLogged]);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-card border border-rule bg-surface">
        {saved ? (
          <div className="flex flex-col items-center justify-center p-12">
            <div className="mb-4 h-2 w-2 bg-live" />
            <h3 className="mb-1 text-sm font-mono uppercase tracking-widest text-brand-ink">
              Application logged
            </h3>
            <p className="text-xs font-mono uppercase tracking-widest text-ink-2">
              Counted for today
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-rule px-5 py-4">
              <h2 className="text-sm font-mono uppercase tracking-widest text-ink">
                Log an application
              </h2>
              <p className="mt-1 text-xs text-ink-2">
                Business written outside a call. No call is attached.
              </p>
            </div>

            <div className="p-5">
              <ApplicationLogForm onChange={setPayload} error={error} disabled={saving} />
            </div>

            <div className="space-y-2 border-t border-rule px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={!payload || saving}
                className="w-full rounded bg-brand py-3 font-mono text-xs uppercase tracking-widest text-ink transition-colors hover:bg-brand-ink hover:text-surface disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3"
              >
                {saving ? 'Saving…' : error ? 'Retry save' : 'Log application'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="w-full py-2 font-mono text-xs uppercase tracking-widest text-ink-2 transition-colors hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
