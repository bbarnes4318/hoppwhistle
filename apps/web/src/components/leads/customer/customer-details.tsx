'use client';

/**
 * The complete record, read: every field the customer has, grouped the way
 * an agent thinks about them, each group editable on its own. Compliance and
 * source data, script captures and system metadata come last -- kept, never
 * in the way.
 */

import { ExternalLink, Pencil } from 'lucide-react';
import * as React from 'react';

import { Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { money, wholeDollars } from '@/lib/fex/api';
import { formatPhoneNumber } from '@/lib/utils';

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
import { ReadField, ReadList } from './read-fields';

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
      return priorityLabel(lead.priority);
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

function SectionCard({
  title,
  hint,
  onEdit,
  children,
  id,
}: {
  title: string;
  hint?: string;
  onEdit?: () => void;
  children: React.ReactNode;
  id?: string;
}): JSX.Element {
  return (
    <Panel className="min-w-0 overflow-hidden" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {hint ? <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p> : null}
        </div>
        {onEdit ? (
          <Button
            size="sm"
            variant="ghost"
            className="-mr-2 -mt-1 shrink-0"
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}
      </div>
      <div className="px-5 pb-3 pt-2">{children}</div>
    </Panel>
  );
}

function FieldsSection({
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
  // The legacy per-carrier figures: only those the lead carries are read out.
  const fields =
    section.id === 'carrierQuotes'
      ? section.fields.filter(f => rawFieldValue(lead, f) !== '')
      : section.fields.filter(f => f.key !== 'assignedToId' || canAssign || lead.assignedToId);

  return (
    <SectionCard
      id={`details-${section.id}`}
      title={section.title}
      hint={section.hint}
      onEdit={() => onEdit(section.id)}
    >
      {fields.length ? (
        <ReadList columns={2}>
          {fields.map(field => (
            <ReadField
              key={field.key}
              label={field.label}
              wide={field.wide}
              mono={field.key === 'leadidToken'}
              stacked
            >
              {display(lead, field, assignee)}
            </ReadField>
          ))}
        </ReadList>
      ) : (
        <p className="py-2 text-[13.5px] text-ink-3">None posted with this lead.</p>
      )}
    </SectionCard>
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
  const sections = sectionsFor(lead.vertical);
  const byId = new Map(sections.map(s => [s.id, s]));
  const captures = scriptCaptures(lead);
  const pick = (...ids: LeadSectionId[]) =>
    ids.map(id => byId.get(id)).filter((s): s is LeadSectionDef => Boolean(s));

  const render = (section: LeadSectionDef) => (
    <FieldsSection
      key={section.id}
      lead={lead}
      section={section}
      assignee={assignee}
      canAssign={canAssign}
      onEdit={onEdit}
    />
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-4">
        {pick('personal', 'company', 'contact', 'address').map(render)}
      </div>
      <div className="min-w-0 space-y-4">{pick('finalExpense', 'crm').map(render)}</div>
      <div className="min-w-0 space-y-4 xl:col-span-2">
        {pick('carrierQuotes').map(render)}
        {captures.length ? (
          <SectionCard title="Script data" hint="Answers captured by call scripts and lead forms.">
            <ReadList columns={2}>
              {captures.map(([key, value]) => (
                <ReadField key={key} label={humanKey(key)} stacked>
                  {showValue(value)}
                </ReadField>
              ))}
            </ReadList>
          </SectionCard>
        ) : null}
        <SectionCard title="Record" hint="System details, for support and audits.">
          <ReadList columns={2}>
            <ReadField label="Customer ID" mono>
              {lead.id}
            </ReadField>
            <ReadField label="Vertical">
              {lead.vertical === 'FE'
                ? 'Final expense'
                : lead.vertical === 'ACA'
                  ? 'ACA health'
                  : 'B2B'}
            </ReadField>
            <ReadField label="Source">{lead.source}</ReadField>
            <ReadField label="Lead status">{lead.status}</ReadField>
            <ReadField label="Created">{formatDateTime(lead.createdAt)}</ReadField>
            <ReadField label="Updated">{formatDateTime(lead.updatedAt)}</ReadField>
            <ReadField label="Assigned">{formatDateTime(lead.assignedAt)}</ReadField>
            <ReadField label="Tags">{lead.tags?.length ? lead.tags.join(', ') : null}</ReadField>
            {lead.duplicateOfId ? (
              <ReadField label="Duplicate of" mono>
                {lead.duplicateOfId}
              </ReadField>
            ) : null}
            <ReadField label="Submissions">{String(lead.submissions?.length ?? 0)}</ReadField>
          </ReadList>
        </SectionCard>
      </div>
    </div>
  );
}
