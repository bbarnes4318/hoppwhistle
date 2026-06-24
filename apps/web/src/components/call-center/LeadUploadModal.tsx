'use client';

import { X, Upload, Check, AlertCircle, RefreshCw, Plus, ChevronRight, Play } from 'lucide-react';
import React, { useState, useRef, useCallback } from 'react';
import { bulkImportInsuranceLeads } from '@/lib/api/leads';

interface LeadUploadModalProps {
  onClose: () => void;
  onImportComplete: () => void;
}

interface MappingField {
  key: string;
  label: string;
  required?: boolean;
}

const CRM_FIELDS: MappingField[] = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'phone', label: 'Phone Number (Required)', required: true },
  { key: 'email', label: 'Email Address' },
  { key: 'address', label: 'Street Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State (2-letter)' },
  { key: 'zipCode', label: 'Zip Code (5-digit)' },
  { key: 'age', label: 'Age' },
  { key: 'gender', label: 'Gender' },
  { key: 'carrier', label: 'Insurance Carrier' },
  { key: 'faceAmount', label: 'Face Amount / Coverage' },
  { key: 'monthlyPremium', label: 'Monthly Premium' },
  { key: 'smoker', label: 'Smoker Status (Yes/No)' },
];

function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let currentVal = '';
  let insideQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentVal += '"';
          i++; // skip next quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        row.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\r' || char === '\n') {
        row.push(currentVal.trim());
        currentVal = '';
        if (row.length > 0 && (row.length > 1 || row[0] !== '')) {
          result.push(row);
        }
        row = [];
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
      } else {
        currentVal += char;
      }
    }
  }
  
  if (currentVal !== '' || row.length > 0) {
    row.push(currentVal.trim());
    result.push(row);
  }
  
  return result;
}

export function LeadUploadModal({ onClose, onImportComplete }: LeadUploadModalProps): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<number, string>>({}); // colIndex -> crmKey or 'custom' or 'skip'
  const [customFields, setCustomFields] = useState<Record<number, string>>({}); // colIndex -> customLabel
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-map headers
  const autoMapHeaders = (parsedHeaders: string[]) => {
    const newMappings: Record<number, string> = {};
    parsedHeaders.forEach((hdr, idx) => {
      const clean = hdr.toLowerCase().replace(/[\s_-]/g, '');
      
      if (clean.includes('firstname') || clean.includes('first')) {
        newMappings[idx] = 'firstName';
      } else if (clean.includes('lastname') || clean.includes('last')) {
        newMappings[idx] = 'lastName';
      } else if (clean.includes('fullname') || clean === 'name') {
        newMappings[idx] = 'fullName';
      } else if (clean.includes('phone') || clean.includes('tel') || clean.includes('cell') || clean === 'number') {
        newMappings[idx] = 'phone';
      } else if (clean.includes('email') || clean === 'mail') {
        newMappings[idx] = 'email';
      } else if (clean.includes('address') || clean === 'street') {
        newMappings[idx] = 'address';
      } else if (clean === 'city') {
        newMappings[idx] = 'city';
      } else if (clean === 'state') {
        newMappings[idx] = 'state';
      } else if (clean.includes('zip') || clean.includes('postal')) {
        newMappings[idx] = 'zipCode';
      } else if (clean === 'age') {
        newMappings[idx] = 'age';
      } else if (clean === 'gender' || clean === 'sex') {
        newMappings[idx] = 'gender';
      } else if (clean.includes('carrier') || clean.includes('company')) {
        newMappings[idx] = 'carrier';
      } else if (clean.includes('premium') || clean.includes('price')) {
        newMappings[idx] = 'monthlyPremium';
      } else if (clean.includes('face') || clean.includes('coverage') || clean.includes('benefit')) {
        newMappings[idx] = 'faceAmount';
      } else if (clean.includes('smoke')) {
        newMappings[idx] = 'smoker';
      } else {
        newMappings[idx] = 'skip';
      }
    });
    setMappings(newMappings);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length < 2) {
          setError('The uploaded CSV file is empty or does not contain a header and data rows.');
          return;
        }
        setCsvData(parsed);
        const parsedHeaders = parsed[0] || [];
        setHeaders(parsedHeaders);
        autoMapHeaders(parsedHeaders);
        setStep(2);
      } catch (err) {
        setError('Failed to parse CSV file. Please check the file formatting.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  const handleMappingChange = (colIdx: number, val: string) => {
    setMappings(prev => ({ ...prev, [colIdx]: val }));
    if (val !== 'custom') {
      setCustomFields(prev => {
        const copy = { ...prev };
        delete copy[colIdx];
        return copy;
      });
    } else {
      // Initialize custom field label with CSV header
      setCustomFields(prev => ({ ...prev, [colIdx]: headers[colIdx] || `CustomField${colIdx + 1}` }));
    }
  };

  const handleCustomLabelChange = (colIdx: number, val: string) => {
    setCustomFields(prev => ({ ...prev, [colIdx]: val }));
  };

  const executeImport = async () => {
    setError(null);
    
    // Check if phone mapping exists
    const phoneColIdx = Object.keys(mappings).find(idx => mappings[Number(idx)] === 'phone');
    if (phoneColIdx === undefined) {
      setError('You must map one of the columns to the Phone Number field (required).');
      return;
    }

    setIsImporting(true);
    
    try {
      const dataRows = csvData.slice(1);
      const leadsToImport: Array<Record<string, unknown>> = [];

      dataRows.forEach((row) => {
        const lead: Record<string, unknown> = {};
        const customFieldsObj: Record<string, unknown> = {};

        row.forEach((cell, idx) => {
          const mapping = mappings[idx];
          if (!mapping || mapping === 'skip' || cell === '') return;

          if (mapping === 'custom') {
            const customLabel = customFields[idx] || `custom_${idx}`;
            // Convert label to camelCase key
            const customKey = customLabel
              .toLowerCase()
              .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr: string) => chr.toUpperCase())
              .replace(/[^a-zA-Z0-9]/g, '');
            customFieldsObj[customKey] = cell;
          } else {
            if (mapping === 'age') {
              const numAge = parseInt(cell);
              lead[mapping] = isNaN(numAge) ? cell : numAge;
            } else {
              lead[mapping] = cell;
            }
          }
        });

        if (Object.keys(customFieldsObj).length > 0) {
          lead.customFields = customFieldsObj;
        }

        if (lead.phone) {
          leadsToImport.push(lead);
        }
      });

      if (leadsToImport.length === 0) {
        setError('No valid leads with phone numbers were found in the uploaded file.');
        setIsImporting(false);
        return;
      }

      const res = await bulkImportInsuranceLeads(leadsToImport);
      if (res.success) {
        setImportedCount(res.count);
        setStep(3);
      } else {
        setError('Failed to import leads. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during lead import.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" />
              Upload & Map Leads
            </h2>
            <p className="text-xs text-slate-400 mt-1">Import new leads directly into the CRM and queue</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="m-5 mb-0 p-4 bg-red-950/30 border border-red-500/20 text-red-400 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs font-mono">{error}</div>
          </div>
        )}

        {/* Step Content */}
        <div className="p-6 flex-1 overflow-y-auto max-h-[500px]">
          
          {/* STEP 1: UPLOAD */}
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-slate-800 hover:border-cyan-500/30 rounded-2xl cursor-pointer group transition-colors bg-slate-950/20"
                 onClick={() => fileInputRef.current?.click()}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv"
                className="hidden"
              />
              <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-105 transition-transform group-hover:bg-cyan-500/10">
                <Upload className="w-8 h-8 text-slate-400 group-hover:text-cyan-400 transition-colors" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">Select Lead CSV File</h3>
              <p className="text-xs text-slate-400 max-w-xs text-center">
                Drag and drop or click to browse. Must contain a header row.
              </p>
            </div>
          )}

          {/* STEP 2: FIELD MAPPING */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-slate-950/40 p-4 border border-slate-800 rounded-xl">
                <h4 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-2">CSV Data Preview</h4>
                <div className="overflow-x-auto text-[11px] font-mono text-slate-300">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-800">
                        {headers.slice(0, 5).map((hdr, idx) => (
                          <th key={idx} className="pb-1.5 pr-4 text-slate-400">{hdr}</th>
                        ))}
                        {headers.length > 5 && <th className="pb-1.5 text-slate-500">...</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.slice(1, 4).map((row, rowIdx) => (
                        <tr key={rowIdx} className="opacity-80">
                          {row.slice(0, 5).map((cell, cellIdx) => (
                            <td key={cellIdx} className="py-1 pr-4 max-w-[120px] truncate">{cell}</td>
                          ))}
                          {row.length > 5 && <td className="py-1 text-slate-500">...</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-3">Map CSV Columns to CRM Fields</h4>
                <div className="space-y-3">
                  {headers.map((header, idx) => {
                    const mappedKey = mappings[idx] || 'skip';
                    const isCustom = mappedKey === 'custom';
                    return (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-950/20 border border-slate-800/80 hover:border-slate-800 rounded-xl gap-4 transition-all">
                        <div className="sm:max-w-[40%] truncate">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 block mb-0.5">CSV Column</span>
                          <span className="text-sm font-bold text-white">{header}</span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:min-w-[50%]">
                          <div className="flex-1">
                            <select
                              value={mappedKey}
                              onChange={(e) => handleMappingChange(idx, e.target.value)}
                              className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs py-2 px-3 rounded-lg focus:border-cyan-500 focus:outline-none cursor-pointer"
                            >
                              <option value="skip">[ Skip Column ]</option>
                              <option value="custom">[ + Create New Custom Field ]</option>
                              <optgroup label="Standard CRM Fields">
                                {CRM_FIELDS.map((fld) => (
                                  <option key={fld.key} value={fld.key}>
                                    {fld.label}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </div>
                          
                          {isCustom && (
                            <div className="sm:w-44">
                              <input
                                type="text"
                                value={customFields[idx] || ''}
                                onChange={(e) => handleCustomLabelChange(idx, e.target.value)}
                                placeholder="Custom Field Name"
                                className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs py-2 px-3 rounded-lg focus:border-cyan-500 focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-1">Import Successful!</h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  Successfully imported <span className="text-emerald-400 font-bold">{importedCount}</span> leads.
                  They are now saved to the CRM database and loaded into your dialer queue.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="text-[10px] font-mono text-slate-500">
            {step === 2 && <span>Headers detected: {headers.length}</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 bg-slate-800 text-slate-300 text-xs font-mono uppercase tracking-widest rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              {step === 3 ? 'Close' : 'Cancel'}
            </button>
            {step === 2 && (
              <button
                onClick={executeImport}
                disabled={isImporting}
                className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold uppercase tracking-widest rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Import Leads
                  </>
                )}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => {
                  onImportComplete();
                  onClose();
                }}
                className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold uppercase tracking-widest rounded-lg transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
