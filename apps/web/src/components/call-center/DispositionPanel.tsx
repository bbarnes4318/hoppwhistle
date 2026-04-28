import React, { useState } from 'react';

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

/** Dispositions that require or strongly prompt for a follow-up date/time */
const FOLLOW_UP_DISPOSITIONS = ['SET_APPOINTMENT', 'SET_CALLBACK', 'FOLLOW_UP'];

// ─── Badge Colors ────────────────────────────────────────────────────────────
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

// ─── Props ───────────────────────────────────────────────────────────────────

interface DispositionPanelProps {
  dispositionSaved: boolean;
  selectedDisposition: string;
  setSelectedDisposition: (d: string) => void;
  callNotes: string;
  setCallNotes: (n: string) => void;
  followUpDate: string;
  setFollowUpDate: (d: string) => void;
  followUpTime: string;
  setFollowUpTime: (t: string) => void;
  handleSaveDisposition: () => void;
  handleSkipDisposition: () => void;
  onDispositionSelect: (d: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DispositionPanel({
  dispositionSaved,
  selectedDisposition,
  setSelectedDisposition,
  callNotes,
  setCallNotes,
  followUpDate,
  setFollowUpDate,
  followUpTime,
  setFollowUpTime,
  handleSaveDisposition,
  handleSkipDisposition,
  onDispositionSelect,
}: DispositionPanelProps) {
  // If disposition is saved, show confirmation
  if (dispositionSaved) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background border border-border p-6 rounded">
        <div className="w-2 h-2 bg-primary mb-4" />
        <h3 className="text-sm font-mono uppercase tracking-widest text-primary mb-2">Disposition Logged</h3>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Awaiting next action</p>
      </div>
    );
  }

  const needsFollowUp = FOLLOW_UP_DISPOSITIONS.includes(selectedDisposition);
  const isFollowUpRequired = selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP';

  // Validate save: disposition required, follow-up date required for callback/follow-up
  const canSave =
    !!selectedDisposition &&
    (!isFollowUpRequired || (!!followUpDate && !!followUpTime));

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-background p-4">
      <h3 className="text-sm font-mono uppercase tracking-widest text-foreground pb-4 border-b border-border mb-4">
        Call Disposition
      </h3>

      {/* Disposition buttons */}
      <div className="space-y-2 mb-4">
        {DISPOSITIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              setSelectedDisposition(value);
              onDispositionSelect(value);
            }}
            className={
              'w-full p-3 rounded text-left text-xs font-mono uppercase tracking-widest transition-all border ' +
              (selectedDisposition === value
                ? (DISPOSITION_COLORS[value] || 'bg-primary/10 border-primary text-primary')
                : 'bg-card border-border text-muted-foreground hover:bg-muted')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Follow-Up Date/Time (for appointment, callback, follow-up) */}
      {needsFollowUp && (
        <div className="bg-card border border-border rounded p-4 mb-4 space-y-3">
          <h4 className="text-xs font-mono uppercase tracking-widest text-foreground pb-2 border-b border-border flex items-center gap-2">
            {selectedDisposition === 'SET_APPOINTMENT' ? '📅 Appointment Details' :
             selectedDisposition === 'SET_CALLBACK' ? '📞 Callback Schedule' :
             '📋 Follow-Up Schedule'}
            {isFollowUpRequired && (
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
        <div className="mb-4">
          <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1 block">
            Notes
          </label>
          <textarea
            value={callNotes}
            onChange={e => setCallNotes(e.target.value)}
            placeholder="Add call notes..."
            rows={3}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-foreground text-xs font-mono focus:outline-none focus:border-primary resize-none"
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-2">
        <button
          onClick={handleSaveDisposition}
          disabled={!canSave}
          className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          Save & Exit
        </button>
        <button
          onClick={handleSkipDisposition}
          className="w-full py-3 bg-card hover:bg-muted border border-border text-muted-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          Skip Entry
        </button>
      </div>
    </div>
  );
}
