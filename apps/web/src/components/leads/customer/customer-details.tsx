'use client';

/**
 * The complete record as an inspector: one band per group, the group's name
 * and its Edit on the left, its fields in a dense aligned grid on the right,
 * on the same sheet as the rest of the workspace. An empty field is a quiet
 * dash -- "Not provided" only for the few an agent must go and get -- and the
 * system's own bookkeeping (IDs, timestamps) folds away under a disclosure.
 */

import { ChevronRight, ExternalLink, Pencil } from 'lucide-react';
import * as React from 'react';

import { formatEnumLabel } from '@/components/domain';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { money, wholeDollars } from '@/lib/fex/api';
import { cn, formatPhoneNumber } from '@/lib/utils';

import { formatDateTime, priorityLabel, stageLabel } from './format';
import {
  CARRIER_QUOTE_KEYS,
  rawFieldValue,
  sectionsFor,
  TOBACCO_OPTIONS,
  type LeadFieldDef,
  type LeadSectionDef,
  type LeadSectionId,
} from './lead-fields';
import { TextAction } from './workspace';

const MONEY_KEYS = new Set(['faceAmount', 'coverageAmount', 'monthlyPremium']);

function display(
  lead: InsuranceLeadDetail,
  field: LeadFieldDef,
  assignee: string | null
): React.ReactNode {
  const raw = rawFieldValue(lead, field);
  switch (field.key) {
    case 'assignedToId':
      return lead.assignedToId ? assignee : <span className="text-ink-3">Unassigned</span>;
    case 'leadStage':
      return stageLabel(lead.leadStage);
    case 'priority':
      return priorityLabel(lead.priority) ?? 'Normal';
    case 'nextFollowUpAt':
      return lead.nextFollowUpAt ? (
        formatDateTime(lead.nextFollowUpAt)
      ) : (
        <span className="text-ink-3">None set</span>
      );
    case 'lastContactedAt':
      return lead.lastContactedAt ? (
        formatDateTime(lead.lastContactedAt)
      ) : (
        <span className="text-ink-3">Never</span>
      );
    case 'smoker':
      return TOBACCO_OPTIONS.find(o => o.value === raw)?.label ?? raw;
    case 'phone':
      return raw ? formatPhoneNumber(raw) : null;
    case 'doNotCall':
      return lead.doNotCall ? (
        <span className="font-medium text-blocked-ink">Yes — do not call</span>
      ) : (
        'No'
      );
  }
  if (!raw) return null;
  if (field.kind === 'datetime') return formatDateTime(raw);
  if (MONEY_KEYS.has(field.key)) {
    const amount = Number(raw.replace(/[$,\s]/g, ''));
    if (Number.isFinite(amount) && raw.trim() !== '') {
      return field.key === 'monthlyPremium' ? `${money(amount)}/mo` : wholeDollars(amount);
    }
  }
  if (field.kind === 'email') {
    return (
      <a href={`mailto:${raw}`} className="hover:underline">
        {raw}
      </a>
    );
  }
  if (field.kind === 'url' && /^https?:\/\//i.test(raw)) {
    return (
      <a
        href={raw}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 text-brand-ink hover:underline"
      >
        <span className="truncate">{raw}</span>
        <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
      </a>
    );
  }
  if (field.kind === 'longtext') return <span className="whitespace-pre-wrap">{raw}</span>;
  return raw;
}

/** Fields an agent must go and get: empty, they say so. */
const NEEDED = new Set(['phone', 'birthDate', 'gender', 'state', 'smoker', 'faceAmount']);

function Value({
  value,
  needed,
  mono,
}: {
  value: React.ReactNode;
  needed: boolean;
  mono?: boolean;
}): JSX.Element {
  const empty = value === null || value === undefined || value === '';
  if (empty) {
    return needed ? (
      <span className="text-[14px] text-ink-3">Not provided</span>
    ) : (
      <span aria-label="Not provided" className="text-[14px] text-ink-3 opacity-50">
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        'break-words text-[14px] font-medium text-ink',
        mono && 'font-mono text-[13px] font-normal'
      )}
    >
      {value}
    </span>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className="mt-1 min-w-0 leading-5">{children}</dd>
    </div>
  );
}

/** One band of the inspector: the group's name and Edit, then its fields. */
function Band({
  id,
  title,
  hint,
  onEdit,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  onEdit?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid border-b border-rule lg:grid-cols-[240px_minmax(0,1fr)]"
    >
      <div className="px-7 pb-1 pt-5 lg:pb-5">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-[13px] leading-5 text-ink-3">{hint}</p> : null}
        {onEdit ? (
          <TextAction
            icon={Pencil}
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
            className="-ml-2 mt-2"
          >
            Edit
          </TextAction>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-7 pb-6 pt-4 lg:pl-0 lg:pt-5 xl:grid-cols-4">
        {children}
      </dl>
    </section>
  );
}

function FieldsBand({
  lead,
  section,
  assignee,
  canAssign,
  onEdit,
}: {
  lead: InsuranceLeadDetail;
  section: LeadSectionDef;
  assignee: string | null;
  canAssign: boolean;
  onEdit: (section: LeadSectionId) => void;
}): JSX.Element {
  const fields = section.fields.filter(
    f =>
      (f.key !== 'assignedToId' || canAssign || lead.assignedToId) &&
      (section.id !== 'carrierQuotes' || rawFieldValue(lead, f) !== '')
  );
  return (
    <Band
      id={`details-${section.id}`}
      title={section.title}
      hint={section.hint}
      onEdit={() => onEdit(section.id)}
    >
      {fields.map(field => (
        <Field
          key={field.key}
          label={field.label}
          wide={field.wide || field.kind === 'email' || field.kind === 'url'}
        >
          <Value
            value={display(lead, field, assignee)}
            needed={NEEDED.has(field.key)}
            mono={field.key === 'leadidToken'}
          />
        </Field>
      ))}
    </Band>
  );
}

/** Script captures that are not one of the record's own fields. */
function scriptCaptures(lead: InsuranceLeadDetail): Array<[string, unknown]> {
  return Object.entries(lead.customFields ?? {}).filter(([key]) => !CARRIER_QUOTE_KEYS.has(key));
}

const humanKey = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());

const showValue = (value: unknown): string =>
  typeof value === 'boolean'
    ? value
      ? 'Yes'
      : 'No'
    : value === null || value === undefined || value === ''
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value as string | number);

/** IDs and timestamps: for support and audits, folded away by default. */
function SystemInformation({ lead }: { lead: InsuranceLeadDetail }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const rows: Array<[string, React.ReactNode, boolean?]> = [
    ['Customer ID', lead.id, true],
    [
      'Vertical',
      lead.vertical === 'FE' ? 'Final expense' : lead.vertical === 'ACA' ? 'ACA health' : 'B2B',
    ],
    ['Lead source', lead.source],
    ['Intake status', lead.status ? formatEnumLabel(lead.status) : null],
    ['Created', formatDateTime(lead.createdAt)],
    ['Updated', formatDateTime(lead.updatedAt)],
    ['Assigned', formatDateTime(lead.assignedAt)],
    ['Submissions', String(lead.submissions?.length ?? 0)],
    ['Tags', lead.tags?.length ? lead.tags.join(', ') : null],
    ...(lead.duplicateOfId
      ? [['Duplicate of', lead.duplicateOfId, true] as [string, string, boolean]]
      : []),
  ];
  return (
    <section aria-label="System information" className="bg-paper">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-7 py-4 text-left transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn('h-4 w-4 text-ink-3 transition-transform', open && 'rotate-90')}
        />
        <span className="text-[14px] font-semibold text-ink-2">System information</span>
        <span className="text-[13px] text-ink-3">Record ID, source and timestamps</span>
      </button>
      {open ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 px-7 pb-6 pt-1 lg:pl-[264px] xl:grid-cols-4">
          {rows.map(([label, value, mono]) => (
            <Field key={label} label={label} wide={mono && label === 'Customer ID'}>
              <Value value={value} needed={false} mono={mono} />
            </Field>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

export function CustomerDetails({
  lead,
  assignee,
  canAssign,
  onEdit,
}: {
  lead: InsuranceLeadDetail;
  assignee: string | null;
  canAssign: boolean;
  onEdit: (section: LeadSectionId) => void;
}): JSX.Element {
  const captures = scriptCaptures(lead);
  const sections = sectionsFor(lead.vertical).filter(
    section =>
      section.id !== 'compliance' &&
      (section.id !== 'carrierQuotes' || section.fields.some(f => rawFieldValue(lead, f) !== ''))
  );

  return (
    <div>
      {sections.map(section => (
        <FieldsBand
          key={section.id}
          lead={lead}
          section={section}
          assignee={assignee}
          canAssign={canAssign}
          onEdit={onEdit}
        />
      ))}
      {captures.length ? (
        <Band
          id="details-script"
          title="Script data"
          hint="Answers captured by call scripts and lead forms."
        >
          {captures.map(([key, value]) => (
            <Field key={key} label={humanKey(key)}>
              <Value value={showValue(value)} needed={false} />
            </Field>
          ))}
        </Band>
      ) : null}
      <SystemInformation lead={lead} />
    </div>
  );
}
