import {
  User,
  Phone,
  Briefcase,
  FileText,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import React from 'react';

import type { ProspectData } from './types';

interface CapturedScriptDataPanelProps {
  activeCallData: ProspectData | null;
  crmPhone?: string;
}

export function CapturedScriptDataPanel({
  activeCallData,
  crmPhone,
}: CapturedScriptDataPanelProps) {
  if (!activeCallData) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center text-ink-2 p-8 text-center bg-sunken border border-rule rounded-card">
        <HelpCircle className="w-10 h-10 text-ink-2 mb-2 opacity-40" />
        <p className="text-sm">No data has been captured yet.</p>
        <p className="text-xs text-ink-3 mt-1">
          Start a call and enter details in the Command Script tab.
        </p>
      </div>
    );
  }

  // Format currency
  const formatCurrency = (val: unknown) => {
    if (!val) return '—';
    const num = Number(val);
    return isNaN(num) ? String(val) : `$${num.toLocaleString()}`;
  };

  // Group fields
  const personalInfo = [
    { label: 'First Name', value: activeCallData.firstName || activeCallData.first_name || '—' },
    { label: 'Middle Name', value: activeCallData.middleName || '—' },
    { label: 'Last Name', value: activeCallData.lastName || activeCallData.last_name || '—' },
    {
      label: 'Phone Number',
      value: activeCallData.phone || activeCallData.caller_id || crmPhone || '—',
    },
    { label: 'Email', value: activeCallData.email || '—' },
    { label: 'Date of Birth', value: activeCallData.dob || '—' },
    { label: 'Age', value: activeCallData.age || '—' },
    { label: 'Gender', value: activeCallData.gender || '—' },
    { label: 'Tobacco Use', value: activeCallData.tobacco ? 'Yes (Smoker)' : 'No (Non-Smoker)' },
    {
      label: 'Height',
      value: activeCallData.heightFeet
        ? `${activeCallData.heightFeet} ft ${activeCallData.heightInches || 0} in`
        : '—',
    },
    { label: 'Weight', value: activeCallData.weight ? `${activeCallData.weight} lbs` : '—' },
    { label: 'Citizenship', value: activeCallData.citizenship || '—' },
    { label: 'Birth State', value: activeCallData.birthState || '—' },
  ];

  const addressInfo = [
    { label: 'Street Address', value: activeCallData.address || '—' },
    { label: 'City', value: activeCallData.city || '—' },
    { label: 'State', value: activeCallData.state || '—' },
    { label: 'Zip Code', value: activeCallData.zip || activeCallData.zipCode || '—' },
  ];

  const beneficiaryInfo = [
    { label: 'Beneficiary Name', value: activeCallData.beneficiaryName || '—' },
    { label: 'Relationship', value: activeCallData.beneficiaryRelation || '—' },
  ];

  const quoteInfo = [
    { label: 'Selected Carrier', value: activeCallData.selectedCarrier || '—', highlight: true },
    { label: 'Plan Type', value: activeCallData.selectedPlanType || '—' },
    {
      label: 'Coverage Amount',
      value: formatCurrency(activeCallData.selectedCoverage),
      highlight: true,
    },
    {
      label: 'Monthly Premium',
      value: formatCurrency(activeCallData.selectedPremium),
      highlight: true,
    },
  ];

  const bankInfo = [
    { label: 'Account Holder Name', value: activeCallData.accountHolder || '—' },
    { label: 'Bank Name', value: activeCallData.bankName || '—' },
    { label: 'Bank Location', value: activeCallData.bankCityState || '—' },
    { label: 'Routing Number', value: activeCallData.routingNumber || '—' },
    {
      label: 'Account Number',
      value: activeCallData.accountNumber
        ? '••••' + String(activeCallData.accountNumber).slice(-4)
        : '—',
    },
    { label: 'Account Type', value: activeCallData.accountType || '—' },
    {
      label: 'SS Payment Schedule',
      value: activeCallData.ssPaymentSchedule
        ? 'Yes'
        : activeCallData.ssPaymentSchedule === false
          ? 'No'
          : '—',
    },
    { label: 'Draft Day', value: activeCallData.draftDay || '—' },
    { label: 'SS Payment Day', value: activeCallData.ssPaymentDay || '—' },
  ];

  const existingCoverage = [
    {
      label: 'Has Existing Insurance',
      value: activeCallData.hasExistingInsurance
        ? 'Yes'
        : activeCallData.hasExistingInsurance === false
          ? 'No'
          : '—',
    },
    { label: 'Company Name', value: activeCallData.existingCompanyName || '—' },
    { label: 'Policy Number', value: activeCallData.existingPolicyNumber || '—' },
    { label: 'Coverage Amount', value: activeCallData.existingCoverageAmount || '—' },
  ];

  const doctorInfo = [
    { label: 'Primary Care Physician', value: activeCallData.doctorName || '—' },
    { label: 'Doctor Phone', value: activeCallData.doctorPhone || '—' },
    { label: 'Doctor Address', value: activeCallData.doctorAddress || '—' },
  ];

  // Health questions definitions
  const healthQMap = [
    {
      id: 'healthQ1',
      label: 'Q1: Hospitalization, nursing, oxygen, cancer, ADL assistance',
      val: activeCallData.healthQ1,
    },
    {
      id: 'healthQ2',
      label: "Q2: Organ transplant, CHF, Alzheimer's, ALS, terminal illness",
      val: activeCallData.healthQ2,
    },
    {
      id: 'healthQ3',
      label: 'Q3: Tested positive or treated for AIDS/HIV',
      val: activeCallData.healthQ3,
    },
    {
      id: 'healthQ4',
      label: 'Q4: Diabetes complications or insulin before age 50',
      val: activeCallData.healthQ4,
    },
    {
      id: 'healthQ5',
      label: 'Q5: Kidney disease, dialysis, or multiple cancers',
      val: activeCallData.healthQ5,
    },
    {
      id: 'healthQ6',
      label: 'Q6: Pending diagnostic tests, biopsies, or surgeries',
      val: activeCallData.healthQ6,
    },
    {
      id: 'healthQ7a',
      label: 'Q7a: 2yr stroke, COPD, liver disease/cirrhosis, oxygen use',
      val: activeCallData.healthQ7a,
    },
    {
      id: 'healthQ7b',
      label: 'Q7b: 2yr heart attack, aneurysm, heart/circulatory surgery',
      val: activeCallData.healthQ7b,
    },
    {
      id: 'healthQ7c',
      label: 'Q7c: 2yr cancer treatment (chemo, radiation, surgery)',
      val: activeCallData.healthQ7c,
    },
    {
      id: 'healthQ7d',
      label: 'Q7d: 2yr drug or alcohol abuse/treatment',
      val: activeCallData.healthQ7d,
    },
    {
      id: 'healthQ8a',
      label: 'Q8a: 3yr heart/circulatory issues or vascular surgery',
      val: activeCallData.healthQ8a,
    },
    {
      id: 'healthQ8b',
      label: 'Q8b: 3yr cancer, COPD, chronic liver disease',
      val: activeCallData.healthQ8b,
    },
    {
      id: 'healthQ8c',
      label: "Q8c: 3yr paralysis, MS, seizures, Parkinson's disease",
      val: activeCallData.healthQ8c,
    },
    {
      id: 'healthCovid',
      label: 'COVID: Hospitalization or lingering medical complications',
      val: activeCallData.healthCovid,
    },
  ];

  const renderGridSection = (
    title: string,
    items: Array<{ label: string; value: any; highlight?: boolean }>,
    icon: React.ReactNode
  ) => {
    return (
      <div className="bg-surface border border-rule rounded-card p-5 space-y-4 transition-shadow">
        <div className="flex items-center space-x-2 pb-2 border-b border-rule">
          {icon}
          <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-ink">
            {title}
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="space-y-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-ink-2 block">
                {item.label}
              </span>
              <span
                className={`text-xs font-mono font-medium block truncate ${item.highlight ? 'text-brand-ink font-semibold' : 'text-ink'}`}
                title={String(item.value)}
              >
                {String(item.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-grow overflow-y-auto pr-1 space-y-6">
      {/* Carrier Quote Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-brand-tint border border-brand rounded-card p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink">
            Carrier
          </span>
          <span className="text-xl font-bold font-mono tracking-wide text-ink mt-2">
            {activeCallData.selectedCarrier || 'Not Selected'}
          </span>
        </div>
        <div className="bg-brand-tint border border-brand rounded-card p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink">
            Coverage
          </span>
          <span className="text-xl font-bold font-mono tracking-wide text-ink mt-2">
            {formatCurrency(activeCallData.selectedCoverage)}
          </span>
        </div>
        <div className="bg-brand-tint border border-brand rounded-card p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink">
            Monthly Premium
          </span>
          <span className="text-xl font-bold font-mono tracking-wide text-brand-ink mt-2">
            {formatCurrency(activeCallData.selectedPremium)}
          </span>
        </div>
        <div className="bg-brand-tint border border-brand rounded-card p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink">
            Plan Type
          </span>
          <span className="text-xl font-bold font-mono tracking-wide text-ink mt-2">
            {activeCallData.selectedPlanType || 'Level'}
          </span>
        </div>
      </div>

      {/* Sections */}
      {renderGridSection(
        'Personal Information',
        personalInfo,
        <User className="w-4 h-4 text-brand-ink" />
      )}
      {renderGridSection(
        'Address & Location',
        addressInfo,
        <Phone className="w-4 h-4 text-brand-ink" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderGridSection(
          'Beneficiary Details',
          beneficiaryInfo,
          <Briefcase className="w-4 h-4 text-brand-ink" />
        )}
        {renderGridSection(
          'Existing Insurance',
          existingCoverage,
          <FileText className="w-4 h-4 text-brand-ink" />
        )}
      </div>

      {renderGridSection(
        'Bank Draft & SS Details',
        bankInfo,
        <Briefcase className="w-4 h-4 text-brand-ink" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderGridSection(
          'Physician Details',
          doctorInfo,
          <User className="w-4 h-4 text-brand-ink" />
        )}
        {activeCallData.hospitalizationReason && (
          <div className="bg-surface border border-rule rounded-card p-5 space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-ink pb-2 border-b border-rule">
              Hospitalization Reason
            </h3>
            <p className="text-xs font-mono text-ink whitespace-pre-wrap">
              {String(activeCallData.hospitalizationReason)}
            </p>
          </div>
        )}
      </div>

      {/* Health Questions Answers */}
      <div className="bg-surface border border-rule rounded-card p-5 space-y-4">
        <div className="flex items-center space-x-2 pb-2 border-b border-rule">
          <FileText className="w-4 h-4 text-brand-ink" />
          <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-ink">
            Health Questions Log
          </h3>
        </div>
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {healthQMap.map(q => (
            <div
              key={q.id}
              className="flex items-center justify-between py-2 border-b border-rule text-xs"
            >
              <span className="text-ink-2 font-mono truncate mr-4" title={q.label}>
                {q.label}
              </span>
              <div className="flex-shrink-0">
                {q.val === true ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-dropped-tint text-dropped-ink border border-dropped">
                    <AlertTriangle className="w-3 h-3 mr-1" /> YES
                  </span>
                ) : q.val === false ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-live-tint text-live-ink border border-live">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> NO
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-sunken text-ink-2 border border-rule-strong">
                    UNANSWERED
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
