import { Check, Copy, FileText, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { FOCUS_RING } from './parts';

/**
 * The caller's record, laid out the way a CRM lays out a record: sections,
 * and under each a two-column grid of label and value, every field visible.
 *
 * It used to be a card of three fields with "Show N more" under the hang-up
 * button, which meant the agent clicked to find out who they were talking to.
 * Nothing here collapses. A long record scrolls inside its own pane, so the
 * call controls never move.
 *
 * Phone numbers, emails and IDs are set in the data face so digits line up and
 * read unambiguously, and every value copies on click, because the next thing
 * an agent does with an email address is paste it somewhere.
 */
export interface CustomerRecordRow {
  label: string;
  value: string | null | undefined;
  /** Set in the data face: phone numbers, emails, IDs, account numbers. */
  mono?: boolean;
  /** Takes the full width, for notes and addresses. */
  wide?: boolean;
}

export interface CustomerRecordSection {
  id: string;
  title: string;
  icon?: LucideIcon;
  rows: CustomerRecordRow[];
}

export interface CustomerRecordProps {
  sections: CustomerRecordSection[];
  /** Shown in the pane's header bar. */
  title?: string;
  className?: string;
}

/** The sections with their empty rows dropped, and the sections left empty dropped too. */
export function visibleSections(sections: CustomerRecordSection[]): CustomerRecordSection[] {
  const seen = new Set<string>();
  return sections
    .map(section => ({
      ...section,
      rows: section.rows.filter(row => {
        const value = row.value?.trim();
        if (!value) return false;
        // The lead and the intake form often both carry the phone and email;
        // the same fact twice is noise.
        const key = `${row.label.toLowerCase()}|${value.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    }))
    .filter(section => section.rows.length > 0);
}

export function CustomerRecord({
  sections,
  title = 'Customer record',
  className,
}: CustomerRecordProps): JSX.Element {
  const shown = visibleSections(sections);
  const fieldCount = shown.reduce((n, s) => n + s.rows.length, 0);

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-rule bg-surface',
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-rule bg-sunken px-3 py-2">
        <h3 className="t-label text-ink-2">{title}</h3>
        {fieldCount > 0 ? (
          <span className="t-meta tabular-nums text-ink-3">
            {fieldCount} field{fieldCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <FileText className="h-6 w-6 text-ink-3" aria-hidden />
          <p className="t-meta text-ink-3">No details on file for this caller</p>
        </div>
      ) : (
        <div className="divide-y divide-rule">
          {shown.map(section => (
            <RecordSection key={section.id} section={section} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordSection({ section }: { section: CustomerRecordSection }): JSX.Element {
  const Icon = section.icon;
  const headingId = React.useId();
  return (
    <div className="px-3 pb-2 pt-2.5">
      <h4
        id={headingId}
        className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
      >
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
        {section.title}
      </h4>
      <dl aria-labelledby={headingId} className="grid grid-cols-[124px_minmax(0,1fr)] gap-x-3">
        {section.rows.map(row => (
          <RecordRow key={`${row.label}-${row.value}`} row={row} />
        ))}
      </dl>
    </div>
  );
}

function RecordRow({ row }: { row: CustomerRecordRow }): JSX.Element {
  const value = row.value ?? '';
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = (): void => {
    try {
      void navigator.clipboard?.writeText(value).then(() => setCopied(true));
    } catch {
      // No clipboard (insecure origin, old browser): the value is still on screen.
    }
  };

  return (
    <>
      <dt className={cn('py-1 text-xs leading-5 text-ink-3', row.wide && 'col-span-2 pb-0')}>
        {row.label}
      </dt>
      <dd className={cn('group min-w-0 py-1', row.wide && 'col-span-2 pt-0')}>
        <button
          type="button"
          onClick={copy}
          title={
            row.mono && !row.wide ? `${value} (click to copy)` : `Copy ${row.label.toLowerCase()}`
          }
          aria-label={`${row.label}: ${value}. Copy`}
          className={cn(
            '-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-1.5 rounded-control px-1 text-left',
            'hover:bg-sunken',
            FOCUS_RING
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 leading-5 text-ink',
              // An email split mid-word reads as two values; one line, with the
              // full value on hover and on copy, reads as one.
              row.mono && !row.wide ? 'truncate' : 'break-words',
              row.mono ? 't-data' : 'text-[13px] font-medium',
              row.wide && 'whitespace-pre-wrap font-normal'
            )}
          >
            {value}
          </span>
          <span
            className={cn(
              'mt-0.5 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 ne-motion',
              'group-hover:opacity-100 group-focus-within:opacity-100',
              copied && 'text-phone-ink opacity-100'
            )}
            aria-hidden
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </span>
        </button>
        {copied ? (
          <span className="sr-only" role="status">
            Copied
          </span>
        ) : null}
      </dd>
    </>
  );
}
