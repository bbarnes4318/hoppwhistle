'use client';

import { FileCheck2, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { ApplicationLogForm } from '@/components/call-center/ApplicationLogForm';
import type { ApplicationLogPayload } from '@/components/call-center/ApplicationLogForm';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { markLeadApplication } from '@/lib/api/leads';

/**
 * "Mark as App Submitted", on a prospect's CRM record.
 *
 * The CRM's equal of dispositioning a call "Application Submitted": the same
 * form, and one application recorded. The server attaches it to the agent's
 * last call with this prospect and dispositions that call too, so the CRM,
 * Calls and the numbers at the top of the page all agree. The prospect then
 * moves from Prospects to Submitted Apps.
 */
export function MarkApplicationPanel({
  lead,
  onRecorded,
}: {
  lead: InsuranceLeadDetail;
  onRecorded: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [application, setApplication] = useState<ApplicationLogPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!application) return;
    setSaving(true);
    setError(null);
    try {
      await markLeadApplication(lead.id, { ...application });
      setOpen(false);
      onRecorded();
    } catch (err) {
      // Nothing is cleared: a retry reuses the form's idempotency key, so a
      // save that landed before the network gave up is not recorded twice.
      setError(err instanceof Error ? err.message : 'The application could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="border-b border-rule px-5 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-live-tint px-3 py-1.5 text-xs font-medium text-live-ink transition-colors hover:opacity-80"
        >
          <FileCheck2 className="h-3.5 w-3.5" />
          Mark as App Submitted
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-b border-rule bg-sunken px-5 py-4">
      <p className="text-xs font-medium text-ink">Application submitted</p>
      <ApplicationLogForm
        prefill={{
          firstName: lead.firstName,
          lastName: lead.lastName,
          phone: lead.phone,
          carrier: lead.carrier,
          faceAmount: lead.faceAmount || lead.coverageAmount,
        }}
        onChange={setApplication}
        error={error}
        disabled={saving}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!application || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-brand-ink hover:text-surface disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-3"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Application'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={saving}
          className="px-2 py-1.5 text-xs font-medium text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
