'use client';

/**
 * The input for one lead field, and a section of them, drawn from the field
 * schema. Used wherever the record is edited: the customer page's edit
 * drawer and the CRM sheet.
 */

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { InsuranceLeadDetail, UserSummary } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { userName } from './format';
import {
  editorValue,
  isFieldEdited,
  type LeadFieldDef,
  type LeadFieldOption,
  type LeadSectionDef,
} from './lead-fields';

/** A native select, drawn like the product's inputs. */
export const SELECT_CLASS =
  'flex h-9 w-full rounded-control border border-rule-strong bg-surface px-2.5 text-sm text-ink shadow-card transition-[border-color,box-shadow] duration-150 ease-out hover:border-ink-3 focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 [@media(pointer:coarse)]:min-h-[40px]';

/** An edited, unsaved field: a ring in the "pending" tone, so a reviewer sees what will change. */
const EDITED = 'border-ringing ring-1 ring-ringing-tint';

export interface LeadFieldInputProps {
  lead: InsuranceLeadDetail;
  field: LeadFieldDef;
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
  /** The people a customer may be assigned to; absent, the field is not offered. */
  assignees?: UserSummary[] | null;
  disabled?: boolean;
}

export function LeadFieldInput({
  lead,
  field,
  edits,
  onEdit,
  assignees,
  disabled,
}: LeadFieldInputProps): JSX.Element | null {
  const id = `lead-${lead.id}-${field.key}`;
  const value = edits[field.key] ?? editorValue(lead, field);
  const edited = isFieldEdited(lead, field.key, edits);
  const set = (next: string) => onEdit(field.key, next);

  if (field.key === 'assignedToId' && !assignees) return null;

  if (field.kind === 'boolean') {
    return (
      <label
        htmlFor={id}
        className={cn(
          'flex cursor-pointer select-none items-center gap-2.5 rounded-control py-1.5 text-sm text-ink',
          field.wide && 'col-span-2'
        )}
      >
        <input
          id={id}
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          onChange={e => set(e.target.checked ? 'true' : 'false')}
          className="h-4 w-4 rounded border-rule-strong text-brand-ink focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className={cn('font-medium', edited && 'text-ringing-ink')}>{field.label}</span>
      </label>
    );
  }

  let control: React.ReactNode;
  if (field.kind === 'select') {
    const options: LeadFieldOption[] =
      field.key === 'assignedToId'
        ? (assignees ?? []).map(u => ({ value: u.id, label: userName(u) }))
        : (field.options ?? []);
    // A value the options do not know (an older import) is kept, not dropped.
    const known = !value || options.some(o => o.value === value);
    control = (
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={e => set(e.target.value)}
        className={cn(SELECT_CLASS, edited && EDITED)}
      >
        <option value="">{field.key === 'assignedToId' ? 'Unassigned' : 'Not set'}</option>
        {known ? null : <option value={value}>{value}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'longtext') {
    control = (
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        rows={3}
        onChange={e => set(e.target.value)}
        className={cn('resize-y', edited && EDITED)}
      />
    );
  } else {
    const type =
      field.kind === 'datetime'
        ? 'datetime-local'
        : field.kind === 'number'
          ? 'number'
          : field.kind === 'email'
            ? 'email'
            : field.kind === 'phone'
              ? 'tel'
              : field.kind === 'url'
                ? 'url'
                : 'text';
    control = (
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={e => set(e.target.value)}
        className={cn(edited && EDITED)}
      />
    );
  }

  return (
    <div className={cn('min-w-0 space-y-1.5', field.wide && 'col-span-2')}>
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink-2">
        {field.label}
      </label>
      {control}
    </div>
  );
}

/** A section's fields in a two-column grid. */
export function LeadSectionFields({
  section,
  className,
  ...props
}: Omit<LeadFieldInputProps, 'field'> & {
  section: LeadSectionDef;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-x-3 gap-y-3', className)}>
      {section.fields.map(field => (
        <LeadFieldInput key={field.key} field={field} {...props} />
      ))}
    </div>
  );
}
