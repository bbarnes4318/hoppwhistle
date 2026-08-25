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
import { useState, useRef, useEffect, useCallback } from 'react';

import { apiClient, type ApiResponse } from '@/lib/api';

import { BUYER_FIELD, BUYER_TEMPLATE_KEYS } from './buyer-fields';

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
    description: 'Site where the lead form was completed',
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

function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(currentValue.trim());
      if (row.length > 1 || row[0] !== '') {
        lines.push(row);
      }
      row = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  if (currentValue !== '' || row.length > 0) {
    row.push(currentValue.trim());
    lines.push(row);
  }
  return lines;
}

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
      landingPage: 'hopwhistle.com',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="relative flex h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-white/10 bg-slate-900/90 text-slate-100 shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-slate-950/40 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 p-2 border border-emerald-500/20 text-emerald-400">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Import CRM Prospects</h2>
              <p className="text-xs text-muted-foreground">
                Upload, map columns, and ingest prospects in bulk
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Steps Bar */}
        <div className="flex items-center justify-between border-b border-white/5 bg-slate-950/20 px-8 py-3 text-xs font-medium text-slate-500">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 1 ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
            >
              1
            </span>
            <span className={step >= 1 ? 'text-slate-300' : ''}>Setup</span>
          </div>
          <div className="h-px w-12 bg-white/5" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 2 ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
            >
              2
            </span>
            <span className={step >= 2 ? 'text-slate-300' : ''}>Column Mapping</span>
          </div>
          <div className="h-px w-12 bg-white/5" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 3 ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
            >
              3
            </span>
            <span className={step >= 3 ? 'text-slate-300' : ''}>Preview</span>
          </div>
          <div className="h-px w-12 bg-white/5" />
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step >= 4 ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}
            >
              4
            </span>
            <span className={step >= 4 ? 'text-slate-300' : ''}>Results</span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: SETUP */}
          {step === 1 && (
            <div className="space-y-6 max-w-xl mx-auto py-8">
              {/* Vertical Select */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                      className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${vertical === opt.value ? 'bg-emerald-500/10 border-emerald-500 text-slate-100' : 'bg-slate-900/50 border-white/5 text-slate-400 hover:border-white/10'}`}
                    >
                      <span className="font-semibold text-sm">{opt.label}</span>
                      <span className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Download Option */}
              <div className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-950/20 p-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-emerald-400 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-medium">
                      {vertical === 'B2B' ? 'Download Import Template' : 'Download Buyer Template'}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {vertical === 'B2B'
                        ? 'Pre-formatted CSV template for B2B prospects'
                        : `Columns are Ameriquote's ${vertical} (TYPE=${vertical === 'FE' ? '19' : '31'}) field names — send this to your lead vendor`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-900 px-3 py-1.5 text-xs hover:bg-slate-800 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download CSV
                </button>
              </div>

              {/* Lead List Selection */}
              <div className="space-y-3 rounded-lg border border-white/5 bg-slate-950/20 p-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Target Lead List
                </label>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setIsCreateNewList(true)}
                    className={`flex-1 py-1.5 px-3 rounded border text-xs font-mono transition-colors ${isCreateNewList ? 'bg-emerald-500/10 border-emerald-500 text-slate-100' : 'bg-slate-900 border-white/5 text-slate-400'}`}
                  >
                    + CREATE NEW LIST
                  </button>
                  {leadLists.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCreateNewList(false)}
                      className={`flex-1 py-1.5 px-3 rounded border text-xs font-mono transition-colors ${!isCreateNewList ? 'bg-emerald-500/10 border-emerald-500 text-slate-100' : 'bg-slate-900 border-white/5 text-slate-400'}`}
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
                      className="w-full bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    <select
                      value={selectedListId}
                      onChange={e => setSelectedListId(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-primary cursor-pointer"
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                  className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 bg-slate-950/20 rounded-xl py-12 px-6 cursor-pointer hover:border-emerald-500/30 hover:bg-slate-950/40 transition-all"
                >
                  <div className="rounded-full bg-slate-900 p-3 border border-white/5 mb-3">
                    <Upload className="h-6 w-6 text-slate-400" />
                  </div>
                  <span className="text-sm font-medium text-slate-300">
                    Drag and drop your CSV file here
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
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
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div>
                  <span className="text-xs font-medium text-slate-400">Map your CSV columns</span>
                  {vertical !== 'B2B' && (
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      The first {buyerFieldCount} are posted to the buyer — the blue tag is the
                      field name they receive. Fields below those are stored in the CRM only.
                    </span>
                  )}
                </div>
                <span className="text-[11px] bg-slate-900 border border-white/5 text-slate-400 px-2 py-0.5 rounded">
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
                      className={`flex flex-col justify-between p-3 rounded-lg border transition-colors ${isMapped ? 'bg-slate-900/60 border-emerald-500/20' : 'bg-slate-900/30 border-white/5'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-200">
                              {field.label}
                            </span>
                            {field.required && (
                              <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest border border-red-500/20 bg-red-500/10 px-1 rounded">
                                Required
                              </span>
                            )}
                            {BUYER_FIELD[field.key] && (
                              <span
                                className="text-[9px] font-mono text-sky-300/80 border border-sky-500/20 bg-sky-500/10 px-1 rounded"
                                title="Field name the buyer receives"
                              >
                                → {BUYER_FIELD[field.key]}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            {field.description}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <select
                          value={mappedIdx ?? ''}
                          onChange={e => handleMapField(field.key, e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
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
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-4 text-xs text-emerald-400 flex items-start gap-2.5">
                <AlertCircle className="h-4.5 w-4.5 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Review your column mapping preview</p>
                  <p className="text-slate-400 mt-0.5">
                    Please check the mapped preview of the first 3 rows. If it looks correct, click
                    Import prospects to start bulk ingestion.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-white/5 bg-slate-950/20 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-slate-300">
                    <thead>
                      <tr className="border-b border-white/5 bg-slate-900/60 font-semibold uppercase text-slate-500">
                        <th className="px-4 py-2.5 text-left">Record</th>
                        {previewFields.map(f => (
                          <th key={f.key} className="px-4 py-2.5 text-left">
                            {BUYER_FIELD[f.key] || f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {parsedRows.slice(0, 3).map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.01]">
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-500">
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
              <div className="rounded-xl border border-white/5 bg-slate-950/40 p-6 flex flex-col items-center text-center">
                <div className="rounded-full bg-emerald-500/10 p-4 border border-emerald-500/20 text-emerald-400 mb-4 animate-bounce">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="text-base font-semibold text-slate-200">Import Complete</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Processed {importResult.total} prospect rows in this batch
                </p>

                <div className="grid grid-cols-2 gap-8 w-full max-w-xs mt-6 border-t border-white/5 pt-6">
                  <div>
                    <span className="text-2xl font-bold text-emerald-400">
                      {importResult.successCount}
                    </span>
                    <span className="block text-[10px] font-semibold text-slate-500 uppercase mt-0.5">
                      Valid Ingested
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-slate-400">
                      {importResult.failCount}
                    </span>
                    <span className="block text-[10px] font-semibold text-slate-500 uppercase mt-0.5">
                      Invalid (Needs Edit)
                    </span>
                  </div>
                </div>
              </div>

              {/* Errors log if failCount > 0 */}
              {importResult.failCount > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <span>Validation Warnings ({importResult.failCount})</span>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-slate-950/30 p-1 divide-y divide-white/5 max-h-40 overflow-y-auto">
                    {importResult.details
                      .filter(d => !d.success)
                      .map((det, idx) => (
                        <div key={idx} className="p-2.5 text-xs">
                          <div className="flex items-center justify-between font-medium">
                            <span className="text-slate-300">{det.name || 'Unnamed Prospect'}</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {det.phone}
                            </span>
                          </div>
                          <ul className="mt-1 list-disc pl-4 text-[10px] text-red-400 space-y-0.5">
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
                <BuyerDeliveryPanel listId={importedListId} vertical={vertical} />
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-white/5 bg-slate-950/40 px-6 py-4">
          <div>
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="rounded-md border border-white/10 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                Back to Setup
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => setStep(2)}
                className="rounded-md border border-white/10 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
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
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continue to Mapping
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 2 && (
              <button
                onClick={proceedToPreview}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-medium text-white transition-colors"
              >
                Continue to Preview
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 3 && (
              <button
                disabled={importing}
                onClick={() => void runImport()}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-5 py-2 text-xs font-medium text-white transition-colors"
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
}

interface SendResponse {
  attempted: number;
  matched: number;
  unmatched: number;
  errored: number;
  notReady: number;
  remaining: number;
  nextCursor: string | null;
}

const SEND_BATCH_SIZE = 100;

function BuyerDeliveryPanel({
  listId,
  vertical,
}: {
  listId: string;
  vertical: 'ACA' | 'FE' | 'B2B';
}) {
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [totals, setTotals] = useState<SendResponse | null>(null);
  const [sentSoFar, setSentSoFar] = useState(0);

  const loadPreflight = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.post<PreflightResponse>(
        '/api/v1/insurance-leads/delivery/preflight',
        { listId, vertical }
      );
      if (!response.error && response.data) {
        setPreflight(response.data);
      }
    } catch (err) {
      console.error('Delivery preflight failed:', err);
    } finally {
      setLoading(false);
    }
  }, [listId, vertical]);

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
      errored: 0,
      notReady: 0,
      remaining: 0,
      nextCursor: null,
    };

    try {
      let cursor: string | null = null;
      // Each batch is one HTTP request; loop until the API says it has walked
      // past the last sendable submission in the list.
      for (;;) {
        const response: ApiResponse<SendResponse> = await apiClient.post<SendResponse>(
          '/api/v1/insurance-leads/delivery/send',
          { listId, vertical, limit: SEND_BATCH_SIZE, cursor: cursor ?? undefined }
        );

        if (response.error || !response.data) {
          throw new Error(response.error?.message || 'Delivery request failed');
        }

        const batch: SendResponse = response.data;
        running.attempted += batch.attempted;
        running.matched += batch.matched;
        running.unmatched += batch.unmatched;
        running.errored += batch.errored;
        running.notReady += batch.notReady;
        running.remaining = batch.remaining;
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

  if (loading && !preflight) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-950/40 p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking what the buyer will accept...
      </div>
    );
  }

  if (!preflight) return null;

  return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-slate-950/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Send to buyer</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Imported leads are held until you send them. Nothing was posted yet.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            preflight.mode === 'LIVE'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
          }`}
        >
          {preflight.mode} mode
        </span>
      </div>

      {preflight.mode === 'TEST' && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-300/90">
          Posts go out flagged <span className="font-mono">Test_Lead=1</span> and will not be
          bought. Set <span className="font-mono">INSURANCE_LEAD_MODE=LIVE</span> on the API to sell
          for real.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 border-y border-white/5 py-3 text-center">
        <div>
          <span className="text-xl font-bold text-emerald-400">{preflight.ready}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-slate-500">
            Ready to send
          </span>
        </div>
        <div>
          <span className="text-xl font-bold text-amber-400">{preflight.blocked.count}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-slate-500">
            Missing buyer fields
          </span>
        </div>
        <div>
          <span className="text-xl font-bold text-slate-400">{preflight.alreadyMatched}</span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase text-slate-500">
            Already sold
          </span>
        </div>
      </div>

      {preflight.blocked.reasons.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Why leads are blocked
          </div>
          <ul className="space-y-1 text-[11px] text-slate-400">
            {preflight.blocked.reasons.map(reason => (
              <li key={reason.field} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-amber-400">{reason.count}×</span>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preflight.warnings.reasons.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Sends anyway, but worth fixing
          </div>
          <ul className="space-y-1 text-[11px] text-slate-500">
            {preflight.warnings.reasons.map(reason => (
              <li key={reason.field} className="flex items-start gap-2">
                <span className="shrink-0 font-mono text-slate-400">{reason.count}×</span>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totals && (
        <div className="rounded-md border border-white/5 bg-slate-900/60 p-2.5 text-[11px] text-slate-300">
          Sent {totals.attempted} — {totals.matched} matched, {totals.unmatched} unmatched,{' '}
          {totals.errored} errored, {totals.notReady} held back.
        </div>
      )}

      {sendError && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] text-red-400">
          {sendError}
        </div>
      )}

      <button
        onClick={() => void send()}
        disabled={sending || preflight.ready === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sending {sentSoFar}/{preflight.ready}...
          </>
        ) : (
          `Send ${preflight.ready} lead${preflight.ready === 1 ? '' : 's'} to buyer`
        )}
      </button>
    </div>
  );
}
