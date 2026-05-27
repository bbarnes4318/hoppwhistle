'use client';

import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  DISPOSITION_COLORS,
  FOLLOW_UP_DISPOSITIONS,
} from '@hopwhistle/shared';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePhone } from './phone-provider';

import { apiClient } from '@/lib/api';

// Build button list from shared constants
const DISPOSITION_BUTTONS = DISPOSITIONS.map(value => ({
  value,
  label: DISPOSITION_LABELS[value],
}));

// Button-specific colors (slightly different border weight for modal buttons)
const MODAL_DISPOSITION_COLORS: Record<string, string> = Object.fromEntries(
  DISPOSITIONS.map(d => [
    d,
    DISPOSITION_COLORS[d].replace(/border-\S+\/30/g, m => m.replace('/30', '/40')),
  ])
);

/**
 * Global Disposition Modal — renders as a fixed overlay when a softphone call
 * ends OUTSIDE of the Call Center Portal. Uses pendingDispositionCall from
 * PhoneProvider (not currentCall, which is cleared immediately on call end).
 */
export function GlobalDispositionModal() {
  const pathname = usePathname();
  const { pendingDispositionCall, clearPendingDispositionCall } = usePhone();

  const [open, setOpen] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track the last handled call to prevent duplicate prompts
  const handledCallIdsRef = useRef<Set<string>>(new Set());

  const resetAndClose = useCallback(() => {
    setOpen(false);
    setSelectedDisposition('');
    setNotes('');
    setFollowUpDate('');
    setFollowUpTime('');
    setSaved(false);
    setSaving(false);
    setSaveError(null);
    clearPendingDispositionCall();
  }, [clearPendingDispositionCall]);

  // Detect pending disposition → show modal if not on Call Center Portal
  useEffect(() => {
    const isOnCallCenter = pathname?.includes('/call-center');
    if (
      pendingDispositionCall &&
      !isOnCallCenter &&
      !handledCallIdsRef.current.has(pendingDispositionCall.callId)
    ) {
      setOpen(true);
    }
  }, [pendingDispositionCall, pathname]);

  const handleSave = useCallback(async () => {
    if (!selectedDisposition || !pendingDispositionCall) return;

    setSaving(true);
    setSaveError(null);

    let followUpAt: string | undefined;
    if (followUpDate && followUpTime) {
      followUpAt = new Date(`${followUpDate}T${followUpTime}`).toISOString();
    } else if (followUpDate) {
      followUpAt = new Date(`${followUpDate}T09:00:00`).toISOString();
    }

    try {
      const response = await apiClient.post('/api/v1/calls/disposition', {
        callId: pendingDispositionCall.callId,
        disposition: selectedDisposition,
        notes,
        duration: pendingDispositionCall.duration || 0,
        callerNumber: pendingDispositionCall.phoneNumber,
        direction: pendingDispositionCall.direction?.toUpperCase(),
        callSource: 'SOFTPHONE',
        followUpAt,
      });

      if (response.error) {
        throw new Error(response.error.message || 'Save failed');
      }

      // Mark as handled so it doesn't re-prompt
      handledCallIdsRef.current.add(pendingDispositionCall.callId);

      setSaved(true);
      setTimeout(() => {
        resetAndClose();
      }, 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save disposition');
    } finally {
      setSaving(false);
    }
  }, [
    selectedDisposition,
    notes,
    followUpDate,
    followUpTime,
    pendingDispositionCall,
    resetAndClose,
  ]);

  const handleSkip = useCallback(() => {
    if (pendingDispositionCall) {
      handledCallIdsRef.current.add(pendingDispositionCall.callId);
    }
    resetAndClose();
  }, [pendingDispositionCall, resetAndClose]);

  if (!open || !pendingDispositionCall) return null;

  const needsFollowUp = (FOLLOW_UP_DISPOSITIONS as readonly string[]).includes(selectedDisposition);
  const isRequired = selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP';
  const canSave = !!selectedDisposition && (!isRequired || (!!followUpDate && !!followUpTime));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {saved ? (
          <div className="p-12 flex flex-col items-center justify-center">
            <div className="w-3 h-3 bg-primary rounded-full mb-4 animate-pulse" />
            <h3 className="text-sm font-mono uppercase tracking-widest text-primary mb-1">
              Disposition Logged
            </h3>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
              Returning to workspace
            </p>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-mono uppercase tracking-widest text-foreground">
                Call Disposition
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingDispositionCall.phoneNumber} &bull;{' '}
                {pendingDispositionCall.direction === 'inbound' ? 'Inbound' : 'Outbound'} &bull;{' '}
                {pendingDispositionCall.duration}s
              </p>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Error banner */}
              {saveError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-400 font-mono">
                  ✕ {saveError}
                </div>
              )}

              {/* Disposition buttons */}
              <div className="space-y-2">
                {DISPOSITION_BUTTONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedDisposition(value)}
                    className={
                      'w-full p-3 rounded text-left text-xs font-mono uppercase tracking-widest transition-all border ' +
                      (selectedDisposition === value
                        ? MODAL_DISPOSITION_COLORS[value] ||
                          'bg-primary/10 border-primary text-primary'
                        : 'bg-background border-border text-muted-foreground hover:bg-muted')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Follow-up date/time */}
              {needsFollowUp && (
                <div className="bg-background border border-border rounded p-4 space-y-3">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-foreground pb-2 border-b border-border flex items-center gap-2">
                    {selectedDisposition === 'SET_APPOINTMENT'
                      ? '📅 Appointment Details'
                      : selectedDisposition === 'SET_CALLBACK'
                        ? '📞 Callback Schedule'
                        : '📋 Follow-Up Schedule'}
                    {isRequired && (
                      <span className="text-[10px] text-amber-400 normal-case tracking-normal">
                        (required)
                      </span>
                    )}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">
                        Date
                      </label>
                      <input
                        type="date"
                        value={followUpDate}
                        onChange={e => setFollowUpDate(e.target.value)}
                        className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-xs font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">
                        Time
                      </label>
                      <input
                        type="time"
                        value={followUpTime}
                        onChange={e => setFollowUpTime(e.target.value)}
                        className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-xs font-mono focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedDisposition && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Add call notes..."
                    rows={3}
                    className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-xs font-mono focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border space-y-2">
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={!canSave || saving}
                className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
              >
                {saving ? 'Saving...' : 'Save Disposition'}
              </button>
              <button
                onClick={handleSkip}
                disabled={saving}
                className="w-full py-2 text-muted-foreground font-mono uppercase tracking-widest text-xs hover:text-foreground transition-colors"
              >
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
