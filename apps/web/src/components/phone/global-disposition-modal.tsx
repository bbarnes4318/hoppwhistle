'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePhone } from './phone-provider';

// ─── Canonical Disposition Values ────────────────────────────────────────────
const DISPOSITIONS = [
  { value: 'SET_APPOINTMENT', label: 'Set Appointment' },
  { value: 'SET_CALLBACK', label: 'Set Callback' },
  { value: 'FOLLOW_UP', label: 'Follow-Up' },
  { value: 'NOT_INTERESTED', label: 'Not Interested' },
  { value: 'NOT_QUALIFIED', label: 'Not Qualified' },
  { value: 'NO_ANSWER', label: 'No Answer' },
  { value: 'WRONG_NUMBER', label: 'Wrong Number' },
  { value: 'DISCONNECTED', label: 'Disconnected' },
] as const;

const FOLLOW_UP_DISPOSITIONS = ['SET_APPOINTMENT', 'SET_CALLBACK', 'FOLLOW_UP'];

const DISPOSITION_COLORS: Record<string, string> = {
  SET_APPOINTMENT: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
  SET_CALLBACK: 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400',
  FOLLOW_UP: 'bg-blue-500/10 border-blue-500/40 text-blue-400',
  NOT_INTERESTED: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
  NOT_QUALIFIED: 'bg-orange-500/10 border-orange-500/40 text-orange-400',
  NO_ANSWER: 'bg-slate-500/10 border-slate-500/40 text-slate-400',
  WRONG_NUMBER: 'bg-red-500/10 border-red-500/40 text-red-400',
  DISCONNECTED: 'bg-red-500/10 border-red-400/30 text-red-300',
};

/**
 * Global Disposition Modal — renders as a fixed overlay when a softphone call
 * ends OUTSIDE of the Call Center Portal.  The CallCenterPortal has its own
 * inline DispositionPanel; this modal prevents the need for duplicate logic.
 */
export function GlobalDispositionModal() {
  const pathname = usePathname();
  const { currentCall } = usePhone();

  const [open, setOpen] = useState(false);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [selectedDisposition, setSelectedDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [saved, setSaved] = useState(false);

  // Detect call ended → show modal if not already on Call Center Portal
  useEffect(() => {
    const isOnCallCenter = pathname?.includes('/call-center');
    if (
      currentCall?.state === 'ended' &&
      currentCall.callId !== lastCallId &&
      !isOnCallCenter
    ) {
      setLastCallId(currentCall.callId);
      setOpen(true);
    }
  }, [currentCall?.state, currentCall?.callId, lastCallId, pathname]);

  const handleSave = useCallback(() => {
    if (!selectedDisposition) return;

    let followUpAt: string | undefined;
    if (followUpDate && followUpTime) {
      followUpAt = new Date(`${followUpDate}T${followUpTime}`).toISOString();
    } else if (followUpDate) {
      followUpAt = new Date(`${followUpDate}T09:00:00`).toISOString();
    }

    // Fire-and-forget
    fetch('/api/v1/calls/disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: lastCallId,
        disposition: selectedDisposition,
        notes,
        duration: currentCall?.duration || 0,
        callerNumber: currentCall?.phoneNumber,
        callSource: 'SOFTPHONE',
        followUpAt,
      }),
    }).catch(() => {});

    setSaved(true);
    setTimeout(() => {
      resetAndClose();
    }, 1500);
  }, [selectedDisposition, notes, followUpDate, followUpTime, lastCallId, currentCall]);

  const resetAndClose = () => {
    setOpen(false);
    setSelectedDisposition('');
    setNotes('');
    setFollowUpDate('');
    setFollowUpTime('');
    setSaved(false);
  };

  if (!open) return null;

  const needsFollowUp = FOLLOW_UP_DISPOSITIONS.includes(selectedDisposition);
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
                Log the outcome of the call before continuing.
              </p>
            </div>

            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Disposition buttons */}
              <div className="space-y-2">
                {DISPOSITIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedDisposition(value)}
                    className={
                      'w-full p-3 rounded text-left text-xs font-mono uppercase tracking-widest transition-all border ' +
                      (selectedDisposition === value
                        ? (DISPOSITION_COLORS[value] || 'bg-primary/10 border-primary text-primary')
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
                    {selectedDisposition === 'SET_APPOINTMENT' ? '📅 Appointment Details' :
                     selectedDisposition === 'SET_CALLBACK' ? '📞 Callback Schedule' :
                     '📋 Follow-Up Schedule'}
                    {isRequired && (
                      <span className="text-[10px] text-amber-400 normal-case tracking-normal">(required)</span>
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
                onClick={handleSave}
                disabled={!canSave}
                className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
              >
                Save Disposition
              </button>
              <button
                onClick={resetAndClose}
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
