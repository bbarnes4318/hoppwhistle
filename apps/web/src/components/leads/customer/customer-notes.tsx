'use client';

/**
 * A customer's notes. The record keeps one notes field; adding a note here
 * puts a dated, signed entry at the top of it, so the field reads as a
 * history, newest first. The whole text stays editable for a correction, and
 * every change is also logged to Activity by the server.
 */

import { Loader2, MessageSquare } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { patchInsuranceLeadFields, type InsuranceLeadDetail } from '@/lib/api/leads';

import { formatDateTime } from './format';
import { EditButton, InlineEmpty } from './primitives';

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

/** "Jane Agent" -> "JA". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
    <section className="min-w-0 border-t border-rule lg:border-t-0" aria-labelledby="notes-title">
      <div className="flex min-h-[56px] items-center justify-between gap-3 px-7 pt-4">
        <h2 id="notes-title" className="text-[15px] font-semibold text-ink">
          Notes
        </h2>
        {entries.length && editing === null ? (
          <EditButton
            onClick={() => setEditing(lead.notes ?? '')}
            label="Edit all"
            className="-mr-2"
          />
        ) : null}
      </div>

      {editing !== null ? (
        <div className="space-y-2 px-7 py-4">
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
          <form onSubmit={add} className="px-7 pb-5 pt-3">
            <Textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={3}
              placeholder="What they said, what they need, what happens next…"
              aria-label="New note"
              className="min-h-[76px] resize-y"
              disabled={saving}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e);
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[12px] text-ink-3">
                Saved with the time and your name ·{' '}
                <kbd className="rounded border border-rule bg-sunken px-1 font-sans text-[11px] text-ink-2">
                  Ctrl
                </kbd>{' '}
                +{' '}
                <kbd className="rounded border border-rule bg-sunken px-1 font-sans text-[11px] text-ink-2">
                  Enter
                </kbd>
              </p>
              <Button size="sm" variant="outline" type="submit" disabled={saving || !draft.trim()}>
                {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                Add note
              </Button>
            </div>
          </form>

          {entries.length ? (
            <ol aria-label="Note history" className="border-t border-rule">
              {entries.map((entry, i) => (
                <li key={i} className="flex gap-3 px-7 py-4 [&+li]:border-t [&+li]:border-rule">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2"
                  >
                    {entry.author ? (
                      initials(entry.author)
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 text-ink-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                      <span className="font-semibold text-ink">
                        {entry.author ?? (entry.at ? 'Note' : 'Earlier note')}
                      </span>
                      {entry.at ? (
                        <span className="tabular-nums text-ink-3">{entry.at}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-[22px] text-ink">
                      {entry.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <InlineEmpty
              className="px-7 py-4"
              icon={MessageSquare}
              title="No notes yet"
              body="What you learn on a call belongs here, so the next conversation starts where this one ended."
            />
          )}
        </>
      )}
    </section>
  );
}
