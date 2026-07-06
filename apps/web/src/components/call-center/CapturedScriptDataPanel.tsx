import React from 'react';
import { User, Phone, Briefcase, FileText, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import type { ProspectData } from './types';

interface CapturedScriptDataPanelProps {
  activeCallData: ProspectData | null;
  crmPhone?: string;
}

export function CapturedScriptDataPanel({ activeCallData, crmPhone }: CapturedScriptDataPanelProps) {
  if (!activeCallData) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center text-muted-foreground p-8 text-center bg-white/5 border border-white/10 rounded-xl">
        <HelpCircle className="w-10 h-10 text-muted-foreground mb-2 opacity-40" />
        <p className="text-sm">No data has been captured yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Start a call and enter details in the Command Script tab.</p>
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
    { label: 'Phone Number', value: activeCallData.phone || activeCallData.caller_id || crmPhone || '—' },
    { label: 'Email', value: activeCallData.email || '—' },
    { label: 'Date of Birth', value: activeCallData.dob || '—' },
    { label: 'Age', value: activeCallData.age || '—' },
    { label: 'Gender', value: activeCallData.gender || '—' },
    { label: 'Tobacco Use', value: activeCallData.tobacco ? 'Yes (Smoker)' : 'No (Non-Smoker)' },
    { label: 'Height', value: activeCallData.heightFeet ? `${activeCallData.heightFeet} ft ${activeCallData.heightInches || 0} in` : '—' },
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
    { label: 'Coverage Amount', value: formatCurrency(activeCallData.selectedCoverage), highlight: true },
    { label: 'Monthly Premium', value: formatCurrency(activeCallData.selectedPremium), highlight: true },
  ];

  const bankInfo = [
    { label: 'Account Holder Name', value: activeCallData.accountHolder || '—' },
    { label: 'Bank Name', value: activeCallData.bankName || '—' },
    { label: 'Bank Location', value: activeCallData.bankCityState || '—' },
    { label: 'Routing Number', value: activeCallData.routingNumber || '—' },
    { label: 'Account Number', value: activeCallData.accountNumber ? '••••' + String(activeCallData.accountNumber).slice(-4) : '—' },
    { label: 'Account Type', value: activeCallData.accountType || '—' },
    { label: 'SS Payment Schedule', value: activeCallData.ssPaymentSchedule ? 'Yes' : activeCallData.ssPaymentSchedule === false ? 'No' : '—' },
    { label: 'Draft Day', value: activeCallData.draftDay || '—' },
    { label: 'SS Payment Day', value: activeCallData.ssPaymentDay || '—' },
  ];

  const existingCoverage = [
    { label: 'Has Existing Insurance', value: activeCallData.hasExistingInsurance ? 'Yes' : activeCallData.hasExistingInsurance === false ? 'No' : '—' },
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
    { id: 'healthQ1', label: 'Q1: Hospitalization, nursing, oxygen, cancer, ADL assistance', val: activeCallData.healthQ1 },
    { id: 'healthQ2', label: 'Q2: Organ transplant, CHF, Alzheimer\'s, ALS, terminal illness', val: activeCallData.healthQ2 },
    { id: 'healthQ3', label: 'Q3: Tested positive or treated for AIDS/HIV', val: activeCallData.healthQ3 },
    { id: 'healthQ4', label: 'Q4: Diabetes complications or insulin before age 50', val: activeCallData.healthQ4 },
    { id: 'healthQ5', label: 'Q5: Kidney disease, dialysis, or multiple cancers', val: activeCallData.healthQ5 },
    { id: 'healthQ6', label: 'Q6: Pending diagnostic tests, biopsies, or surgeries', val: activeCallData.healthQ6 },
    { id: 'healthQ7a', label: 'Q7a: 2yr stroke, COPD, liver disease/cirrhosis, oxygen use', val: activeCallData.healthQ7a },
    { id: 'healthQ7b', label: 'Q7b: 2yr heart attack, aneurysm, heart/circulatory surgery', val: activeCallData.healthQ7b },
    { id: 'healthQ7c', label: 'Q7c: 2yr cancer treatment (chemo, radiation, surgery)', val: activeCallData.healthQ7c },
    { id: 'healthQ7d', label: 'Q7d: 2yr drug or alcohol abuse/treatment', val: activeCallData.healthQ7d },
    { id: 'healthQ8a', label: 'Q8a: 3yr heart/circulatory issues or vascular surgery', val: activeCallData.healthQ8a },
    { id: 'healthQ8b', label: 'Q8b: 3yr cancer, COPD, chronic liver disease', val: activeCallData.healthQ8b },
    { id: 'healthQ8c', label: 'Q8c: 3yr paralysis, MS, seizures, Parkinson\'s disease', val: activeCallData.healthQ8c },
    { id: 'healthCovid', label: 'COVID: Hospitalization or lingering medical complications', val: activeCallData.healthCovid },
  ];

  const renderGridSection = (title: string, items: Array<{ label: string; value: any; highlight?: boolean }>, icon: React.ReactNode) => {
    return (
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center space-x-2 pb-2 border-b border-border">
          {icon}
          <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-foreground">{title}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="space-y-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">{item.label}</span>
              <span className={`text-xs font-mono font-medium block truncate ${item.highlight ? 'text-primary font-semibold' : 'text-foreground'}`} title={String(item.value)}>
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
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary">Carrier</span>
          <span className="text-xl font-bold font-mono tracking-wide text-foreground mt-2">
            {activeCallData.selectedCarrier || 'Not Selected'}
          </span>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary">Coverage</span>
          <span className="text-xl font-bold font-mono tracking-wide text-foreground mt-2">
            {formatCurrency(activeCallData.selectedCoverage)}
          </span>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary">Monthly Premium</span>
          <span className="text-xl font-bold font-mono tracking-wide text-primary mt-2">
            {formatCurrency(activeCallData.selectedPremium)}
          </span>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary">Plan Type</span>
          <span className="text-xl font-bold font-mono tracking-wide text-foreground mt-2">
            {activeCallData.selectedPlanType || 'Level'}
          </span>
        </div>
      </div>

      {/* Sections */}
      {renderGridSection('Personal Information', personalInfo, <User className="w-4 h-4 text-primary" />)}
      {renderGridSection('Address & Location', addressInfo, <Phone className="w-4 h-4 text-primary" />)}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderGridSection('Beneficiary Details', beneficiaryInfo, <Briefcase className="w-4 h-4 text-primary" />)}
        {renderGridSection('Existing Insurance', existingCoverage, <FileText className="w-4 h-4 text-primary" />)}
      </div>

      {renderGridSection('Bank Draft & SS Details', bankInfo, <Briefcase className="w-4 h-4 text-primary" />)}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderGridSection('Physician Details', doctorInfo, <User className="w-4 h-4 text-primary" />)}
        {activeCallData.hospitalizationReason && (
          <div className="bg-card border border-border rounded-xl p-5 space-y-2">
            <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-foreground pb-2 border-b border-border">Hospitalization Reason</h3>
            <p className="text-xs font-mono text-foreground whitespace-pre-wrap">{String(activeCallData.hospitalizationReason)}</p>
          </div>
        )}
      </div>

      {/* Health Questions Answers */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center space-x-2 pb-2 border-b border-border">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="text-xs font-mono uppercase tracking-widest font-bold text-foreground">Health Questions Log</h3>
        </div>
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {healthQMap.map((q) => (
            <div key={q.id} className="flex items-center justify-between py-2 border-b border-border/50 text-xs">
              <span className="text-muted-foreground font-mono truncate mr-4" title={q.label}>
                {q.label}
              </span>
              <div className="flex-shrink-0">
                {q.val === true ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                    <AlertTriangle className="w-3 h-3 mr-1" /> YES
                  </span>
                ) : q.val === false ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> NO
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">
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
