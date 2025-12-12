export type Vertical = 'ACA' | 'FINAL_EXPENSE' | 'MEDICARE';

export type FieldDef = {
  key: string;
  label: string;
  defaultChecked?: boolean;
};

export const VERTICALS: Array<{ key: Vertical; label: string; description: string }> = [
  { key: 'ACA', label: 'ACA Health', description: 'Enrollments, carrier, follow-ups, billable, transcript optional.' },
  { key: 'FINAL_EXPENSE', label: 'Final Expense', description: 'Apps, quotes, premium, carrier, follow-ups, billable, transcript optional.' },
  { key: 'MEDICARE', label: 'Medicare', description: 'Enrollments, carrier, follow-ups, billable, transcript optional.' },
];

export const FIELDS_BY_VERTICAL: Record<Vertical, FieldDef[]> = {
  FINAL_EXPENSE: [
    { key: 'Applications Submitted', label: 'Applications Submitted', defaultChecked: true },
    { key: 'Monthly Premium (if app submitted)', label: 'Monthly Premium (if app submitted)', defaultChecked: true },
    { key: 'Carrier (If app submitted)', label: 'Carrier (If app submitted)', defaultChecked: true },
    { key: 'Quotes', label: 'Quotes', defaultChecked: true },
    { key: 'Monthly Premium (If Quote Provided)', label: 'Monthly Premium (If Quote Provided)', defaultChecked: true },
    { key: 'Carrier (If Quote Provided)', label: 'Carrier (If Quote Provided)', defaultChecked: true },
    { key: 'Follow-Ups', label: 'Follow-Ups', defaultChecked: true },
    { key: 'Billable', label: 'Billable (Y/N)', defaultChecked: true },
    { key: 'Reason (If No)', label: 'Reason (If No)' },
    { key: 'Transcript', label: 'Transcript (Y/N)' },
  ],
  ACA: [
    { key: 'Enrollments', label: 'Enrollments', defaultChecked: true },
    { key: 'Carrier (If enrollment)', label: 'Carrier (If enrollment)', defaultChecked: true },
    { key: 'Follow-Ups', label: 'Follow-Ups', defaultChecked: true },
    { key: 'Billable', label: 'Billable (Y/N)', defaultChecked: true },
    { key: 'Reason (If No)', label: 'Reason (If No)' },
    { key: 'Transcript', label: 'Transcript (Y/N)' },
  ],
  MEDICARE: [
    { key: 'Enrollments', label: 'Enrollments', defaultChecked: true },
    { key: 'Carrier (If enrollment)', label: 'Carrier (If enrollment)', defaultChecked: true },
    { key: 'Follow-Ups', label: 'Follow-Ups', defaultChecked: true },
    { key: 'Billable', label: 'Billable (Y/N)', defaultChecked: true },
    { key: 'Reason (If No)', label: 'Reason (If No)' },
    { key: 'Transcript', label: 'Transcript (Y/N)' },
  ],
};

export type RecordingAnalysisItem = {
  id: string;
  batchId: string;
  vertical: Vertical;
  sourceType: 'url' | 'upload';
  sourceUrl?: string | null;
  storageKey?: string | null;
  filename?: string | null;
  selectedFields: any;
  status: string;
  transcript?: string | null;
  extracted?: any | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};
