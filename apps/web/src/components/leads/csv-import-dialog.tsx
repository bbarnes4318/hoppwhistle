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
import { useState, useRef } from 'react';

import { apiClient } from '@/lib/api';

interface CsvImportDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface TargetField {
  key: string;
  label: string;
  required: boolean;
  vertical?: 'ACA' | 'FE';
  description: string;
}

const TARGET_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', required: true, description: 'First name of prospect' },
  { key: 'lastName', label: 'Last Name', required: true, description: 'Last name of prospect' },
  { key: 'phone', label: 'Phone Number', required: true, description: '10-digit phone number' },
  {
    key: 'email',
    label: 'Email Address',
    required: true,
    description: 'Email address of prospect',
  },
  { key: 'address', label: 'Street Address', required: true, description: 'Home street address' },
  { key: 'city', label: 'City', required: true, description: 'City name' },
  { key: 'state', label: 'State', required: true, description: '2-letter state code' },
  { key: 'zipCode', label: 'Zip Code', required: true, description: '5-digit zip code' },
  {
    key: 'birthDate',
    label: 'Birth Date',
    required: true,
    description: 'Birthdate (MM/DD/YYYY or YYYY-MM-DD)',
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

  // ACA Specific
  {
    key: 'heightFeet',
    label: 'Height (Feet)',
    required: true,
    vertical: 'ACA',
    description: 'Height in feet (e.g. 5)',
  },
  {
    key: 'heightInches',
    label: 'Height (Inches)',
    required: true,
    vertical: 'ACA',
    description: 'Height in inches (0-11)',
  },
  {
    key: 'weight',
    label: 'Weight (lbs)',
    required: true,
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
    required: true,
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
  const [vertical, setVertical] = useState<'ACA' | 'FE'>('ACA');
  const [fileName, setFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // TargetKey -> CSV Header Index (string representation)
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    total: number;
    successCount: number;
    failCount: number;
    details: Array<{
      success: boolean;
      name: string;
      phone: string;
      errors: Array<{ path: string; message: string }> | null;
    }>;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTargetFields = TARGET_FIELDS.filter(f => !f.vertical || f.vertical === vertical);

  // Template Download
  const downloadTemplate = () => {
    const commonHeaders = [
      'firstName',
      'lastName',
      'phone',
      'email',
      'address',
      'city',
      'state',
      'zipCode',
      'birthDate',
      'notes',
      'priority',
      'source',
      'leadStage',
      'nextFollowUpAt',
    ];
    const acaHeaders = [
      'heightFeet',
      'heightInches',
      'weight',
      'smoker',
      'householdIncome',
      'peopleInHousehold',
    ];
    const feHeaders = [
      'gender',
      'smoker',
      'carrier',
      'product',
      'monthlyPremium',
      'coverageAmount',
    ];

    const hdrs =
      vertical === 'ACA' ? [...commonHeaders, ...acaHeaders] : [...commonHeaders, ...feHeaders];

    let templateData = '';
    if (vertical === 'ACA') {
      templateData =
        'John,Doe,1234567890,john.doe@example.com,123 Main St,Austin,TX,78701,1980-05-15,Needs callback next week,HIGH,Facebook,NEW,2026-06-28T09:00:00Z,5,10,175,No,45000,2';
    } else {
      templateData =
        'Jane,Doe,0987654321,jane.doe@example.com,456 Oak Rd,Miami,FL,33101,1965-11-20,Interested in Whole Life,NORMAL,Google,CONTACTED,2026-06-29T14:30:00Z,Female,Yes,Mutual of Omaha,Living Promise,54.20,10000';
    }

    const csvContent = hdrs.join(',') + '\n' + templateData;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `crm_import_template_${vertical.toLowerCase()}.csv`);
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
          const initialMappings: Record<string, string> = {};
          activeTargetFields.forEach(target => {
            const targetNameClean = target.key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const targetLabelClean = target.label.toLowerCase().replace(/[^a-z0-9]/g, '');

            const matchIndex = csvHeaders.findIndex(h => {
              const hClean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
              return hClean === targetNameClean || hClean === targetLabelClean;
            });

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

    try {
      const response = await apiClient.post('/api/v1/insurance-leads/import', {
        vertical,
        leads: payloadLeads,
      });

      const data = response.data as any;
      setImportResult({
        total: data.total ?? payloadLeads.length,
        successCount: data.successCount ?? 0,
        failCount: data.failCount ?? 0,
        details: data.details ?? [],
      });
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
                <div className="grid grid-cols-2 gap-4">
                  {[
                    {
                      value: 'ACA',
                      label: 'ACA (Affordable Care Act)',
                      desc: 'Requires height/weight validation',
                    },
                    {
                      value: 'FE',
                      label: 'FE (Final Expense)',
                      desc: 'Requires gender validation',
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
                    <h3 className="text-sm font-medium">Download Import Template</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Start with a pre-formatted CSV template tailored for {vertical}
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

              {/* File Dropzone */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Upload Prospect File
                </label>
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
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
                <span className="text-xs font-medium text-slate-400">
                  Map CSV headers to CRM Database fields
                </span>
                <span className="text-[11px] bg-slate-900 border border-white/5 text-slate-400 px-2 py-0.5 rounded">
                  File: {fileName} · Rows: {parsedRows.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {activeTargetFields.map(field => {
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
                        {activeTargetFields.map(f => (
                          <th key={f.key} className="px-4 py-2.5 text-left">
                            {f.label}
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
                          {activeTargetFields.map(f => (
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
                    Ingesting Prospects...
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
