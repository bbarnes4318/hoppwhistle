'use client';

import { useState, useMemo } from 'react';
import { DollarSign, Check, X, Settings, ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getAllCarrierQuotes,
  formatCurrency,
  calculateAgeFromDOB,
} from '@/lib/call-center/quoteCalculator';
import { FACE_AMOUNT_OPTIONS, CARRIER_LOGOS, type ProspectData } from '@/lib/call-center/types';

// ============================================================================
// Quote Panel Component
// Displays carrier quotes based on prospect data
// ============================================================================

interface QuotePanelProps {
  prospectData: Partial<ProspectData>;
  onSelectQuote?: (carrier: string, planType: string, premium: number, faceAmount: number) => void;
  selectedCarrier?: string;
  compact?: boolean;
}

export function QuotePanel({
  prospectData,
  onSelectQuote,
  selectedCarrier,
  compact = false,
}: QuotePanelProps): JSX.Element {
  const [selectedFaceAmount, setSelectedFaceAmount] = useState(prospectData.faceAmount || 10000);
  const [showIneligible, setShowIneligible] = useState(false);
  const [sortBy, setSortBy] = useState<'price' | 'eligibility'>('price');

  // Calculate age from DOB or use provided age
  const age = useMemo(() => {
    if (prospectData.age && typeof prospectData.age === 'number') {
      return prospectData.age;
    }
    if (prospectData.dob) {
      return calculateAgeFromDOB(prospectData.dob);
    }
    return 0;
  }, [prospectData.age, prospectData.dob]);

  // Get gender
  const gender = prospectData.gender || 'male';

  // Get tobacco status
  const tobacco = prospectData.tobacco ?? false;

  // Calculate quotes
  const quotes = useMemo(() => {
    if (!age || age < 18) return [];

    return getAllCarrierQuotes({
      age,
      gender: gender as 'male' | 'female',
      tobacco,
      faceAmount: selectedFaceAmount,
    });
  }, [age, gender, tobacco, selectedFaceAmount]);

  // Split quotes into eligible and ineligible
  const eligibleQuotes = quotes.filter(q => q.isEligible && q.premium);
  const ineligibleQuotes = quotes.filter(q => !q.isEligible || !q.premium);

  // Sort eligible quotes
  const sortedEligibleQuotes = useMemo(() => {
    return [...eligibleQuotes].sort((a, b) => {
      if (sortBy === 'price') {
        return (a.premium || 999) - (b.premium || 999);
      }
      return 0;
    });
  }, [eligibleQuotes, sortBy]);

  // Handle quote selection
  const handleSelectQuote = (quote: (typeof quotes)[0]) => {
    if (quote.premium && onSelectQuote) {
      onSelectQuote(quote.carrier, quote.planType, quote.premium, selectedFaceAmount);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!age || age < 18) {
    return (
      <div className="p-6 text-center">
        <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-600" />
        <p className="text-gray-400">Enter prospect age to see quotes</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-2')}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" />
          <h3 className="text-white font-semibold">Carrier Quotes</h3>
        </div>

        {/* Sort Toggle */}
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortBy('price')}
            className={cn(
              'text-xs h-7',
              sortBy === 'price' ? 'bg-white/10 text-white' : 'text-gray-400'
            )}
          >
            💰 Price
          </Button>
        </div>
      </div>

      {/* Prospect Summary */}
      <div className="flex gap-4 text-sm text-gray-400 bg-slate-800/30 rounded-lg p-3">
        <span>
          Age: <strong className="text-white">{age}</strong>
        </span>
        <span>
          Gender: <strong className="text-white capitalize">{gender}</strong>
        </span>
        <span>
          Tobacco: <strong className="text-white">{tobacco ? 'Yes' : 'No'}</strong>
        </span>
      </div>

      {/* Face Amount Selector */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400">Coverage Amount</label>
        <div className="flex flex-wrap gap-2">
          {FACE_AMOUNT_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              variant="outline"
              size="sm"
              onClick={() => setSelectedFaceAmount(value)}
              className={cn(
                'text-xs h-8',
                'border-white/10 hover:bg-white/5',
                selectedFaceAmount === value && 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
              )}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Quote Grid */}
      <div className="space-y-2">
        {sortedEligibleQuotes.length > 0 ? (
          sortedEligibleQuotes.map(quote => (
            <button
              key={`${quote.carrier}-${quote.planType}`}
              onClick={() => handleSelectQuote(quote)}
              className={cn(
                'w-full p-3 rounded-lg text-left transition-all',
                'bg-slate-800/50 hover:bg-slate-700/50',
                'border border-transparent hover:border-white/10',
                selectedCarrier === quote.carrier && 'border-emerald-500/50 bg-emerald-500/10'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Carrier Logo Placeholder */}
                  <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-white">
                      {quote.carrier.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-medium">{quote.carrier}</p>
                    <p className="text-gray-400 text-sm">{quote.planType}</p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-emerald-400 font-bold text-lg">
                    {formatCurrency(quote.premium!)}
                  </p>
                  <p className="text-gray-500 text-xs">/month</p>
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="p-4 text-center bg-slate-800/30 rounded-lg">
            <X className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <p className="text-gray-400">No eligible carriers for this profile</p>
          </div>
        )}
      </div>

      {/* Ineligible Carriers */}
      {ineligibleQuotes.length > 0 && (
        <div className="border-t border-white/5 pt-4">
          <button
            onClick={() => setShowIneligible(!showIneligible)}
            className="flex items-center gap-2 text-gray-400 text-sm hover:text-white"
          >
            {showIneligible ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            {ineligibleQuotes.length} carrier(s) not eligible
          </button>

          {showIneligible && (
            <div className="mt-2 space-y-2">
              {ineligibleQuotes.map(quote => (
                <div
                  key={`${quote.carrier}-ineligible`}
                  className="p-3 rounded-lg bg-slate-900/50 opacity-50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">{quote.carrier}</span>
                    <span className="text-red-400 text-xs">{quote.eligibilityReason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected Quote Action */}
      {selectedCarrier && (
        <Button className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500">
          <Check className="w-4 h-4 mr-2" />
          Continue with {selectedCarrier}
        </Button>
      )}
    </div>
  );
}

export default QuotePanel;
