'use client';

import { Phone, Plus, X } from 'lucide-react';
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { usePhone } from './phone-provider';
import { normalizeThirdPartyNumber } from './softphone/format';

// ============================================================================
// Add Call Dialog
// ============================================================================
//
// Step one of a three-way call: the customer goes on hold and this number is
// dialled. When it answers, "Merge calls" joins everyone.
//
// This used to offer "Agents" and "Queues" tabs as well. Both were hard-coded
// demo data -- "John Smith, ext. 1001" dialled whatever happened to be
// registered at extension 1001, which is allocated platform-wide and so could
// be an agent at another agency, and the queue entries dialled "queue:q1",
// which nothing routes. Until there is a real directory behind them, a number
// is the one thing this can actually call.

interface AddCallDialogProps {
  onClose: () => void;
}

export function AddCallDialog({ onClose }: AddCallDialogProps): JSX.Element {
  const { addThirdParty } = usePhone();
  const [externalNumber, setExternalNumber] = useState('');
  const [touched, setTouched] = useState(false);

  const normalized = normalizeThirdPartyNumber(externalNumber);
  const showInvalid = touched && externalNumber.trim() !== '' && !normalized;

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      setTouched(true);
      if (!normalized) return;
      void addThirdParty(normalized);
      onClose();
    },
    [addThirdParty, normalized, onClose]
  );

  const handleExternalChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setExternalNumber(e.target.value);
  }, []);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={handleBackdropClick}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add to call"
    >
      {/* Backdrop: the same scrim as components/ui/dialog. */}
      <div
        className="absolute inset-0 bg-[rgba(16,24,40,0.45)] animate-in fade-in-0 duration-200 motion-reduce:animate-none"
        aria-hidden
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full sm:max-w-md sm:mx-4',
          'bg-surface max-h-[92dvh] overflow-y-auto',
          'rounded-t-[20px] sm:rounded-card border border-rule shadow-pop',
          'animate-in fade-in-0 slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200 motion-reduce:animate-none'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-rule flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-tint flex items-center justify-center">
              <Plus className="w-5 h-5 text-brand-ink" />
            </div>
            <div>
              <h2 className="text-ink text-lg font-semibold">Add to Call</h2>
              <p className="text-ink-3 text-sm">The customer is held while you dial</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <form className="p-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="add-call-number" className="block text-xs text-ink-3 mb-2">
              Phone Number
            </label>
            <Input
              id="add-call-number"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
              value={externalNumber}
              onChange={handleExternalChange}
              onBlur={() => setTouched(true)}
              placeholder="(555) 000-0000"
              aria-invalid={showInvalid}
              aria-describedby={showInvalid ? 'add-call-number-error' : undefined}
              className={cn(
                'bg-surface border-rule text-ink placeholder:text-ink-3',
                showInvalid && 'border-destructive'
              )}
            />
            {showInvalid ? (
              <p id="add-call-number-error" className="mt-2 text-xs text-destructive">
                Enter a 10-digit US phone number.
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={!externalNumber.trim()} className="w-full">
            <Phone className="w-4 h-4 mr-2" />
            Call {externalNumber.trim() || 'Number'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default AddCallDialog;
