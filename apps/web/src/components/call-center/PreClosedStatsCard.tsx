import { User, Heart, Shield, DollarSign, TrendingDown, Award, Activity } from 'lucide-react';
import React from 'react';

interface PreClosedStatsCardProps {
  leadData: any;
}

export function PreClosedStatsCard({ leadData }: PreClosedStatsCardProps) {
  if (!leadData) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500 bg-slate-950/20 border border-white/5 rounded-xl">
        <Activity className="w-8 h-8 opacity-30 mb-2 animate-pulse" />
        <p className="text-xs font-mono">WAITING FOR PRECLOSED CALL DATA...</p>
      </div>
    );
  }

  // Safe field resolution helpers
  const firstName = leadData.firstName || leadData.first_name || '';
  const lastName = leadData.lastName || leadData.last_name || '';
  const fullName = leadData.fullName || `${firstName} ${lastName}`.trim() || 'Prospect';

  const age = leadData.age || leadData.customFields?.age || 'N/A';

  // Primary Beneficiary
  const beneficiaryName =
    leadData.customFields?.primaryBeneficiaryName || leadData.primaryBeneficiaryName || 'N/A';
  const relation =
    leadData.customFields?.primaryBeneficiaryRelationship ||
    leadData.primaryBeneficiaryRelationship ||
    leadData.relation ||
    'N/A';

  // Coverage
  const coverage =
    leadData.insurance?.coverageAmount ||
    leadData.coverageAmount ||
    leadData.faceAmount ||
    leadData.customFields?.coverageAmount;

  // Current Policy
  const currentCarrier =
    leadData.insurance?.carrier || leadData.carrier || leadData.customFields?.carrier || 'N/A';
  const currentPremium =
    leadData.insurance?.monthlyPremium ||
    leadData.monthlyPremium ||
    leadData.currentPremium ||
    leadData.customFields?.monthlyPremium;

  // Custom calculated fields from Python
  const amamQuote = leadData.customFields?.amamQuote;
  const amamSavings = leadData.customFields?.amamLessThanCurrent;

  const gtlQuote = leadData.customFields?.gtlQuote;
  const gtlSavings = leadData.customFields?.gtlLessThanCurrent;

  const cheapestCarrier = leadData.customFields?.cheapestCarrierUnderCurrent;
  const cheapestSavings = leadData.customFields?.savingsVsCurrent;

  // Formatting helpers
  const formatCurrency = (val: any) => {
    if (val === undefined || val === null || val === '') return 'N/A';
    const num = parseFloat(String(val));
    if (isNaN(num)) return val;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  };

  const formatSavings = (val: any) => {
    if (val === undefined || val === null || val === '') return null;
    const num = parseFloat(String(val));
    if (isNaN(num) || num <= 0) return null;
    return `-${formatCurrency(num)}`;
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in text-slate-100">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        <div className="rounded-lg bg-cyan-500/10 p-1.5 border border-cyan-500/20 text-cyan-400">
          <Shield className="h-4.5 w-4.5" />
        </div>
        <div>
          <h4 className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">
            PreClosed Portal Info
          </h4>
          <p className="text-[10px] text-slate-500">Live spreadsheet calculated premiums</p>
        </div>
      </div>

      {/* Profile Section */}
      <div className="grid grid-cols-2 gap-3 bg-slate-950/40 border border-white/5 rounded-xl p-3.5">
        <div className="col-span-2 flex items-center gap-2 border-b border-white/5 pb-2 mb-1">
          <User className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-200 truncate">{fullName}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-mono uppercase text-slate-500">Age Nearest (D)</span>
          <span className="text-sm font-bold text-slate-200 mt-0.5">{age}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-mono uppercase text-slate-500">Coverage (S)</span>
          <span className="text-sm font-bold text-slate-200 mt-0.5">
            {coverage ? formatCurrency(coverage) : 'N/A'}
          </span>
        </div>
      </div>

      {/* Beneficiary Section */}
      <div className="flex flex-col gap-2.5 bg-slate-950/40 border border-white/5 rounded-xl p-3.5">
        <div className="flex items-center gap-2 border-b border-white/5 pb-2">
          <Heart className="h-4 w-4 text-rose-400" />
          <span className="text-xs font-semibold text-slate-200">Beneficiary Details</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase text-slate-500">Name (N)</span>
            <span
              className="text-xs font-medium text-slate-300 mt-0.5 truncate"
              title={beneficiaryName}
            >
              {beneficiaryName}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase text-slate-500">Relation (O)</span>
            <span className="text-xs font-medium text-slate-300 mt-0.5 truncate" title={relation}>
              {relation}
            </span>
          </div>
        </div>
      </div>

      {/* Current Policy */}
      <div className="flex flex-col gap-2.5 bg-slate-950/40 border border-white/5 rounded-xl p-3.5">
        <div className="flex items-center gap-2 border-b border-white/5 pb-2">
          <DollarSign className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-200">Current Insurance Policy</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase text-slate-500">
              Current Carrier (R)
            </span>
            <span
              className="text-xs font-medium text-slate-300 mt-0.5 truncate"
              title={currentCarrier}
            >
              {currentCarrier}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono uppercase text-slate-500">Premium / mo (T)</span>
            <span className="text-xs font-bold text-rose-400 mt-0.5">
              {currentPremium ? formatCurrency(currentPremium) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Carrier Quotes */}
      <div className="flex flex-col gap-3 bg-slate-950/40 border border-white/5 rounded-xl p-3.5">
        <span className="text-xs font-semibold text-slate-200 border-b border-white/5 pb-2">
          Spreadsheet Quotes
        </span>

        {/* AmAm Quote */}
        <div className="flex items-center justify-between bg-slate-900/50 border border-white/5 rounded-lg p-2.5 transition-all hover:bg-slate-900">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-300">American Amicable</span>
            <span className="text-[10px] font-mono text-slate-500">Col AZ</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-slate-200">
              {amamQuote ? `${formatCurrency(amamQuote)}` : 'N/A'}
            </span>
            {formatSavings(amamSavings) && (
              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 animate-pulse">
                <TrendingDown className="h-3 w-3" />
                {formatSavings(amamSavings)}
              </span>
            )}
          </div>
        </div>

        {/* GTL Quote */}
        <div className="flex items-center justify-between bg-slate-900/50 border border-white/5 rounded-lg p-2.5 transition-all hover:bg-slate-900">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-300">Guarantee Trust Life</span>
            <span className="text-[10px] font-mono text-slate-500">Col BB</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-slate-200">
              {gtlQuote ? `${formatCurrency(gtlQuote)}` : 'N/A'}
            </span>
            {formatSavings(gtlSavings) && (
              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 animate-pulse">
                <TrendingDown className="h-3 w-3" />
                {formatSavings(gtlSavings)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cheapest Carrier Under Current */}
      {cheapestCarrier && cheapestSavings && parseFloat(String(cheapestSavings)) > 0 ? (
        <div className="flex flex-col gap-2.5 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/35 rounded-xl p-4 shadow-lg shadow-emerald-500/5 relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-3 -translate-y-3 opacity-10">
            <Award className="w-24 h-24 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            <Award className="h-4.5 w-4.5 text-emerald-400" />
            <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wide">
              Best Saving Option
            </span>
          </div>
          <div className="flex items-end justify-between mt-1">
            <div className="flex flex-col max-w-[60%]">
              <span className="text-[10px] font-mono uppercase text-emerald-500/70">
                Carrier (Col BD)
              </span>
              <span
                className="text-sm font-extrabold text-slate-100 truncate mt-0.5"
                title={cheapestCarrier}
              >
                {cheapestCarrier}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-mono uppercase text-emerald-500/70">
                Monthly Savings (Col BE)
              </span>
              <span className="text-base font-black text-emerald-400 mt-0.5">
                {formatSavings(cheapestSavings)} / mo
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-4 bg-slate-950/20 border border-white/5 rounded-xl text-slate-500">
          <TrendingDown className="w-5 h-5 opacity-40 mb-1" />
          <span className="text-[10px] font-mono uppercase">No Carrier Savings vs Current</span>
        </div>
      )}
    </div>
  );
}
