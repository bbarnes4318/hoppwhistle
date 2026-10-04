/**
 * The on-call customer record. Agents used to see three fields and a
 * "Show N more" button under Hang up; the record now shows every field the
 * agent configured, plus whatever custom fields the lead source sent, with
 * nothing to click to reveal them.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { intakeSections } from '@/components/phone/CustomerDetailsPanel';
import type { ProspectData, ScreenPopField } from '@/components/phone/phone-provider';
import { prospectSections, ScreenPopView } from '@/components/phone/screen-pop';
import { CustomerRecord, visibleSections } from '@/components/phone/softphone/customer-record';
import { DEFAULT_INTAKE_DATA } from '@/types/customer-intake-types';

afterEach(cleanup);

const FIELDS: ScreenPopField[] = [
  { id: 'fullName', label: 'Full Name', key: 'fullName', enabled: true, order: 1 },
  { id: 'phoneNumber', label: 'Phone Number', key: 'phoneNumber', enabled: true, order: 2 },
  { id: 'email', label: 'Email', key: 'email', enabled: true, order: 3 },
  { id: 'company', label: 'Company', key: 'company', enabled: true, order: 4 },
  { id: 'address', label: 'Address', key: 'address', enabled: true, order: 5 },
  { id: 'city', label: 'City', key: 'city', enabled: true, order: 6 },
  { id: 'state', label: 'State', key: 'state', enabled: true, order: 7 },
  { id: 'leadSource', label: 'Lead Source', key: 'leadSource', enabled: true, order: 9 },
  { id: 'campaignName', label: 'Campaign', key: 'campaignName', enabled: true, order: 10 },
  { id: 'notes', label: 'Notes', key: 'notes', enabled: false, order: 11 },
];

const PROSPECT: ProspectData = {
  fullName: 'Maria Delgado',
  phoneNumber: '(813) 555-0142',
  email: 'maria@example.com',
  company: 'Delgado Bakery',
  address: '4120 W Bay Villa Ave',
  city: 'Tampa',
  state: 'FL',
  zipCode: '33611',
  leadSource: 'Facebook',
  campaignName: 'Final Expense',
  notes: 'A note the agent turned off',
  customFields: { coverageWanted: '$15,000', tobacco_use: false },
};

describe('ScreenPopView', () => {
  it('shows every configured field at once, with no "show more" to click', () => {
    render(<ScreenPopView data={PROSPECT} fields={FIELDS} />);

    for (const value of [
      'Maria Delgado',
      '(813) 555-0142',
      'maria@example.com',
      'Delgado Bakery',
      'Facebook',
      'Final Expense',
    ]) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(screen.queryByText(/show \d+ more/i)).toBeNull();
    expect(screen.queryByText(/view details/i)).toBeNull();
  });

  it('keeps a field the agent turned off hidden', () => {
    render(<ScreenPopView data={PROSPECT} fields={FIELDS} />);
    expect(screen.queryByText('A note the agent turned off')).toBeNull();
  });

  it('shows custom fields the lead source sent, labelled from their keys', () => {
    render(<ScreenPopView data={PROSPECT} fields={FIELDS} />);
    expect(screen.getByText('Coverage wanted')).toBeTruthy();
    expect(screen.getByText('$15,000')).toBeTruthy();
    expect(screen.getByText('Tobacco use')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
  });

  it('folds city, state and zip into the address row instead of repeating them', () => {
    const rows = visibleSections(prospectSections(PROSPECT, FIELDS)).flatMap(s => s.rows);
    const address = rows.find(r => r.label === 'Address');
    expect(address?.value).toBe('4120 W Bay Villa Ave\nTampa, FL 33611');
    expect(rows.some(r => r.label === 'City' || r.label === 'State')).toBe(false);
  });
});

describe('CustomerRecord', () => {
  it('drops a fact the lead and the intake form both carry', () => {
    const intake = {
      ...DEFAULT_INTAKE_DATA,
      firstName: 'Maria',
      lastName: 'Delgado',
      email: 'maria@example.com',
      carrier: 'Mutual of Omaha',
    } as typeof DEFAULT_INTAKE_DATA;
    const sections = [...prospectSections(PROSPECT, FIELDS), ...intakeSections(intake)];
    render(<CustomerRecord sections={sections} />);

    expect(screen.getAllByText('maria@example.com')).toHaveLength(1);
    expect(screen.getByText('Mutual of Omaha')).toBeTruthy();
  });

  it('does not invent a tobacco answer on an empty intake form', () => {
    const rows = visibleSections(intakeSections(DEFAULT_INTAKE_DATA)).flatMap(s => s.rows);
    expect(rows.find(r => r.label === 'Tobacco')).toBeUndefined();
  });

  it('says so when there is nothing on file', () => {
    render(<CustomerRecord sections={[]} />);
    expect(screen.getByText('No details on file for this caller')).toBeTruthy();
  });
});
