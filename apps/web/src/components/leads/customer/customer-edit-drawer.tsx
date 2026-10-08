'use client';

/**
 * Edit the customer record: every field, grouped as Details reads it, in a
 * drawer over the workspace. The page stays a page to read; editing is
 * something the agent chooses to do, with one Save for the lot.
 *
 * Closing with unsaved changes asks first, in the drawer's own footer, so a
 * stray Escape never throws away a typed address.
 */

import { Loader2, Save } from 'lucide-react';
import * as React from 'react';

import { Notice, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { customerName } from '@/lib/fex/customer';

import { LeadSectionFields } from './lead-field-inputs';
import { sectionsFor, type LeadSectionId } from './lead-fields';
import { useAssignableUsers, useLeadEditor } from './use-lead-record';

export interface CustomerEditDrawerProps {
  lead: InsuranceLeadDetail;
  open: boolean;
  /** The section to bring into view when it opens. */
  focus?: LeadSectionId | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function CustomerEditDrawer({
  lead,
  open,
  focus,
  onOpenChange,
  onSaved,
}: CustomerEditDrawerProps): JSX.Element {
  const editor = useLeadEditor(lead, onSaved);
  const { canAssign, users } = useAssignableUsers();
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const name = lead.vertical === 'B2B' ? lead.company || customerName(lead) : customerName(lead);
  const changedCount = Object.keys(editor.changed).length;
  const { reset } = editor;

  // Each opening starts from the record as it is now.
  React.useEffect(() => {
    if (open) {
      reset();
      setConfirmDiscard(false);
    }
  }, [open, reset]);

  React.useEffect(() => {
    if (!open || !focus) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(`edit-section-${focus}`);
      el?.scrollIntoView({ block: 'start' });
      el?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (editor.saving) return;
    if (editor.dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const save = async () => {
    if (await editor.save()) {
      toast({ title: `${name} updated` });
      onOpenChange(false);
    }
  };

  return (
    <SheetDrawer
      open={open}
      onOpenChange={requestClose}
      title={`Edit ${name}`}
      description="Changes apply when you save."
      size="xl"
      footer={
        confirmDiscard ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-ink">
              Discard {changedCount} unsaved change{changedCount === 1 ? '' : 's'}?
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onOpenChange(false)}>
                Discard changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-ink-3" aria-live="polite">
              {changedCount
                ? `${changedCount} unsaved change${changedCount === 1 ? '' : 's'}`
                : 'No changes yet'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => requestClose(false)}
                disabled={editor.saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={!editor.dirty || editor.saving}
              >
                {editor.saving ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save aria-hidden className="h-3.5 w-3.5" />
                )}
                {editor.saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {editor.error ? (
        <Notice tone="error" className="m-5 mb-0" title="Not saved">
          {editor.error}
        </Notice>
      ) : null}
      <div className="divide-y divide-rule">
        {sectionsFor(lead.vertical).map(section => (
          <section
            key={section.id}
            id={`edit-section-${section.id}`}
            aria-labelledby={`edit-heading-${section.id}`}
            className="scroll-mt-2 px-5 py-5"
          >
            <h3 id={`edit-heading-${section.id}`} className="text-[14px] font-semibold text-ink">
              {section.title}
            </h3>
            {section.hint ? (
              <p className="mt-0.5 text-[12.5px] text-ink-3">{section.hint}</p>
            ) : null}
            <LeadSectionFields
              className="mt-3.5"
              section={section}
              lead={lead}
              edits={editor.edits}
              onEdit={editor.setField}
              assignees={canAssign ? users : null}
              disabled={editor.saving}
            />
          </section>
        ))}
      </div>
    </SheetDrawer>
  );
}
