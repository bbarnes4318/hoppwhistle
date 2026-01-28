'use client';

import React, { useState, useMemo } from 'react';
import { Check, Star, Crown, Shield, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getAllCarrierQuotes,
  formatCurrency,
  calculateAgeFromDOB,
} from '@/lib/call-center/quoteCalculator';
import type { ProspectData } from '@/lib/call-center/types';

// ============================================================================
// Three-Option Quote Display - "High / Mid / Low" Presentation
// Golden Path Script: +10.3% lift from offering multiple options
// ============================================================================

interface QuoteOption {
  tier: 'high' | 'mid' | 'low';
  faceAmount: number;
  premium: number;
  carrier: string;
  planType: string;
}

interface ThreeOptionQuoteDisplayProps {
  prospectData: Partial<ProspectData>;
  onSelectOption: (option: QuoteOption) => void;
  selectedOption?: QuoteOption | null;
  className?: string;
}

export function ThreeOptionQuoteDisplay({
  prospectData,
  onSelectOption,
  selectedOption,
  className,
}: ThreeOptionQuoteDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Calculate age
  const age = useMemo(() => {
    if (prospectData.age && typeof prospectData.age === 'number') {
      return prospectData.age;
    }
    if (prospectData.dob) {
      return calculateAgeFromDOB(prospectData.dob);
    }
    return 0;
  }, [prospectData.age, prospectData.dob]);

  // Get gender and tobacco
  const gender = (prospectData.gender || 'male') as 'male' | 'female';
  const tobacco = prospectData.tobacco ?? false;

  // Generate three options (high / mid / low coverage)
  const options = useMemo<QuoteOption[]>(() => {
    if (!age || age < 18) return [];

    // Define coverage tiers
    const coverageAmounts = {
      high: prospectData.faceAmount ? Math.round(prospectData.faceAmount * 1.5) : 15000,
      mid: prospectData.faceAmount || 10000,
      low: prospectData.faceAmount ? Math.round(prospectData.faceAmount * 0.7) : 7500,
    };

    // Normalize to standard amounts
    const normalizedAmounts = {
      high: Math.min(50000, Math.round(coverageAmounts.high / 2500) * 2500),
      mid: Math.round(coverageAmounts.mid / 2500) * 2500,
      low: Math.max(5000, Math.round(coverageAmounts.low / 2500) * 2500),
    };

    const tiers: ('high' | 'mid' | 'low')[] = ['high', 'mid', 'low'];
    const result: QuoteOption[] = [];

    for (const tier of tiers) {
      const quotes = getAllCarrierQuotes({
        age,
        gender,
        tobacco,
        faceAmount: normalizedAmounts[tier],
      });

      // Find best eligible quote for this tier
      const eligibleQuotes = quotes.filter(q => q.isEligible && q.premium);
      const bestQuote = eligibleQuotes.sort((a, b) => (a.premium || 999) - (b.premium || 999))[0];

      if (bestQuote && bestQuote.premium) {
        result.push({
          tier,
          faceAmount: normalizedAmounts[tier],
          premium: bestQuote.premium,
          carrier: bestQuote.carrier,
          planType: bestQuote.planType,
        });
      }
    }

    return result;
  }, [age, gender, tobacco, prospectData.faceAmount]);

  if (!age || age < 18 || options.length === 0) {
    return (
      <div className={cn('p-6 text-center bg-slate-800/30 rounded-lg', className)}>
        <p className="text-gray-400">Enter prospect details to see quote options</p>
      </div>
    );
  }

  const tierConfig = {
    high: {
      icon: Crown,
      label: 'Premium Coverage',
      color: 'amber',
      description: 'Maximum protection for your loved ones',
    },
    mid: {
      icon: Star,
      label: 'Recommended',
      color: 'emerald',
      description: 'Best value coverage',
    },
    low: {
      icon: Shield,
      label: 'Essential',
      color: 'blue',
      description: 'Affordable protection',
    },
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-white">Your Coverage Options</h3>
        <p className="text-gray-400 text-sm">Based on your qualification</p>
      </div>

      {/* Three Options Grid */}
      <div className="grid grid-cols-3 gap-3">
        {options.map(option => {
          const config = tierConfig[option.tier];
          const Icon = config.icon;
          const isSelected = selectedOption?.tier === option.tier;
          const isRecommended = option.tier === 'mid';

          return (
            <button
              key={option.tier}
              onClick={() => onSelectOption(option)}
              className={cn(
                'relative p-4 rounded-xl border-2 transition-all duration-200',
                'flex flex-col items-center text-center',
                isSelected
                  ? `border-${config.color}-500 bg-${config.color}-500/10 ring-2 ring-${config.color}-500/30`
                  : 'border-white/10 hover:border-white/20 bg-slate-800/50 hover:bg-slate-700/50',
                isRecommended && !isSelected && 'border-emerald-500/30'
              )}
            >
              {/* Recommended Badge */}
              {isRecommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
                  BEST VALUE
                </div>
              )}

              {/* Icon */}
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center mb-2',
                  `bg-${config.color}-500/20`
                )}
              >
                <Icon className={cn('w-5 h-5', `text-${config.color}-400`)} />
              </div>

              {/* Coverage Amount */}
              <p className="text-white font-bold text-lg">${option.faceAmount.toLocaleString()}</p>
              <p className="text-gray-400 text-xs mb-2">{config.label}</p>

              {/* Premium */}
              <div className={cn('text-2xl font-bold', `text-${config.color}-400`)}>
                {formatCurrency(option.premium)}
              </div>
              <p className="text-gray-500 text-xs">/month</p>

              {/* Selected Indicator */}
              {isSelected && (
                <div
                  className={cn(
                    'absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center',
                    `bg-${config.color}-500`
                  )}
                >
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Expand Details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center justify-center gap-1 w-full text-gray-400 text-sm hover:text-white transition-colors py-2"
      >
        {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {showDetails ? 'Hide' : 'Show'} carrier details
      </button>

      {/* Carrier Details */}
      {showDetails && (
        <div className="space-y-2 text-sm">
          {options.map(option => (
            <div
              key={option.tier}
              className="flex justify-between items-center px-3 py-2 bg-slate-800/30 rounded-lg"
            >
              <span className="text-gray-400">${option.faceAmount.toLocaleString()}</span>
              <span className="text-white">{option.carrier}</span>
              <span className="text-gray-400">{option.planType}</span>
            </div>
          ))}
        </div>
      )}

      {/* Selection Summary */}
      {selectedOption && (
        <div className="bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/20 rounded-lg p-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-emerald-400 font-semibold">
                Selected: {tierConfig[selectedOption.tier].label}
              </p>
              <p className="text-gray-400 text-sm">
                ${selectedOption.faceAmount.toLocaleString()} coverage •{' '}
                {formatCurrency(selectedOption.premium)}/mo
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Carrier Confirmation Component
// Shows selected carrier details and confirms the choice
// ============================================================================

interface CarrierConfirmationProps {
  carrier: string;
  planType: string;
  premium: number;
  faceAmount: number;
  beneficiary?: string;
  onConfirm: () => void;
  onChangeSelection: () => void;
  className?: string;
}

export function CarrierConfirmation({
  carrier,
  planType,
  premium,
  faceAmount,
  beneficiary,
  onConfirm,
  onChangeSelection,
  className,
}: CarrierConfirmationProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-xl font-bold text-white">Confirm Your Selection</h3>
        <p className="text-gray-400 text-sm">Review your coverage details</p>
      </div>

      {/* Coverage Summary Card */}
      <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/10 rounded-xl p-5 space-y-4">
        {/* Carrier */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Carrier</span>
          <span className="text-white font-semibold">{carrier}</span>
        </div>

        <div className="border-t border-white/5" />

        {/* Plan Type */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Plan Type</span>
          <span className="text-white">{planType}</span>
        </div>

        <div className="border-t border-white/5" />

        {/* Coverage Amount */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Coverage Amount</span>
          <span className="text-emerald-400 font-bold text-lg">${faceAmount.toLocaleString()}</span>
        </div>

        <div className="border-t border-white/5" />

        {/* Monthly Premium */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Monthly Premium</span>
          <span className="text-white font-bold text-lg">{formatCurrency(premium)}</span>
        </div>

        {beneficiary && (
          <>
            <div className="border-t border-white/5" />
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Beneficiary</span>
              <span className="text-white">{beneficiary}</span>
            </div>
          </>
        )}
      </div>

      {/* Script Prompt */}
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4">
        <p className="text-cyan-300 text-sm italic">
          "Just to confirm, you've selected {formatCurrency(premium)} per month for $
          {faceAmount.toLocaleString()}
          of whole life coverage with {carrier}.{' '}
          {beneficiary ? `Your beneficiary is ${beneficiary}.` : ''}
          Does that sound correct?"
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={onChangeSelection}
          className="flex-1 border-white/10 hover:bg-white/5"
        >
          Change Selection
        </Button>
        <Button
          onClick={onConfirm}
          className="flex-1 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500"
        >
          <Check className="w-4 h-4 mr-2" />
          Confirm & Continue
        </Button>
      </div>
    </div>
  );
}

export default ThreeOptionQuoteDisplay;
