'use client';

import { AlertTriangle, X, Phone, Shield, FileCheck, DollarSign } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatCurrency, formatPhoneNumber } from '@/lib/utils';

import type { RetentionPolicy } from './RetentionDashboard';

// ============================================================================
// Types
// ============================================================================

interface GuaranteedIssueModalProps {
  policy: RetentionPolicy;
  onClose: () => void;
}

// ============================================================================
// Guaranteed Issue Script
// ============================================================================

const GI_SCRIPT = `Hi [CUSTOMER_NAME], this is [AGENT_NAME] calling from [COMPANY].

I'm following up on your recent life insurance application. Unfortunately, the underwriters were unable to approve coverage at this time based on the health information provided.

However, I have GREAT news for you!

We have a Guaranteed Issue policy that CANNOT be declined - you're automatically approved regardless of your health history.

Here's what makes this policy special:
• Guaranteed acceptance - No health questions
• Coverage from $2,000 to $25,000
• Premiums locked in for life
• Coverage begins immediately for accidental death
• Full coverage after a 2-year waiting period

The monthly premium for $[COVERAGE_AMOUNT] in coverage would be approximately $[PREMIUM_ESTIMATE].

Would you like me to get you enrolled right now so you can have peace of mind knowing your loved ones are protected?`;

// ============================================================================
// Component
// ============================================================================

export function GuaranteedIssueModal({ policy, onClose }: GuaranteedIssueModalProps): JSX.Element {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Generate personalized script
  const personalizedScript = GI_SCRIPT.replace(
    '[CUSTOMER_NAME]',
    policy.lead?.firstName || policy.lead?.fullName || 'Customer'
  )
    .replace('[AGENT_NAME]', 'your agent')
    .replace('[COMPANY]', 'your company')
    .replace('[COVERAGE_AMOUNT]', formatCurrency(policy.coverage || 15000))
    .replace('[PREMIUM_ESTIMATE]', formatCurrency((policy.monthlyPremium || 50) * 1.25));

  const handleLogCall = async () => {
    setIsSubmitting(true);
    // TODO: API call to log the call attempt with notes
    await new Promise(resolve => setTimeout(resolve, 500));
    setIsSubmitting(false);
    onClose();
  };

  const handleConvertToGI = async () => {
    setIsSubmitting(true);
    // TODO: API call to convert policy to GI
    await new Promise(resolve => setTimeout(resolve, 500));
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full max-w-2xl mx-4',
          'bg-gradient-to-b from-slate-900 to-slate-950',
          'rounded-2xl border border-red-500/30 shadow-2xl shadow-red-500/10',
          'overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200'
        )}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-red-500/20 bg-red-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h2 className="text-white text-lg font-semibold">
                  Guaranteed Issue Offer Required
                </h2>
                <p className="text-red-400 text-sm">Policy declined - Read GI script to customer</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Customer Info */}
        <div className="px-6 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Phone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-white font-medium">
                  {policy.lead?.fullName || 'Unknown Customer'}
                </h3>
                <p className="text-gray-400 text-sm">
                  {formatPhoneNumber(policy.lead?.phoneNumber || '')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <p className="text-gray-500">Original Coverage</p>
                <p className="text-white font-semibold">{formatCurrency(policy.coverage || 0)}</p>
              </div>
              <div className="text-center">
                <p className="text-gray-500">Carrier</p>
                <p className="text-white font-semibold">{policy.carrier || 'N/A'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Script */}
        <div className="px-6 py-4 max-h-[300px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h4 className="text-white font-medium">GI Sales Script</h4>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-gray-300 text-sm whitespace-pre-line leading-relaxed">
              {personalizedScript}
            </p>
          </div>
        </div>

        {/* Notes */}
        <div className="px-6 py-4 border-t border-white/10">
          <label className="text-gray-400 text-sm mb-2 block">Call Notes</label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Enter any notes about the call..."
            className="bg-white/5 border-white/10 text-white placeholder:text-gray-500"
            rows={3}
          />
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-4">
          <Button variant="outline" onClick={onClose} className="border-white/10">
            Cancel
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleLogCall}
              disabled={isSubmitting}
              className="gap-2"
            >
              <FileCheck className="w-4 h-4" />
              Log Call Attempt
            </Button>
            <Button
              onClick={handleConvertToGI}
              disabled={isSubmitting}
              className="gap-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500"
            >
              <DollarSign className="w-4 h-4" />
              Convert to GI Policy
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GuaranteedIssueModal;
