'use client';

import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Download,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import { apiClient, type ApiResponse } from '@/lib/api';

import { BUYER_FIELD, BUYER_TEMPLATE_KEYS } from './buyer-fields';
import { parseCSV } from './parse-csv';


interface CsvImportDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

/** Rows per import request — small enough that a 1,000-lead file can't time out. */
const IMPORT_BATCH_SIZE = 100;

interface ImportResultDetail {
  success: boolean;
  name: string;
  phone: string;
  /** Set for every lead the import stored — this is what scopes the send. */
  submissionId?: string | null;
  errors: Array<{ path: string; message: string }> | null;
}

interface ImportResult {
  total: number;
  successCount: number;
  failCount: number;
  details: ImportResultDetail[];
}

interface TargetField {
  key: string;
  label: string;
  required: boolean;
  vertical?: 'ACA' | 'FE' | 'B2B';
  description: string;
  /**
   * Extra header spellings to auto-map. Vendors ship "DOB", "Zip", and
   * "Date_Posted" far more often than they ship our camelCase field names.
   * The buyer's own field name is added automatically — see BUYER_FIELD.
   */
  aliases?: string[];
}

const TARGET_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: false, description: 'First name of prospect' },
  { key: 'lastName', label: 'Last Name', required: false, description: 'Last name of prospect' },
  { key: 'phone', label: 'Phone Number', required: true, description: '10-digit phone number' },
  {
    key: 'email',
    label: 'Email Address',
    required: false,
    description: 'Email address of prospect',
  },
  { key: 'address', label: 'Street Address', required: false, description: 'Home street address' },
  { key: 'city', label: 'City', required: false, description: 'City name' },
  { key: 'state', label: 'State', required: false, description: '2-letter state code' },
  {
    key: 'zipCode',
    label: 'Zip Code',
    required: false,
    description: '5-digit zip code',
    aliases: ['zip', 'postalCode'],
  },
  {
    key: 'birthDate',
    label: 'Birth Date',
    required: false,
    description: 'Birthdate (MM/DD/YYYY or YYYY-MM-DD)',
    aliases: ['dob', 'dateOfBirth'],
  },

  // Compliance & provenance — the buyer requires IP_Address on every post,
  // and TrustedForm is the consent proof that survives a TCPA complaint.
  {
    key: 'ipAddress',
    label: 'IP Address',
    required: false,
    description: 'Consumer IP captured at opt-in — required by the buyer on every post',
  },
  {
    key: 'trustedFormUrl',
    label: 'TrustedForm URL',
    required: false,
    description: 'TrustedForm certificate URL',
    aliases: ['trustedFormCertUrl', 'trustedForm'],
  },
  {
    key: 'leadidToken',
    label: 'LeadiD Token',
    required: false,
    description: 'Jornaya LeadiD token',
    aliases: ['leadId', 'jornayaLeadId'],
  },
  {
    key: 'consentLanguage',
    label: 'Consent Language',
    required: false,
    description: 'Exact TCPA consent text the consumer agreed to',
  },
  {
    key: 'datePosted',
    label: 'Date Posted',
    required: false,
    description: 'Date the lead was originally generated — sent as Origin_Lead_Date',
    aliases: ['originLeadDate', 'leadDate', 'entryDate'],
  },
  {
    key: 'landingPage',
    label: 'Landing Page',
    required: false,
    description: 'Site where the consumer actually completed the lead form',
    aliases: ['originalLandingPage', 'landingPageUrl', 'originalLandingPageUrl', 'sourceUrl'],
  },

  // Common Optional
  { key: 'notes', label: 'Notes', required: false, description: 'Internal callback notes/history' },
  { key: 'priority', label: 'Priority', required: false, description: 'LOW, NORMAL, HIGH, URGENT' },
  { key: 'source', label: 'Source', required: false, description: 'Lead source identifier' },
  {
    key: 'leadStage',
    label: 'Lead Stage',
    required: false,
    description: 'NEW, CONTACTED, PROPOSAL, etc.',
  },
  {
    key: 'nextFollowUpAt',
    label: 'Next Follow Up',
    required: false,
    description: 'Date/time for next follow-up',
  },
  {
    key: 'requestedEffectiveDate',
    label: 'Requested Effective Date',
    required: false,
    description: 'Requested effective date',
  },
  { key: 'ssn', label: 'SSN', required: false, description: 'Social Security Number' },
  {
    key: 'primaryBeneficiaryName',
    label: 'Primary Beneficiary Name',
    required: false,
    description: 'Primary beneficiary name',
  },
  {
    key: 'primaryBeneficiaryRelationship',
    label: 'Primary Beneficiary Relationship',
    required: false,
    description: 'Primary beneficiary relationship',
  },
  {
    key: 'primaryBeneficiaryShare',
    label: 'Primary Beneficiary Share %',
    required: false,
    description: 'Primary beneficiary share percentage',
  },
  {
    key: 'secondPrimaryBeneficiaryName',
    label: 'Second Primary Beneficiary Name',
    required: false,
    description: 'Second primary beneficiary name',
  },
  {
    key: 'secondPrimaryBeneficiaryRelationship',
    label: 'Second Primary Beneficiary Relationship',
    required: false,
    description: 'Second primary beneficiary relationship',
  },
  {
    key: 'currentPolicyInForce',
    label: 'Current Policy In Force',
    required: false,
    description: 'Is current policy in force',
  },
  {
    key: 'replacementReductionModification',
    label: 'Replacement/Reduction/Modification',
    required: false,
    description: 'Replacement/reduction/modification details',
  },
  {
    key: 'replacementCompanyName',
    label: 'Replacement Company Name',
    required: false,
    description: 'Replacement insurance company name',
  },
  {
    key: 'replacementFaceAmount',
    label: 'Replacement Face Amount',
    required: false,
    description: 'Replacement policy face amount',
  },
  { key: 'bankName', label: 'Bank Name', required: false, description: 'Bank name for payment' },
  {
    key: 'accountType',
    label: 'Account Type',
    required: false,
    description: 'Checking or Savings',
  },
  {
    key: 'routingNumber',
    label: 'Routing Number',
    required: false,
    description: '9-digit bank routing number',
  },
  {
    key: 'accountNumber',
    label: 'Account Number',
    required: false,
    description: 'Bank account number',
  },
  { key: 'agentName', label: 'Agent Name', required: false, description: 'Writing agent name' },

  // ACA Specific
  {
    key: 'heightFeet',
    label: 'Height (Feet)',
    required: false,
    vertical: 'ACA',
    description: 'Height in feet (e.g. 5)',
  },
  {
    key: 'heightInches',
    label: 'Height (Inches)',
    required: false,
    vertical: 'ACA',
    description: 'Height in inches (0-11)',
  },
  {
    key: 'weight',
    label: 'Weight (lbs)',
    required: false,
    vertical: 'ACA',
    description: 'Weight in pounds',
  },
  {
    key: 'smoker',
    label: 'Smoker',
    required: false,
    vertical: 'ACA',
    description: 'Tobacco use (Yes/No)',
  },
  {
    key: 'householdIncome',
    label: 'Household Income',
    required: false,
    vertical: 'ACA',
    description: 'Yearly income',
  },
  {
    key: 'peopleInHousehold',
    label: 'Household Size',
    required: false,
    vertical: 'ACA',
    description: 'Total household members',
  },

  // FE Specific
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    vertical: 'FE',
    description: 'Male, Female, or Non-binary',
  },
  {
    key: 'smoker',
    label: 'Smoker',
    required: false,
    vertical: 'FE',
    description: 'Tobacco use (Yes/No)',
  },
  {
    key: 'carrier',
    label: 'Quoted Carrier',
    required: false,
    vertical: 'FE',
    description: 'Quoted carrier name',
  },
  {
    key: 'product',
    label: 'Quoted Product',
    required: false,
    vertical: 'FE',
    description: 'Quoted product name',
  },
  {
    key: 'monthlyPremium',
    label: 'Monthly Premium',
    required: false,
    vertical: 'FE',
    description: 'Quoted premium',
  },
  {
    key: 'coverageAmount',
    label: 'Coverage Amount',
    required: false,
    vertical: 'FE',
    description: 'Quoted face/coverage amount',
  },
  {
    key: 'height',
    label: 'Height',
    required: false,
    vertical: 'FE',
    description: 'Prospect height (e.g., 5-10)',
  },
  {
    key: 'weight',
    label: 'Weight',
    required: false,
    vertical: 'FE',
    description: 'Prospect weight in lbs',
  },
  {
    key: 'burialCremation',
    label: 'Burial or Cremation',
    required: false,
    vertical: 'FE',
    description: 'Burial/Cremation preference',
  },
  {
    key: 'firstPremiumDate',
    label: 'First Premium Date',
    required: false,
    vertical: 'FE',
    description: 'First premium date (YYYY-MM-DD)',
  },
  {
    key: 'monthlyRecurringDueDate',
    label: 'Monthly Recurring Due Date',
    required: false,
    vertical: 'FE',
    description: 'Recurring due date (e.g. 3rd)',
  },
  {
    key: 'driversLicense',
    label: 'Drivers License',
    required: false,
    vertical: 'FE',
    description: 'Drivers license number',
  },
  {
    key: 'health',
    label: 'Health',
    required: false,
    vertical: 'FE',
    description: 'Health conditions / notes',
  },
  {
    key: 'medications',
    label: 'Medications',
    required: false,
    vertical: 'FE',
    description: 'List of medications',
  },
  {
    key: 'doctorName',
    label: 'Doctor Name',
    required: false,
    vertical: 'FE',
    description: 'Primary doctor name',
  },
  {
    key: 'age',
    label: 'Age',
    required: false,
    vertical: 'FE',
    description: 'Prospect age',
  },
  {
    key: 'aflacMonthlyQuote',
    label: 'Aflac Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Aflac Monthly Quote',
  },
  {
    key: 'aflacModifiedMonthlyQuote',
    label: 'Aflac-Modified Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Aflac-Modified Monthly Quote',
  },
  {
    key: 'sbliMonthlyQuote',
    label: 'SBLI Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'SBLI Monthly Quote',
  },
  {
    key: 'sbliModifiedMonthlyQuote',
    label: 'SBLI-Modified Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'SBLI-Modified Monthly Quote',
  },
  {
    key: 'cicaMonthlyQuote',
    label: 'CICA Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'CICA Monthly Quote',
  },
  {
    key: 'cicaGiMonthlyQuote',
    label: 'CICA-GI Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'CICA-GI Monthly Quote',
  },
  {
    key: 'gtlMonthlyQuote',
    label: 'GTL Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'GTL Monthly Quote',
  },
  {
    key: 'transamericaMonthlyQuote',
    label: 'TransAmerica Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'TransAmerica Monthly Quote',
  },
  {
    key: 'transamericaGradedMonthlyQuote',
    label: 'TransAmerica Graded Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'TransAmerica Graded Monthly Quote',
  },
  {
    key: 'corebridgeMonthlyQuote',
    label: 'Corebridge Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Corebridge Monthly Quote',
  },
  {
    key: 'amamMonthlyQuote',
    label: 'AmAm Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'AmAm Monthly Quote',
  },
  {
    key: 'amamGradedMonthlyQuote',
    label: 'AmAm-Graded Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'AmAm-Graded Monthly Quote',
  },
  {
    key: 'amamReturnOrPremiumMonthlyQuote',
    label: 'AmAm-Return or Premium Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'AmAm-Return or Premium Monthly Quote',
  },
  {
    key: 'ahlMonthlyQuote',
    label: 'AHL Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'AHL Monthly Quote',
  },
  {
    key: 'ahlGradedMonthlyQuote',
    label: 'AHL-Graded Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'AHL-Graded Monthly Quote',
  },
  {
    key: 'royalNeighborsMonthlyQuote',
    label: 'Royal Neighbors Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Royal Neighbors Monthly Quote',
  },
  {
    key: 'royalNeighborsGradedMonthlyQuote',
    label: 'Royal Neighbors-Graded Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Royal Neighbors-Graded Monthly Quote',
  },
  {
    key: 'gerberGiMonthlyQuote',
    label: 'Gerber-GI Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Gerber-GI Monthly Quote',
  },
  {
    key: 'mutualOfOmahaMonthlyQuote',
    label: 'Mutual of Omaha Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Mutual of Omaha Monthly Quote',
  },
  {
    key: 'mutualOfOmahaGradedMonthlyQuote',
    label: 'Mutual of Omaha-Graded Monthly Quote',
    required: false,
    vertical: 'FE',
    description: 'Mutual of Omaha-Graded Monthly Quote',
  },
  {
    key: 'amamQuote',
    label: 'AmAm Quote',
    required: false,
    vertical: 'FE',
    description: 'AmAm Quote',
  },
  {
    key: 'amamLessThanCurrent',
    label: 'AmAm Less Than Current',
    required: false,
    vertical: 'FE',
    description: 'AmAm Less Than Current',
  },
  {
    key: 'gtlQuote',
    label: 'GTL Quote',
    required: false,
    vertical: 'FE',
    description: 'GTL Quote',
  },
  {
    key: 'gtlLessThanCurrent',
    label: 'GTL Less Than Current',
    required: false,
    vertical: 'FE',
    description: 'GTL Less Than Current',
  },
  {
    key: 'cheapestCarrierUnderCurrent',
    label: 'Cheapest Carrier Under Current',
    required: false,
    vertical: 'FE',
    description: 'Cheapest Carrier Under Current',
  },
  {
    key: 'savingsVsCurrent',
    label: 'Savings vs Current',
    required: false,
    vertical: 'FE',
    description: 'Savings vs Current',
  },
  {
    key: 'company',
    label: 'Company',
    required: false,
    vertical: 'B2B',
    description: 'Company name',
  },
  {
    key: 'repName',
    label: 'Rep Name',
    required: false,
    vertical: 'B2B',
    description: 'Representative name',
  },
  {
    key: 'industry',
    label: 'Industry',
    required: false,
    vertical: 'B2B',
    description: 'Industry type',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    required: false,
    vertical: 'B2B',
    description: 'Annual revenue',
  },
  {
    key: 'yearEstablished',
    label: 'Year Established',
    required: false,
    vertical: 'B2B',
    description: 'Year established',
  },
];

export function CsvImportDialog({ onClose, onSuccess }: CsvImportDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [leadLists, setLeadLists] = useState<any[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [newListName, setNewListName] = useState<string>('');
  const [isCreateNewList, setIsCreateNewList] = useState<boolean>(true);

  useEffect(() => {
    const loadLists = async () => {
      try {
        const response = await apiClient.get<any[]>('/api/v1/lead-lists');
        if (!response.error && response.data) {
          setLeadLists(response.data);
          if (response.data.length > 0) {
            setSelectedListId(response.data[0].id);
            setIsCreateNewList(false);
          }
        }
      } catch (err) {
        console.error('Failed to load lead lists:', err);
      }
    };
    void loadLists();
  }, []);

  const [vertical, setVertical] = useState<'ACA' | 'FE' | 'B2B'>('ACA');
  const [fileName, setFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // TargetKey -> CSV Header Index (string representation)
  const [importing, setImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [importedListId, setImportedListId] = useState<string | null>(null);
  /**
   * The submissions this import created — not the list they went into.
   *
   * Scoping the send by listId instead swept up every held lead already in the
   * list: importing 17 into a list holding 57 offered to send 74, and pressing
   * the button would have posted all of them. A post is spent whether or not
   * the lead sells, so those 57 would have burned their 90-day duplicate window
   * for nothing.
   */
  const [importedSubmissionIds, setImportedSubmissionIds] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTargetFields = TARGET_FIELDS.filter(f => {
    if (vertical === 'B2B') {
      const b2bFields = [
        'company',
        'repName',
        'phone',
        'email',
        'city',
        'state',
        'industry',
        'revenue',
        'yearEstablished',
      ];
      return b2bFields.includes(f.key) && (f.vertical === 'B2B' || !f.vertical);
    }
    if (f.vertical === 'B2B') return false;
    return !f.vertical || f.vertical === vertical;
  });

  // Fields the buyer actually receives lead the list. The internal-CRM extras
  // still appear below — they are stored, just never posted — but they should
  // not be the first thing you scroll past when preparing a batch to sell.
  const orderedTargetFields =
    vertical === 'B2B'
      ? activeTargetFields
      : [
          ...activeTargetFields.filter(f => BUYER_FIELD[f.key]),
          ...activeTargetFields.filter(f => !BUYER_FIELD[f.key]),
        ];

  const buyerFieldCount = orderedTargetFields.filter(f => BUYER_FIELD[f.key]).length;

  // Preview only the columns actually mapped — a table of 40 unmapped dashes
  // hides the handful of values worth checking before committing the batch.
  const previewFields = orderedTargetFields.filter(f => mappings[f.key] !== undefined);

  /**
   * Template Download.
   *
   * For ACA and FE the columns are the buyer's field names, because the file is
   * going to the buyer. Internal CRM fields (beneficiaries, banking, health
   * notes) are not in it — they are never posted, and asking a lead vendor to
   * fill in a routing number is not something this template should do.
   *
   * B2B has no buyer mapping, so it keeps our own field names.
   */
  const downloadTemplate = () => {
    const b2bHeaders = [
      'company',
      'repName',
      'phone',
      'email',
      'city',
      'state',
      'industry',
      'revenue',
      'yearEstablished',
    ];

    // Sample values keyed by our field key, so a header rename can never leave
    // the example row misaligned with its columns.
    const sample: Record<string, string> = {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '3125556085',
      email: 'jane.doe@example.com',
      address: '123 Main St',
      address2: 'Apt 4B',
      city: 'Chicago',
      county: 'Cook',
      state: 'IL',
      zipCode: '60610',
      birthDate: '09/16/1980',
      gender: 'Female',
      smoker: 'No',
      ipAddress: '75.2.92.149',
      landingPage: 'agents.netenroll.com',
      trustedFormUrl: 'https://cert.trustedform.com/example',
      leadidToken: '',
      consentLanguage: 'By clicking Submit you agree to be contacted.',
      datePosted: '07/14/2026 09:12:00',
      source: 'Facebook',
      heightFeet: '5',
      heightInches: '10',
      weight: '175',
      householdIncome: '45000',
      peopleInHousehold: '2',
      company: 'Acme Corp',
      repName: 'John Smith',
      industry: 'Software',
      revenue: '10000000',
      yearEstablished: '1995',
    };

    const keys = vertical === 'B2B' ? b2bHeaders : BUYER_TEMPLATE_KEYS[vertical];
    const hdrs = keys.map(key => (vertical === 'B2B' ? key : BUYER_FIELD[key] || key));

    const csvContent = hdrs.join(',') + '\n' + keys.map(key => sample[key] ?? '').join(',');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const name =
      vertical === 'B2B'
        ? 'b2b_import_template.csv'
        : `ameriquote_${vertical.toLowerCase()}_lead_template.csv`;
    link.setAttribute('download', name);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Drag and Drop / Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      if (text) {
        const rows = parseCSV(text);
        if (rows.length > 0) {
          const csvHeaders = rows[0];
          setHeaders(csvHeaders);
          setParsedRows(rows.slice(1));

          // Auto-mapping logic based on name matches
          const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const initialMappings: Record<string, string> = {};
          activeTargetFields.forEach(target => {
            const buyerName = BUYER_FIELD[target.key];
            const candidates = new Set([
              clean(target.key),
              clean(target.label),
              // A file built from our template — or handed over by the buyer —
              // uses their column names, so those must map with no clicks.
              ...(buyerName ? [clean(buyerName)] : []),
              ...(target.aliases || []).map(clean),
            ]);

            const matchIndex = csvHeaders.findIndex(h => candidates.has(clean(h)));

            if (matchIndex !== -1) {
              initialMappings[target.key] = String(matchIndex);
            }
          });
          setMappings(initialMappings);
          setStep(2);
        }
      }
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isCreateNewList && (!newListName || !newListName.trim())) {
      alert('Please enter a name for the new lead list first.');
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.csv')) {
      processFile(file);
    }
  };

  // Mapping Handlers
  const handleMapField = (targetKey: string, headerIndexStr: string) => {
    setMappings(prev => {
      const copy = { ...prev };
      if (headerIndexStr === '') {
        delete copy[targetKey];
      } else {
        copy[targetKey] = headerIndexStr;
      }
      return copy;
    });
  };

  const proceedToPreview = () => {
    // Check if required fields are mapped
    const missingRequired = activeTargetFields
      .filter(f => f.required)
      .filter(f => mappings[f.key] === undefined);

    if (missingRequired.length > 0) {
      alert(`Please map all required fields: ${missingRequired.map(f => f.label).join(', ')}`);
      return;
    }
    setStep(3);
  };

  // Ingest mapped JSON payload
  const runImport = async () => {
    setImporting(true);

    // Map CSV rows to JSON payloads
    const payloadLeads = parsedRows.map(row => {
      const lead: Record<string, unknown> = {};

      // Map explicit columns
      activeTargetFields.forEach(field => {
        const indexStr = mappings[field.key];
        if (indexStr !== undefined) {
          const idx = parseInt(indexStr);
          const rawVal = row[idx];
          if (rawVal !== undefined && rawVal !== '') {
            // Apply light type casting if numeric
            if (
              field.key === 'heightFeet' ||
              field.key === 'heightInches' ||
              field.key === 'peopleInHousehold'
            ) {
              const numVal = parseInt(rawVal);
              lead[field.key] = isNaN(numVal) ? rawVal : numVal;
            } else if (
              field.key === 'householdIncome' ||
              field.key === 'monthlyPremium' ||
              field.key === 'coverageAmount' ||
              field.key === 'faceAmount'
            ) {
              const numVal = parseFloat(rawVal);
              lead[field.key] = isNaN(numVal) ? rawVal : numVal;
            } else {
              lead[field.key] = rawVal;
            }
          }
        }
      });

      return lead;
    });

    if (isCreateNewList && (!newListName || !newListName.trim())) {
      alert('Please enter a name for the new lead list.');
      setImporting(false);
      return;
    }

    try {
      // The API ingests each lead with several round trips, so a thousand-row
      // file in one request times out. Send it in chunks and stitch the
      // per-batch summaries back into one result.
      const batches: Array<Record<string, unknown>[]> = [];
      for (let i = 0; i < payloadLeads.length; i += IMPORT_BATCH_SIZE) {
        batches.push(payloadLeads.slice(i, i + IMPORT_BATCH_SIZE));
      }

      const combined = {
        total: 0,
        successCount: 0,
        failCount: 0,
        details: [] as ImportResultDetail[],
      };
      // The first batch resolves (or creates) the list; later batches pin to
      // its id so a retried name lookup can't fan out into duplicate lists.
      let resolvedListId = isCreateNewList ? undefined : selectedListId || undefined;

      for (const [index, batch] of batches.entries()) {
        setImportProgress({ done: index * IMPORT_BATCH_SIZE, total: payloadLeads.length });

        const response = await apiClient.post('/api/v1/insurance-leads/import', {
          vertical,
          leads: batch,
          listId: resolvedListId,
          listName: resolvedListId ? undefined : newListName,
        });

        if (response.error) {
          throw new Error(response.error.message || 'Import API request failed');
        }

        const data = response.data as any;
        resolvedListId = data.listId || resolvedListId;
        combined.total += data.total ?? batch.length;
        combined.successCount += data.successCount ?? 0;
        combined.failCount += data.failCount ?? 0;
        combined.details.push(...((data.details ?? []) as ImportResultDetail[]));
      }

      setImportProgress({ done: payloadLeads.length, total: payloadLeads.length });
      setImportedListId(resolvedListId ?? null);
      setImportedSubmissionIds(
        combined.details
          .map(d => d.submissionId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      );
      setImportResult(combined);
      setStep(4);
    } catch (err: any) {
      alert(err.message || 'Import API request failed');
    } finally {
      setImporting(false);
    }
  };

  const getMappedValue = (row: string[], targetKey: string): string => {
    const idxStr = mappings[targetKey];
    if (idxStr === undefined) return '—';
    const idx = parseInt(idxStr);
    return row[idx] || '—';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col rounded-card border border-rule bg-surface text-ink shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rule bg-sunken px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-brand-tint p-2 text-brand-ink">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Import CRM Prospects</h2>
              <p className="text-xs text-ink-2">
                Upload, map columns, and ingest prospects in bulk
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-sunken text-ink-3 hover:text-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Steps Bar */}
        <div className="flex items-center justify-between border-b border-rule bg-sunken px-8 py-3 text-xs font-medium text-ink-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 1 ? 'bg-brand-tint text-brand-ink border border-brand' : 'bg-sunken text-ink-3 border border-rule'}`}
            >
              1
            </span>
            <span className={step >= 1 ? 'text-ink-2' : ''}>Setup</span>
          </div>
          <div className="h-px w-12 bg-rule" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 2 ? 'bg-brand-tint text-brand-ink border border-brand' : 'bg-sunken text-ink-3 border border-rule'}`}
            >
              2
            </span>
            <span className={step >= 2 ? 'text-ink-2' : ''}>Column Mapping</span>
          </div>
          <div className="h-px w-12 bg-rule" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 3 ? 'bg-brand-tint text-brand-ink border border-brand' : 'bg-sunken text-ink-3 border border-rule'}`}
            >
              3
            </span>
            <span className={step >= 3 ? 'text-ink-2' : ''}>Preview</span>
          </div>
          <div className="h-px w-12 bg-rule" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 4 ? 'bg-brand-tint text-brand-ink border border-brand' : 'bg-sunken text-ink-3 border border-rule'}`}
            >
              4
            </span>
            <span className={step >= 4 ? 'text-ink-2' : ''}>Results</span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: SETUP */}
          {step === 1 && (
            <div className="space-y-6 max-w-xl mx-auto py-8">
              {/* Vertical Select */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Target Vertical
                </label>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    {
                      value: 'ACA',
                      label: 'ACA (Affordable Care Act)',
                      desc: 'Requires height/weight validation',
                    },
                    {
                      value: 'FE',
                      label: 'FE Customers',
                      desc: 'Requires gender validation',
                    },
                    {
                      value: 'B2B',
                      label: 'B2B',
                      desc: 'Requires phone field only',
                    },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setVertical(opt.value as any)}
                      className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${vertical === opt.value ? 'bg-brand-tint border-brand text-ink' : 'bg-surface border-rule text-ink-3 hover:border-rule-strong'}`}
                    >
                      <span className="font-semibold text-sm">{opt.label}</span>
                      <span className="text-[11px] text-ink-2 mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Download Option */}
              <div className="flex items-center justify-between rounded-lg border border-rule bg-sunken p-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-brand-ink mt-0.5" />
                  <div>
                    <h3 className="text-sm font-medium">
                      {vertical === 'B2B' ? 'Download Import Template' : 'Download Buyer Template'}
                    </h3>
                    <p className="text-xs text-ink-2 mt-0.5">
                      {vertical === 'B2B'
                        ? 'Pre-formatted CSV template for B2B prospects'
                        : `Columns are Ameriquote's ${vertical} (TYPE=${vertical === 'FE' ? '19' : '31'}) field names — send this to your lead vendor`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 rounded-md border border-rule bg-surface px-3 py-1.5 text-xs hover:bg-sunken transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV
                </button>
              </div>

              {/* Lead List Selection */}
              <div className="space-y-3 rounded-lg border border-rule bg-sunken p-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Target Lead List
                </label>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setIsCreateNewList(true)}
                    className={`flex-1 py-1.5 px-3 rounded border text-xs font-mono transition-colors ${isCreateNewList ? 'bg-brand-tint border-brand text-ink' : 'bg-surface border-rule text-ink-3'}`}
                  >
                    + CREATE NEW LIST
                  </button>
                  {leadLists.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCreateNewList(false)}
                      className={`flex-1 py-1.5 px-3 rounded border text-xs font-mono transition-colors ${!isCreateNewList ? 'bg-brand-tint border-brand text-ink' : 'bg-surface border-rule text-ink-3'}`}
                    >
                      SELECT EXISTING LIST
                    </button>
                  )}
                </div>

                {isCreateNewList ? (
                  <div className="space-y-1.5 mt-2">
                    <input
                      type="text"
                      placeholder="e.g. June 2026 Outbound Leads"
                      value={newListName}
                      onChange={e => setNewListName(e.target.value)}
                      className="w-full bg-surface border border-rule rounded px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand-ink"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    <select
                      value={selectedListId}
                      onChange={e => setSelectedListId(e.target.value)}
                      className="w-full bg-surface border border-rule rounded px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand-ink cursor-pointer"
                    >
                      {leadLists.map((list: any) => (
                        <option key={list.id} value={list.id}>
                          {list.name} ({list.vertical})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* File Dropzone */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Upload Prospect File
                </label>
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => {
                    if (isCreateNewList && (!newListName || !newListName.trim())) {
                      alert('Please enter a name for the new lead list first.');
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  className="flex flex-col items-center justify-center border-2 border-dashed border-rule bg-sunken rounded-card py-12 px-6 cursor-pointer hover:border-brand hover:bg-sunken transition-all"
                >
                  <div className="rounded-full bg-surface p-3 border border-rule mb-3">
                    <Upload className="h-6 w-6 text-ink-3" />
                  </div>
                  <span className="text-sm font-medium text-ink-2">
                    Drag and drop your CSV file here
                  </span>
                  <span className="text-xs text-ink-2 mt-1">
                    or click to browse from your computer
                  </span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".csv"
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MAPPING */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-rule pb-3">
                <div>
                  <span className="text-xs font-medium text-ink-3">Map your CSV columns</span>
                  {vertical !== 'B2B' && (
                    <span className="mt-0.5 block text-[10px] text-ink-3">
                      The first {buyerFieldCount} are posted to the buyer — the blue tag is the
                      field name they receive. Fields below those are stored in the CRM only.
                    </span>
                  )}
                </div>
                <span className="text-[11px] bg-surface border border-rule text-ink-3 px-2 py-0.5 rounded">
                  File: {fileName} · Rows: {parsedRows.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {orderedTargetFields.map(field => {
                  const mappedIdx = mappings[field.key];
                  const isMapped = mappedIdx !== undefined;

                  return (
                    <div
                      key={field.key}
                      className={`flex flex-col justify-between p-3 rounded-lg border transition-colors ${isMapped ? 'bg-sunken border-brand/40' : 'bg-surface border-rule'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-ink">{field.label}</span>
                            {field.required && (
                              <span className="text-[9px] font-bold text-dropped-ink uppercase tracking-widest bg-dropped-tint px-1 rounded">
                                Required
                              </span>
                            )}
                            {BUYER_FIELD[field.key] && (
                              <span
                                className="text-[9px] font-mono text-money-ink bg-money-tint px-1 rounded"
                                title="Field name the buyer receives"
                              >
                                → {BUYER_FIELD[field.key]}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-ink-3 block mt-0.5">
                            {field.description}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <select
                          value={mappedIdx ?? ''}
                          onChange={e => handleMapField(field.key, e.target.value)}
                          className="w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand-ink"
                        >
                          <option value="">-- Do Not Map --</option>
                          {headers.map((hdr, idx) => (
                            <option key={idx} value={String(idx)}>
                              {hdr} (col {idx + 1})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg bg-brand-tint p-4 text-xs text-brand-ink flex items-start gap-2.5">
                <AlertCircle className="h-4.5 w-4.5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Review your column mapping preview</p>
                  <p className="text-ink-2 mt-0.5">
                    Please check the mapped preview of the first 3 rows. If it looks correct, click
                    Import prospects to start bulk ingestion.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-rule bg-sunken overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-ink-2">
                    <thead>
                      <tr className="border-b border-rule bg-sunken font-semibold uppercase text-ink-3">
                        <th className="px-4 py-2.5 text-left">Record</th>
                        {previewFields.map(f => (
                          <th key={f.key} className="px-4 py-2.5 text-left">
                            {BUYER_FIELD[f.key] || f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {parsedRows.slice(0, 3).map((row, idx) => (
                        <tr key={idx} className="hover:bg-sunken">
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-ink-3">
                            Row {idx + 2}
                          </td>
                          {previewFields.map(f => (
                            <td key={f.key} className="px-4 py-3 whitespace-nowrap">
                              {getMappedValue(row, f.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: IMPORT RESULTS */}
          {step === 4 && importResult && (
            <div className="space-y-6 max-w-xl mx-auto py-4">
              {/* Summary card */}
              <div className="rounded-card border border-rule bg-sunken p-6 flex flex-col items-center text-center">
                <div className="rounded-full bg-live-tint p-4 text-live-ink mb-4 animate-bounce">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="text-base font-semibold text-ink">Import Complete</h3>
                <p className="text-xs text-ink-2 mt-1">
                  Processed {importResult.total} prospect rows in this batch
                </p>

                <div className="grid grid-cols-2 gap-8 w-full max-w-xs mt-6 border-t border-rule pt-6">
                  <div>
                    <span className="text-2xl font-bold text-live-ink">
                      {importResult.successCount}
                    </span>
                    <span className="block text-[10px] font-semibold text-ink-3 uppercase mt-0.5">
                      Valid Ingested
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-ink-3">{importResult.failCount}</span>
                    <span className="block text-[10px] font-semibold text-ink-3 uppercase mt-0.5">
                      Invalid (Needs Edit)
                    </span>
                  </div>
                </div>
              </div>

              {/* Errors log if failCount > 0 */}
              {importResult.failCount > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-3 uppercase tracking-wider">
                    <AlertCircle className="h-4 w-4 text-ringing-ink" />
                    <span>Validation Warnings ({importResult.failCount})</span>
                  </div>
                  <div className="rounded-lg border border-rule bg-sunken p-1 divide-y divide-rule max-h-40 overflow-y-auto">
                    {importResult.details
                      .filter(d => !d.success)
                      .map((det, idx) => (
                        <div key={idx} className="p-2.5 text-xs">
                          <div className="flex items-center justify-between font-medium">
                            <span className="text-ink-2">{det.name || 'Unnamed Prospect'}</span>
                            <span className="text-[10px] text-ink-3 font-mono">{det.phone}</span>
                          </div>
                          <ul className="mt-1 list-disc pl-4 text-[10px] text-dropped-ink space-y-0.5">
                            {det.errors?.map((err, eIdx) => (
                              <li key={eIdx}>
                                {err.path ? `"${err.path}": ` : ''}
                                {err.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {importedListId && vertical !== 'B2B' && (
                <BuyerDeliveryPanel submissionIds={importedSubmissionIds} vertical={vertical} />
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-rule bg-sunken px-6 py-4">
          <div>
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="rounded-md border border-rule bg-surface px-4 py-2 text-xs font-medium text-ink-3 hover:bg-sunken hover:text-ink transition-colors"
              >
                Back to Setup
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => setStep(2)}
                className="rounded-md border border-rule bg-surface px-4 py-2 text-xs font-medium text-ink-3 hover:bg-sunken hover:text-ink transition-colors"
              >
                Back to Mapping
              </button>
            )}
          </div>

          <div>
            {step === 1 && (
              <button
                disabled={!fileName}
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 rounded-md bg-brand hover:bg-brand-ink px-5 py-2 text-xs font-medium text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continue to Mapping
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 2 && (
              <button
                onClick={proceedToPreview}
                className="flex items-center gap-1.5 rounded-md bg-brand hover:bg-brand-ink px-5 py-2 text-xs font-medium text-ink transition-colors"
              >
                Continue to Preview
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 3 && (
              <button
                disabled={importing}
                onClick={() => void runImport()}
                className="flex items-center gap-1.5 rounded-md bg-brand hover:bg-brand-ink px-5 py-2 text-xs font-medium text-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {importProgress
                      ? `Ingesting ${importProgress.done}/${importProgress.total}...`
                      : 'Ingesting Prospects...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Import prospects ({parsedRows.length})
                  </>
                )}
              </button>
            )}
            {step === 4 && (
              <button
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                className="rounded-md bg-brand hover:bg-brand-ink px-5 py-2 text-xs font-medium text-ink transition-colors"
              >
                Finish & Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buyer delivery
//
// Importing a lead never posts it — ingest parks every valid submission on
// HOLD on purpose. This panel is the explicit release: preflight first so the
// operator sees what the buyer would reject, then send in cursor-paged batches.
// ---------------------------------------------------------------------------

interface PreflightReason {
  message: string;
  field: string;
  count: number;
}

interface PreflightResponse {
  sendable: number;
  ready: number;
  blocked: { count: number; reasons: PreflightReason[] };
  warnings: { count: number; reasons: PreflightReason[] };
  alreadyMatched: number;
  invalid: number;
  mode: 'TEST' | 'LIVE';
  /** Set when nothing can be sent at all — e.g. the API key is not configured. */
  configError?: string;
}

interface SendFailureReason {
  outcome: 'UNMATCHED' | 'ERROR' | 'NOT_READY';
  message: string;
  count: number;
  examples: Array<{ name: string; phone: string; submissionId: string }>;
}

interface SendResponse {
  attempted: number;
  matched: number;
  unmatched: number;
  /** Accepted by the buyer and holding for their approval — not a failure. */
  manualReview: number;
  errored: number;
  notReady: number;
  remaining: number;
  nextCursor: string | null;
  failureReasons: SendFailureReason[];
}

const FAILURE_LABELS: Record<SendFailureReason['outcome'], string> = {
  ERROR: 'Rejected',
  UNMATCHED: 'Unmatched',
  NOT_READY: 'Held back',
};

const FAILURE_STYLES: Record<SendFailureReason['outcome'], string> = {
  ERROR: 'border-dropped/40 bg-dropped-tint text-dropped-ink',
  UNMATCHED: 'border-rule bg-sunken text-ink-2',
  NOT_READY: 'border-ringing/40 bg-ringing-tint text-ringing-ink',
};

/**
 * Batches are separate requests, so the same rejection arrives once per batch.
 * Merge on outcome+message to keep one line per distinct reason for the run.
 */
function mergeFailureReasons(
  running: SendFailureReason[],
  incoming: SendFailureReason[]
): SendFailureReason[] {
  const merged = new Map(running.map(reason => [`${reason.outcome}::${reason.message}`, reason]));

  for (const reason of incoming) {
    const key = `${reason.outcome}::${reason.message}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        count: existing.count + reason.count,
        examples: [...existing.examples, ...reason.examples].slice(0, 5),
      });
    } else {
      merged.set(key, { ...reason });
    }
  }

  return [...merged.values()].sort((a, b) => b.count - a.count);
}

const SEND_BATCH_SIZE = 100;

function BuyerDeliveryPanel({
  submissionIds,
  vertical,
}: {
  /**
   * The submissions this import created. This panel sends these and nothing
   * else — there is deliberately no fallback to the list.
   *
   * A fallback used to live here: "scope to the list when the import returned
   * no ids". It fired whenever the API did not return submissionId — an older
   * API container is enough — and silently turned "send the 170 I just
   * imported" into "send every held lead in the list", 12,000 of them. A post
   * is spent whether or not the lead sells, so that is 12,000 leads burned
   * through their 90-day duplicate window on one click.
   *
   * Sending nothing is always recoverable. Sending the wrong leads is not.
   */
  submissionIds: string[];
  vertical: 'ACA' | 'FE' | 'B2B';
}) {
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [totals, setTotals] = useState<SendResponse | null>(null);
  const [sentSoFar, setSentSoFar] = useState(0);

  // One selector for both calls, so what the panel counts is exactly what the
  // button sends. Two different scopes here is how "send 17" becomes "send 74".
  const selector = useMemo(() => ({ submissionIds, vertical }), [submissionIds, vertical]);

  const loadPreflight = useCallback(async () => {
    // No ids means the import told us nothing about what it stored, and this
    // panel has no safe way to guess. Do not call preflight, do not offer a
    // button: an unscoped send here costs thousands of leads.
    if (!submissionIds.length) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<PreflightResponse>(
        '/api/v1/insurance-leads/delivery/preflight',
        selector
      );
      if (!response.error && response.data) {
        setPreflight(response.data);
      }
    } catch (err) {
      console.error('Delivery preflight failed:', err);
    } finally {
      setLoading(false);
    }
  }, [selector, submissionIds.length]);

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  const send = async () => {
    setSending(true);
    setSendError(null);
    setSentSoFar(0);

    const running: SendResponse = {
      attempted: 0,
      matched: 0,
      unmatched: 0,
      manualReview: 0,
      errored: 0,
      notReady: 0,
      remaining: 0,
      nextCursor: null,
      failureReasons: [],
    };

    try {
      let cursor: string | null = null;
      // Each batch is one HTTP request; loop until the API says it has walked
      // past the last sendable submission in the list.
      for (;;) {
        const response: ApiResponse<SendResponse> = await apiClient.post<SendResponse>(
          '/api/v1/insurance-leads/delivery/send',
          { ...selector, limit: SEND_BATCH_SIZE, cursor: cursor ?? undefined }
        );

        if (response.error || !response.data) {
          throw new Error(response.error?.message || 'Delivery request failed');
        }

        const batch: SendResponse = response.data;
        running.attempted += batch.attempted;
        running.matched += batch.matched;
        running.unmatched += batch.unmatched;
        running.manualReview += batch.manualReview ?? 0;
        running.errored += batch.errored;
        running.notReady += batch.notReady;
        running.remaining = batch.remaining;
        running.failureReasons = mergeFailureReasons(
          running.failureReasons,
          batch.failureReasons ?? []
        );
        setSentSoFar(running.attempted);
        setTotals({ ...running });

        cursor = batch.nextCursor;
        if (!cursor) break;
      }
    } catch (err: any) {
      setSendError(err?.message || 'Delivery request failed');
    } finally {
      setSending(false);
      void loadPreflight();
    }
  };

  // Say so loudly rather than rendering nothing. A missing panel reads as
  // "already sent" and is how the previous silent fallback went unnoticed.
  if (!submissionIds.length) {
    return (
      <div className="rounded-xl bg-ringing-tint p-4 text-xs text-ringing-ink">
        <p className="font-semibold">Nothing to send from this import.</p>
        <p className="mt-1 text-ringing-ink">
          The import did not report which leads it stored, so this panel cannot tell your leads
          apart from the rest of the list and will not send anything. The leads are saved and held —
          nothing is lost. If the API container is older than the web one, rebuild it with{' '}
          <span className="font-mono">./deploy.sh api web</span> and import again.
        </p>
      </div>
    );
  }

  if (loading && !preflight) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rule bg-sunken p-4 text-xs text-ink-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking what the buyer will accept...
      </div>
    );
  }

  if (!preflight) return null;

  return (
    <div className="space-y-3 rounded-xl border border-rule bg-sunken p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Send to buyer</h3>
          <p className="mt-0.5 text-[11px] text-ink-2">
            Imported leads are held until you send them. Nothing was posted yet.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            preflight.mode === 'LIVE'
              ? 'border-live/40 bg-live-tint text-live-ink'
              : 'border-ringing/40 bg-ringing-tint text-ringing-ink'
          }`}
        >
          {preflight.mode} mode
        </span>
      </div>

      {preflight.configError && (
        <div className="rounded-md bg-dropped-tint p-2.5 text-[11px] text-dropped-ink">
          <span className="font-semibold">Delivery is not configured. </span>
          {preflight.configError} Nothing will be sent, and no lead is spent while this is
          unresolved.
        </div>
      )}

      {preflight.mode === 'TEST' && (
        <p className="rounded-md bg-ringing-tint p-2.5 text-[11px] text-ringing-ink">
          Posts go out flagged <span className="font-mono">Test_Lead=1</span> and will not be
          bought. Set <span className="font-mono">INSURANCE_LEAD_MODE=LIVE</span> on the API to sell
          for real.
        </p>
      )}

      <p className="text-[11px] text-ink-3">
        Only the {submissionIds.length} lead{submissionIds.length === 1 ? '' : 's'} you just
        imported. Leads already held in this list are never included.
      </p>

      <div className="grid grid-cols-3 gap-3 border-y border-rule py-3 text-center">
        <div>
          <span className="text-xl font-bold text-live-ink">{preflight.ready}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-ink-3">
            Ready to send
          </span>
        </div>
        <div>
          <span className="text-xl font-bold text-ringing-ink">{preflight.blocked.count}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-ink-3">
            Missing buyer fields
          </span>
        </div>
        <div>
          <span className="text-xl font-bold text-ink-3">{preflight.alreadyMatched}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-ink-3">
            Already sold
          </span>
        </div>
      </div>

      {preflight.blocked.reasons.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Why leads are blocked
          </div>
          <ul className="space-y-1 text-[11px] text-ink-3">
            {preflight.blocked.reasons.map(reason => (
              <li key={reason.field} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-ringing-ink">{reason.count}×</span>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preflight.warnings.reasons.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Sends anyway, but worth fixing
          </div>
          <ul className="space-y-1 text-[11px] text-ink-3">
            {preflight.warnings.reasons.map(reason => (
              <li key={reason.field} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-ink-2">{reason.count}×</span>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totals && (
        <div className="space-y-2 rounded-md border border-rule bg-sunken p-2.5 text-[11px] text-ink-2">
          <div>
            Sent {totals.attempted} — {totals.matched} matched, {totals.manualReview} awaiting buyer
            approval, {totals.unmatched} unmatched, {totals.errored} errored, {totals.notReady} held
            back.
          </div>

          {totals.failureReasons.length > 0 && (
            <div className="space-y-1.5 border-t border-rule pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                What the buyer said
              </div>
              <ul className="space-y-1.5">
                {totals.failureReasons.map(reason => (
                  <li
                    key={`${reason.outcome}-${reason.message}`}
                    className="flex items-start gap-2"
                  >
                    <span
                      className={`mt-px shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${FAILURE_STYLES[reason.outcome]}`}
                    >
                      {reason.count}× {FAILURE_LABELS[reason.outcome]}
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words text-ink-2">{reason.message}</span>
                      {reason.examples.length > 0 && (
                        <span className="block text-[10px] text-ink-3">
                          e.g.{' '}
                          {reason.examples
                            .map(example => `${example.name || 'Unnamed'} ${example.phone}`)
                            .join(', ')}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sendError && (
        <div className="rounded-md bg-dropped-tint p-2.5 text-[11px] text-dropped-ink">
          {sendError}
        </div>
      )}

      <button
        onClick={() => void send()}
        disabled={sending || preflight.ready === 0 || Boolean(preflight.configError)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-5 py-2 text-xs font-medium text-ink transition-colors hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sending {sentSoFar}/{preflight.ready}...
          </>
        ) : preflight.configError ? (
          'Cannot send — delivery is not configured'
        ) : (
          `Send ${preflight.ready} lead${preflight.ready === 1 ? '' : 's'} to buyer`
        )}
      </button>
    </div>
  );
}
