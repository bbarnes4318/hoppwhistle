/**
 * Buyer (Ameriquote/Boberdoo) field vocabulary for the lead CSV importer.
 *
 * Kept out of the component on purpose: this is the contract with the buyer,
 * not presentation, and it is asserted against their spec files in
 * __tests__/buyer-template.test.ts.
 */

/**
 * Our internal field key -> the buyer's (Ameriquote/Boberdoo) field name.
 *
 * Mirrors the outbound mapping in `insurance-lead-mapper.ts`, which is built
 * from the buyer's own spec files (api-fe-fields.txt TYPE=19,
 * api-aca-fields.txt TYPE=31).
 *
 * This is the single source of truth for three things: the columns in the
 * downloadable template, the header spellings that auto-map, and the buyer
 * field shown beside each row in the mapping step. A CSV meant for the buyer
 * should be described in the buyer's vocabulary, not ours.
 */
export const BUYER_FIELD: Record<string, string> = {
  firstName: 'FirstName',
  lastName: 'LastName',
  phone: 'Primary_Phone',
  secondaryPhone: 'Secondary_Phone',
  email: 'Email',
  address: 'Address',
  address2: 'Address_2',
  city: 'City',
  county: 'County',
  state: 'State',
  zipCode: 'ZipCode',
  birthDate: 'Birth_Date',
  age: 'Age',
  gender: 'Gender',
  smoker: 'Smoker',
  ipAddress: 'IP_Address',
  landingPage: 'Landing_Page',
  trustedFormUrl: 'Trusted_Form_URL',
  leadidToken: 'leadid_token',
  consentLanguage: 'consent_language',
  datePosted: 'Origin_Lead_Date',
  recordingUrl: 'Recording_URL',
  source: 'SubSource',
  subId: 'Sub_ID',
  pubId: 'Pub_ID',
  heightFeet: 'Height_Feet',
  heightInches: 'Height_Inches',
  weight: 'Weight',
  householdIncome: 'Household_Income',
  peopleInHousehold: 'People_In_Household',
  subsidy: 'Subsidy',
  coverageType: 'Coverage_Type',
  faceAmount: 'Face_Amount',
  lifeType: 'Life_Type',
  riskType: 'Risk_Type',
  insuranceType: 'insurance_type',
  coverageAmount: 'coverage_amount',
  coverageYears: 'coverage_years',
  insuredTimeframe: 'insured_timeframe',
  term: 'term',
  monthlyPremium: 'monthly_premium',
  carrier: 'carrier',
  product: 'product',
};

/**
 * The template's columns, in the buyer's names, ordered required-first.
 *
 * Only what a lead vendor actually fills in. Everything omitted here is either
 * never posted, or posted from somewhere other than the CSV:
 *
 * - Internal CRM fields (beneficiaries, banking, SSN, medications) never reach
 *   the buyer at all.
 * - `Age` is derived from Birth_Date on ingest.
 * - `Landing_Page` and `SRC` come from config, the same for every lead.
 * - `SubSource` is filled from the import's lead-list name.
 * - `leadid_token`, `consent_language`, `Address_2`, `County` and `Smoker` are
 *   optional to the buyer and not in our files. All of them stay mappable in
 *   the import step for a vendor file that happens to carry them.
 */
export const BUYER_TEMPLATE_KEYS: Record<'ACA' | 'FE', string[]> = {
  // TYPE=19. Post Required: name, phone, email, address, city, state, zip,
  // Birth_Date, Gender, IP_Address.
  FE: [
    'firstName',
    'lastName',
    'phone',
    'email',
    'address',
    'city',
    'state',
    'zipCode',
    'birthDate',
    'gender',
    'ipAddress',
    'trustedFormUrl',
    'datePosted',
  ],
  // TYPE=31. Same, but height/weight are Post Required and Gender is optional.
  ACA: [
    'firstName',
    'lastName',
    'phone',
    'email',
    'address',
    'city',
    'state',
    'zipCode',
    'birthDate',
    'heightFeet',
    'heightInches',
    'weight',
    'ipAddress',
    'trustedFormUrl',
    'datePosted',
    'gender',
    'householdIncome',
    'peopleInHousehold',
  ],
};
