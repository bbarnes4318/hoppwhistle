'use client';

/**
 * A customer's notes. The record keeps one notes field; adding a note here
 * puts a dated, signed entry at the top of it, so the field reads as a
 * history, newest first. The whole text stays editable for a correction, and
 * every change is also logged to Activity by the server.
 */

import { Loader2, MessageSquare, Pencil } from 'lucide-react';
import * as React from 'react';

import { Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { patchInsuranceLeadFields, type InsuranceLeadDetail } from '@/lib/api/leads';

import { formatDateTime } from './format';

/** "Oct 8, 2026, 2:05 PM · Jane Agent" -- the first line of an entry added here. */
const ENTRY_HEADER = /^([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M)(?: · (.+))?$/;

interface NoteEntry {
  at: string | null;
  author: string | null;
  body: string;
}

/** The notes field as entries: blocks separated by a blank line. */
export function parseNotes(notes: string | null): NoteEntry[] {
  if (!notes?.trim()) return [];
  return notes
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [first, ...rest] = block.split('\n');
      const header = ENTRY_HEADER.exec(first.trim());
      return header && rest.length
        ? { at: header[1], author: header[2] ?? null, body: rest.join('\n') }
        : { at: null, author: null, body: block };
    });
}

export function CustomerNotes({
  lead,
  onSaved,
}: {
  lead: InsuranceLeadDetail;
  onSaved: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const [draft, setDraft] = React.useState('');
  const [editing, setEditing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const entries = parseNotes(lead.notes);
  const author = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

  const write = async (notes: string, done: () => void) => {
    setSaving(true);
    try {
      await patchInsuranceLeadFields(lead.id, { notes });
      done();
      onSaved();
    } catch (err) {
      toast({
        title: 'The note was not saved',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const header = [formatDateTime(new Date().toISOString()), author || null]
      .filter(Boolean)
      .join(' · ');
    const next = [`${header}\n${text}`, lead.notes?.trim()].filter(Boolean).join('\n\n');
    void write(next, () => setDraft(''));
  };

  return (
    <Panel className="min-w-0 overflow-hidden" aria-labelledby="notes-title">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <h2 id="notes-title" className="text-[16px] font-semibold text-ink">
          Notes
        </h2>
        {entries.length && editing === null ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(lead.notes ?? '')}>
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            Edit all
          </Button>
        ) : null}
      </div>

      {editing !== null ? (
        <div className="space-y-2 px-5 py-4">
          <Textarea
            value={editing}
            onChange={e => setEditing(e.target.value)}
            rows={10}
            aria-label="All notes"
            className="resize-y font-normal"
            disabled={saving}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || editing === (lead.notes ?? '')}
              onClick={() => void write(editing, () => setEditing(null))}
            >
              {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
              Save notes
            </Button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={add} className="space-y-2 border-b border-rule px-5 py-4">
            <Textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={draft ? 3 : 2}
              placeholder="Add a note — what they said, what they need, what's next…"
              aria-label="New note"
              className="min-h-0 resize-y"
              disabled={saving}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e);
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-ink-3">Dated and signed. Ctrl+Enter to add.</p>
              <Button size="sm" type="submit" disabled={saving || !draft.trim()}>
                {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                Add note
              </Button>
            </div>
          </form>

          {entries.length ? (
            <ol className="divide-y divide-rule">
              {entries.map((entry, i) => (
                <li key={i} className="px-5 py-3.5">
                  {entry.at ? (
                    <p className="text-[12.5px] text-ink-3">
                      <span className="tabular-nums">{entry.at}</span>
                      {entry.author ? (
                        <span className="font-medium text-ink-2"> · {entry.author}</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-[22px] text-ink">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex items-center gap-3 px-5 py-5 text-[13.5px] text-ink-3">
              <MessageSquare aria-hidden className="h-4 w-4" />
              No notes yet. What you learn on a call belongs here.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
