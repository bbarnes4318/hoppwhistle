// US States for dropdown selectors
export const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
] as const;

export type USStateCode = (typeof US_STATES)[number]['value'];

// Carriers
export const CARRIERS = [
  { value: 'Americo', label: 'Americo' },
  { value: 'Baltimore Life', label: 'Baltimore Life' },
  { value: 'Mutual of Omaha', label: 'Mutual of Omaha' },
  { value: 'Securico', label: 'Securico' },
  { value: 'Sentinel Security Life', label: 'Sentinel Security Life' },
] as const;

// Policy Types
export const POLICY_TYPES = [
  { value: 'Level', label: 'Level' },
  { value: 'Graded', label: 'Graded' },
  { value: 'Modified', label: 'Modified' },
  { value: 'Guaranteed Issue', label: 'Guaranteed Issue' },
] as const;

// Relationships
export const RELATIONSHIPS = [
  { value: 'child', label: 'Child' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'parent', label: 'Parent' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'partner', label: 'Partner' },
  { value: 'relative', label: 'Relative' },
  { value: 'other', label: 'Other' },
] as const;

// SS Pay Days
export const SS_PAY_DAYS = [
  { value: '1st', label: '1st' },
  { value: '3rd', label: '3rd' },
  { value: '2nd Wednesday', label: '2nd Wednesday' },
  { value: '3rd Wednesday', label: '3rd Wednesday' },
  { value: '4th Wednesday', label: '4th Wednesday' },
] as const;

// Account Types
export const ACCOUNT_TYPES = [
  { value: 'Checking', label: 'Checking' },
  { value: 'Savings', label: 'Savings' },
] as const;

// Days 1-31 for pay day selection
export const PAY_DAYS = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1,
  label: `${i + 1}`,
}));

// Days 2-28 for future pay day selection
export const FUTURE_PAY_DAYS = Array.from({ length: 27 }, (_, i) => ({
  value: i + 2,
  label: `${i + 2}`,
}));
