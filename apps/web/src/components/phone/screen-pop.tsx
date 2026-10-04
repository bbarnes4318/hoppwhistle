'use client';

import { ListPlus, Megaphone, User } from 'lucide-react';

import { usePhone, type ProspectData, type ScreenPopField } from './phone-provider';
import {
  CustomerRecord,
  type CustomerRecordRow,
  type CustomerRecordSection,
} from './softphone/customer-record';

// ============================================================================
// Screen Pop Component
// ============================================================================

interface ScreenPopProps {
  data: ProspectData;
  /** Kept for callers; the record shows every field in both. */
  variant?: 'panel' | 'modal';
  className?: string;
}

/** Fields set in the data face, so digits line up. */
const MONO_KEYS = new Set(['phoneNumber', 'email', 'zipCode', 'id']);

/** Where the lead came from, as opposed to who the lead is. */
const ATTRIBUTION_KEYS = new Set(['leadSource', 'campaignName', 'createdAt']);

const ADDRESS_PARTS = ['city', 'state', 'zipCode'];

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "zip_code" / "zipCode" → "Zip code", for custom fields that carry no label. */
function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The lead's fields as record sections: who they are, then where they came
 * from, then anything else the lead source sent.
 *
 * Which fields appear, and in what order, is still the agent's choice from
 * Screen Pop settings. What changed is that every one they chose is shown.
 */
export function prospectSections(
  data: ProspectData,
  fields: ScreenPopField[]
): CustomerRecordSection[] {
  const enabled = fields.filter(f => f.enabled).sort((a, b) => a.order - b.order);
  const addressEnabled = enabled.some(f => f.key === 'address');

  const valueOf = (key: string): string | null => {
    if (key === 'address') {
      const street = displayValue(data.address);
      const rest = [data.city, data.state].filter(Boolean).join(', ');
      const line2 = [rest, data.zipCode].filter(Boolean).join(' ');
      return [street, line2].filter(Boolean).join('\n') || null;
    }
    if (key in data) return displayValue(data[key]);
    if (data.customFields && key in data.customFields) {
      return displayValue(data.customFields[key]);
    }
    return null;
  };

  const contact: CustomerRecordRow[] = [];
  const attribution: CustomerRecordRow[] = [];

  for (const field of enabled) {
    // The address row already carries city, state and zip.
    if (addressEnabled && ADDRESS_PARTS.includes(field.key)) continue;
    const row: CustomerRecordRow = {
      label: field.label,
      value: valueOf(field.key),
      mono: MONO_KEYS.has(field.key),
      wide: field.key === 'notes' || field.key === 'address',
    };
    (ATTRIBUTION_KEYS.has(field.key) ? attribution : contact).push(row);
  }

  // Custom fields the agent has no setting for: the lead source sent them, so
  // the agent should see them rather than never knowing they exist.
  const configured = new Set(fields.map(f => f.key));
  const extra: CustomerRecordRow[] = Object.entries(data.customFields ?? {})
    .filter(([key]) => !configured.has(key))
    .map(([key, value]) => ({ label: humanize(key), value: displayValue(value) }));

  return [
    { id: 'lead-contact', title: 'Contact', icon: User, rows: contact },
    { id: 'lead-attribution', title: 'Lead', icon: Megaphone, rows: attribution },
    { id: 'lead-extra', title: 'Additional details', icon: ListPlus, rows: extra },
  ];
}

export function ScreenPop(props: ScreenPopProps): JSX.Element {
  const { screenPopFields } = usePhone();
  return <ScreenPopView {...props} fields={screenPopFields} />;
}

/**
 * The prospect card with its fields passed in, so /design-preview can render
 * it without a PhoneProvider.
 */
export function ScreenPopView({
  data,
  className,
  fields,
}: ScreenPopProps & { fields: ScreenPopField[] }): JSX.Element {
  return <CustomerRecord sections={prospectSections(data, fields)} className={className} />;
}

export default ScreenPop;
