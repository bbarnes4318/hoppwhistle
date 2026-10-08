'use client';

import {
  ChevronDown,
  ChevronRight,
  Save,
  X,
  PhoneCall,
  Calculator,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';

import { CustomerActivityList } from './customer/customer-activity';
import { CustomerCallList } from './customer/customer-calls';
import { AddTaskForm, TaskList } from './customer/customer-tasks';
import { formatDateTime } from './customer/format';
import { LeadSectionFields } from './customer/lead-field-inputs';
import { sectionsFor, type LeadSectionId } from './customer/lead-fields';
import { useAssignableUsers, useLeadEditor, useLeadTasks } from './customer/use-lead-record';
import { MarkApplicationPanel } from './mark-application-panel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeadDetailBodyProps {
  lead: InsuranceLeadDetail;
  onRefresh: () => void;
}

interface LeadDetailSheetProps {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  lead: InsuranceLeadDetail | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-rule">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-widest text-ink-3 hover:bg-sunken transition-colors"
      >
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

/** The name a lead is shown by, in the sheet header and on the customer page. */
export function leadDisplayName(lead: InsuranceLeadDetail): string {
  if (lead.vertical === 'B2B') {
    return `${lead.company || ''}${lead.repName ? ` (${lead.repName})` : ''}` || 'Unnamed B2B Lead';
  }
  return lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unnamed Lead';
}

/** Open by default in the sheet: the fields an agent edits most. */
const OPEN_SECTIONS: ReadonlySet<LeadSectionId> = new Set([
  'contact',
  'crm',
  'address',
  'personal',
  'company',
  'finalExpense',
]);

/**
 * The customer record as the CRM grid's sheet shows it: every field open
 * for editing in place, one Save for all of them, then the applications,
 * calls, tasks, notes and timeline. The fields, their inputs and the writes
 * are the customer page's own (`./customer`), so a field is described once;
 * only the arrangement here is the sheet's.
 */
export function LeadDetailBody({ lead, onRefresh }: LeadDetailBodyProps) {
  const { canAssign, users } = useAssignableUsers();
  const editor = useLeadEditor(lead, onRefresh);
  const tasks = useLeadTasks(lead.id, onRefresh);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveMsg(null);
    if (await editor.save()) {
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } else {
      setSaveMsg('Failed to save');
    }
  };

  const fieldProps = {
    lead,
    edits: editor.edits,
    onEdit: editor.setField,
    assignees: canAssign ? users : null,
    disabled: editor.saving,
  };

  return (
    <>
      {/* Unsaved edits: one bar, above the sections. */}
      {(editor.dirty || saveMsg) && (
        <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-rule bg-surface px-5 py-2">
          {saveMsg && (
            <span
              className={`text-xs ${saveMsg === 'Saved' ? 'text-live-ink' : 'text-dropped-ink'}`}
            >
              {saveMsg}
            </span>
          )}
          {editor.dirty && (
            <Button size="sm" onClick={() => void handleSave()} disabled={editor.saving}>
              <Save className="h-3.5 w-3.5" />
              {editor.saving ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </div>
      )}

      <MarkApplicationPanel lead={lead} onRecorded={onRefresh} />

      {sectionsFor(lead.vertical).map(section => (
        <Section key={section.id} title={section.title} defaultOpen={OPEN_SECTIONS.has(section.id)}>
          <LeadSectionFields section={section} {...fieldProps} />
        </Section>
      ))}

      {/* Applications: the business written for this customer */}
      <Section title={`Applications (${lead.applications?.length ?? 0})`} defaultOpen={true}>
        {!lead.applications || lead.applications.length === 0 ? (
          <div className="text-xs italic text-ink-3">No applications for this customer yet</div>
        ) : (
          <ul className="divide-y divide-rule">
            {lead.applications.map(app => (
              <li
                key={app.id}
                className={`flex items-center justify-between gap-3 py-2 text-xs ${app.voidedAt ? 'line-through opacity-60' : ''}`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink">
                    {app.carrier}
                    {app.product ? ` · ${app.product}` : ''}
                  </div>
                  <div className="text-ink-3">
                    {app.submittedAt
                      ? new Date(app.submittedAt).toLocaleDateString()
                      : 'Not submitted'}
                    {app.carrierApplicationNumber ? ` · #${app.carrierApplicationNumber}` : ''}
                    {app.faceAmount ? ` · $${app.faceAmount.toLocaleString()} face` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 tabular-nums text-ink-2">
                  {app.annualizedPremium !== null && (
                    <span>{`$${app.annualizedPremium.toLocaleString(undefined, { maximumFractionDigits: 2 })}/yr`}</span>
                  )}
                  {app.callId && (
                    <Link
                      href={`/calls?call=${encodeURIComponent(app.callId)}`}
                      className="text-brand-ink hover:underline"
                      title="Open the call"
                    >
                      Call
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Calls with this customer's number */}
      <Section title={`Calls (${lead.calls?.length ?? 0})`} defaultOpen={true}>
        <CustomerCallList calls={lead.calls ?? []} />
      </Section>

      {/* Tasks & Follow-ups */}
      <Section title={`Tasks & Follow-ups (${lead.tasks?.length || 0})`}>
        <div className="space-y-3">
          <AddTaskForm tasks={tasks} compact />
          <TaskList list={lead.tasks ?? []} tasks={tasks} compact emptyText="No tasks yet." />
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <textarea
          value={editor.edits.notes !== undefined ? editor.edits.notes : lead.notes || ''}
          onChange={e => editor.setField('notes', e.target.value)}
          rows={3}
          placeholder="Add notes…"
          aria-label="Notes"
          className="w-full rounded-md border border-rule bg-surface text-sm text-ink
          placeholder:text-ink-3 px-3 py-2 outline-none focus:border-brand-ink
          focus:ring-1 focus:ring-brand-tint transition-colors resize-none"
        />
      </Section>

      {/* Activity Timeline */}
      <Section title={`Activity Timeline (${lead.activities?.length || 0})`} defaultOpen={true}>
        <CustomerActivityList activities={lead.activities ?? []} />
      </Section>

      {/* Captured Script Data */}
      {lead.customFields && Object.keys(lead.customFields).length > 0 && (
        <Section title="Captured Script Data">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            {Object.entries(lead.customFields).map(([key, val]) => (
              <div key={key} className="space-y-0.5 border-b border-rule pb-1">
                <span className="text-[9px] font-mono uppercase tracking-wider text-ink-3 block">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                </span>
                <span className="font-mono text-ink-2 block truncate" title={String(val)}>
                  {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val ?? '—')}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Metadata */}
      <Section title="Metadata">
        <div className="space-y-2 text-xs text-ink-3">
          <div className="flex justify-between">
            <span>Lead ID</span>
            <span className="font-mono text-ink-2">{lead.id}</span>
          </div>
          <div className="flex justify-between">
            <span>Vertical</span>
            <span>{lead.vertical}</span>
          </div>
          <div className="flex justify-between">
            <span>Created</span>
            <span>{formatDateTime(lead.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Updated</span>
            <span>{formatDateTime(lead.updatedAt)}</span>
          </div>
        </div>
      </Section>
    </>
  );
}

export function LeadDetailSheet({ lead, loading, onClose, onRefresh }: LeadDetailSheetProps) {
  const router = useRouter();
  const { makeCall } = usePhone();
  const customerHref = lead ? `/insurance-leads/${encodeURIComponent(lead.id)}` : null;
  // The quoter needs a full screen: Quote opens the customer's own quote
  // workspace, bound to them, rather than squeezing it into this sheet.
  const canQuote = lead?.vertical === 'FE';
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 " onClick={onClose} />

      {/* Sheet */}
      <div className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-2xl flex-col border-l border-rule bg-surface shadow-sm animate-in slide-in-from-right duration-250">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rule px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-sm font-semibold text-ink">
              {lead ? leadDisplayName(lead) : '…'}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {lead?.phone && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={lead.doNotCall}
                title={lead.doNotCall ? 'This customer is on Do Not Call' : undefined}
                onClick={() => void makeCall(lead.phone)}
              >
                <PhoneCall aria-hidden className="h-3.5 w-3.5" />
                Call
              </Button>
            )}
            {lead && canQuote && customerHref && (
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => router.push(`${customerHref}/quote`)}
              >
                <Calculator aria-hidden className="h-3.5 w-3.5" />
                Quote
              </Button>
            )}
            {customerHref && (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5" asChild>
                <Link href={customerHref}>
                  <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  Open customer
                </Link>
              </Button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-ink transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading || !lead ? (
            <div className="flex items-center justify-center h-full text-sm text-ink-3">
              Loading lead details…
            </div>
          ) : (
            <LeadDetailBody lead={lead} onRefresh={onRefresh} />
          )}
        </div>
      </div>
    </>
  );
}
