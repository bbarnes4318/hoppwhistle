/**
 * Every editable field on a CRM customer, described once.
 *
 * The customer page reads the record from this (Details, the summary card)
 * and edits it from this (the edit drawer); the CRM sheet edits inline from
 * this. A field added here shows up, labelled and grouped the same way, in
 * all three -- no screen hand-writes an input for a lead field any more.
 *
 * Pure: no React, so the patch a save sends is tested without a browser.
 */

import type { InsuranceLeadDetail } from '@/lib/api/leads';

export type LeadVertical = InsuranceLeadDetail['vertical'];

export type LeadFieldKind =
  | 'text'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  | 'datetime'
  | 'select'
  | 'boolean'
  | 'longtext';

export interface LeadFieldOption {
  value: string;
  label: string;
}

export interface LeadFieldDef {
  /** The PATCH key: a lead column, or a `customFields` key when `custom`. */
  key: string;
  label: string;
  kind: LeadFieldKind;
  options?: LeadFieldOption[];
  /** Stored in `customFields` rather than a column. */
  custom?: boolean;
  /** Takes the full row in a two-column grid. */
  wide?: boolean;
  placeholder?: string;
}

export type LeadSectionId =
  | 'personal'
  | 'contact'
  | 'company'
  | 'address'
  | 'finalExpense'
  | 'crm'
  | 'compliance'
  | 'carrierQuotes';

export interface LeadSectionDef {
  id: LeadSectionId;
  title: string;
  /** One line under the title, in Details. */
  hint?: string;
  /** Only shown for these verticals; every vertical when absent. */
  verticals?: LeadVertical[];
  fields: LeadFieldDef[];
}

export const STAGE_OPTIONS: LeadFieldOption[] = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'UNDERWRITING', label: 'Underwriting' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'CLOSED_WON', label: 'Closed won' },
  { value: 'CLOSED_LOST', label: 'Closed lost' },
];

export const PRIORITY_OPTIONS: LeadFieldOption[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

export const TOBACCO_OPTIONS: LeadFieldOption[] = [
  { value: 'NO', label: 'Non-tobacco' },
  { value: 'YES', label: 'Tobacco' },
];

/**
 * The legacy per-carrier quote figures some lead sources post, kept in
 * `customFields`. The quoter replaced them; they stay readable and editable
 * for the records that carry them.
 */
const CARRIER_QUOTE_FIELDS: Array<[string, string]> = [
  ['aflacMonthlyQuote', 'Aflac monthly'],
  ['aflacModifiedMonthlyQuote', 'Aflac modified monthly'],
  ['sbliMonthlyQuote', 'SBLI monthly'],
  ['sbliModifiedMonthlyQuote', 'SBLI modified monthly'],
  ['cicaMonthlyQuote', 'CICA monthly'],
  ['cicaGiMonthlyQuote', 'CICA GI monthly'],
  ['gtlMonthlyQuote', 'GTL monthly'],
  ['transamericaMonthlyQuote', 'Transamerica monthly'],
  ['transamericaGradedMonthlyQuote', 'Transamerica graded monthly'],
  ['corebridgeMonthlyQuote', 'Corebridge monthly'],
  ['amamMonthlyQuote', 'AmAm monthly'],
  ['amamGradedMonthlyQuote', 'AmAm graded monthly'],
  ['amamReturnOrPremiumMonthlyQuote', 'AmAm return of premium monthly'],
  ['ahlMonthlyQuote', 'AHL monthly'],
  ['ahlGradedMonthlyQuote', 'AHL graded monthly'],
  ['royalNeighborsMonthlyQuote', 'Royal Neighbors monthly'],
  ['royalNeighborsGradedMonthlyQuote', 'Royal Neighbors graded monthly'],
  ['gerberGiMonthlyQuote', 'Gerber GI monthly'],
  ['mutualOfOmahaMonthlyQuote', 'Mutual of Omaha monthly'],
  ['mutualOfOmahaGradedMonthlyQuote', 'Mutual of Omaha graded monthly'],
  ['amamQuote', 'AmAm quote'],
  ['amamLessThanCurrent', 'AmAm less than current'],
  ['gtlQuote', 'GTL quote'],
  ['gtlLessThanCurrent', 'GTL less than current'],
  ['cheapestCarrierUnderCurrent', 'Cheapest carrier under current'],
  ['savingsVsCurrent', 'Savings vs current'],
];

export const CARRIER_QUOTE_KEYS: ReadonlySet<string> = new Set(
  CARRIER_QUOTE_FIELDS.map(([key]) => key)
);

export const LEAD_SECTIONS: LeadSectionDef[] = [
  {
    id: 'personal',
    title: 'Personal',
    verticals: ['FE', 'ACA'],
    fields: [
      { key: 'firstName', label: 'First name', kind: 'text' },
      { key: 'lastName', label: 'Last name', kind: 'text' },
      { key: 'birthDate', label: 'Date of birth', kind: 'text', placeholder: 'MM/DD/YYYY' },
      { key: 'age', label: 'Age', kind: 'number' },
      { key: 'gender', label: 'Sex', kind: 'text', placeholder: 'Male or Female' },
    ],
  },
  {
    id: 'company',
    title: 'Company',
    verticals: ['B2B'],
    fields: [
      { key: 'company', label: 'Company', kind: 'text' },
      { key: 'repName', label: 'Rep name', kind: 'text' },
      { key: 'industry', label: 'Industry', kind: 'text' },
      { key: 'revenue', label: 'Revenue', kind: 'text' },
      { key: 'yearEstablished', label: 'Year established', kind: 'text' },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    fields: [
      { key: 'phone', label: 'Phone', kind: 'phone' },
      { key: 'email', label: 'Email', kind: 'email' },
    ],
  },
  {
    id: 'address',
    title: 'Address',
    fields: [
      { key: 'address', label: 'Street address', kind: 'text', wide: true },
      { key: 'address2', label: 'Address line 2', kind: 'text', wide: true },
      { key: 'city', label: 'City', kind: 'text' },
      { key: 'state', label: 'State', kind: 'text' },
      { key: 'zipCode', label: 'ZIP code', kind: 'text' },
      { key: 'county', label: 'County', kind: 'text' },
    ],
  },
  {
    id: 'finalExpense',
    title: 'Final expense',
    hint: 'What the customer asked for, and the policy on record.',
    verticals: ['FE'],
    fields: [
      { key: 'smoker', label: 'Tobacco', kind: 'select', options: TOBACCO_OPTIONS },
      { key: 'faceAmount', label: 'Face amount', kind: 'text' },
      { key: 'coverageAmount', label: 'Coverage amount', kind: 'text' },
      { key: 'monthlyPremium', label: 'Monthly premium', kind: 'text' },
      { key: 'carrier', label: 'Carrier', kind: 'text' },
      { key: 'product', label: 'Product', kind: 'text' },
      { key: 'lifeType', label: 'Life type', kind: 'text' },
      { key: 'riskType', label: 'Risk type', kind: 'text' },
    ],
  },
  {
    id: 'crm',
    title: 'Sales status',
    fields: [
      { key: 'assignedToId', label: 'Assigned to', kind: 'select' },
      { key: 'leadStage', label: 'Stage', kind: 'select', options: STAGE_OPTIONS },
      { key: 'priority', label: 'Priority', kind: 'select', options: PRIORITY_OPTIONS },
      { key: 'nextFollowUpAt', label: 'Next follow-up', kind: 'datetime' },
      { key: 'lastContactedAt', label: 'Last contacted', kind: 'datetime' },
      { key: 'doNotCall', label: 'Do not call (DNC)', kind: 'boolean', wide: true },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance & source',
    hint: 'Consent and proof captured when the lead came in.',
    verticals: ['FE'],
    fields: [
      { key: 'trustedFormUrl', label: 'TrustedForm URL', kind: 'url' },
      { key: 'leadidToken', label: 'LeadiD token', kind: 'text' },
      { key: 'recordingUrl', label: 'Recording URL', kind: 'url', wide: true },
      { key: 'consentLanguage', label: 'Consent language', kind: 'longtext', wide: true },
    ],
  },
  {
    id: 'carrierQuotes',
    title: 'Carrier quote fields',
    hint: 'Per-carrier figures posted with the lead. Saved quotes live under Overview.',
    verticals: ['FE'],
    fields: CARRIER_QUOTE_FIELDS.map(([key, label]) => ({
      key,
      label,
      kind: 'text' as const,
      custom: true,
    })),
  },
];

/** The sections a lead of this vertical has. */
export function sectionsFor(vertical: LeadVertical): LeadSectionDef[] {
  return LEAD_SECTIONS.filter(s => !s.verticals || s.verticals.includes(vertical));
}

export function sectionById(id: LeadSectionId): LeadSectionDef {
  const section = LEAD_SECTIONS.find(s => s.id === id);
  if (!section) throw new Error(`Unknown lead section ${id}`);
  return section;
}

/** The value a field holds on the record, as an editable string. */
export function rawFieldValue(lead: InsuranceLeadDetail, field: LeadFieldDef): string {
  const source = field.custom
    ? (lead.customFields ?? {})[field.key]
    : (lead as unknown as Record<string, unknown>)[field.key];
  if (source === null || source === undefined) return '';
  if (typeof source === 'boolean') return source ? 'true' : 'false';
  if (typeof source === 'string' || typeof source === 'number') return String(source);
  return JSON.stringify(source);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * An ISO timestamp as a `datetime-local` value, in the viewer's own time
 * zone: a follow-up set for 2pm reads 2pm, not the UTC hour.
 */
export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A field's starting value in an editor. */
export function editorValue(lead: InsuranceLeadDetail, field: LeadFieldDef): string {
  const raw = rawFieldValue(lead, field);
  return field.kind === 'datetime' ? toLocalInput(raw) : raw;
}

/** Every field that may be edited, by key. */
const FIELD_BY_KEY = new Map(LEAD_SECTIONS.flatMap(s => s.fields.map(f => [f.key, f] as const)));

/**
 * The PATCH body for a set of edits, in the shapes the API validates:
 * booleans as booleans, a cleared date as null, a `datetime-local` value as
 * the instant it names, and the legacy carrier figures merged back into
 * `customFields` (the API replaces that object whole).
 */
export function buildLeadPatch(
  lead: InsuranceLeadDetail,
  edits: Record<string, string>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let customFields: Record<string, unknown> | null = null;

  for (const [key, value] of Object.entries(edits)) {
    const field = FIELD_BY_KEY.get(key);
    if (field?.custom) {
      customFields ??= { ...(lead.customFields ?? {}) };
      customFields[key] = value;
      continue;
    }
    if (field?.kind === 'boolean') {
      patch[key] = value === 'true';
    } else if (field?.kind === 'datetime') {
      const at = value ? new Date(value) : null;
      patch[key] = at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
    } else {
      patch[key] = value;
    }
  }
  if (customFields) patch.customFields = customFields;
  return patch;
}

/** Whether an edit differs from what the record holds. */
export function isFieldEdited(
  lead: InsuranceLeadDetail,
  key: string,
  edits: Record<string, string>
): boolean {
  if (edits[key] === undefined) return false;
  const field = FIELD_BY_KEY.get(key);
  const current = field ? editorValue(lead, field) : '';
  return edits[key] !== current;
}

/** Only the edits that change something. */
export function changedEdits(
  lead: InsuranceLeadDetail,
  edits: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(edits).filter(([key]) =>
      FIELD_BY_KEY.has(key) ? isFieldEdited(lead, key, edits) : true
    )
  );
}
