import {
  DISPOSITIONS,
  DISPOSITION_LABELS,
  DISPOSITION_COLORS,
  FOLLOW_UP_DISPOSITIONS,
} from '@hopwhistle/shared';
import React from 'react';

import { ApplicationLogForm } from './ApplicationLogForm';
import type { ApplicationLogPayload, ApplicationLogPrefill } from './ApplicationLogForm';

// Build button list from shared constants
const DISPOSITION_BUTTONS = DISPOSITIONS.map(value => ({
  value,
  label: DISPOSITION_LABELS[value],
}));

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
  /** What the quote and the call already know, to prefill the application. */
  applicationPrefill?: ApplicationLogPrefill;
  /** The current application body, or null while the form is incomplete. */
  onApplicationChange: (payload: ApplicationLogPayload | null) => void;
  /**
   * Whether the application form is complete enough to send: carrier, face
   * amount, premium and last name. The owning screen holds the payload, so it
   * holds this too -- one fact rather than two that can disagree.
   */
  applicationReady?: boolean;
  /** Set when the last submit failed. The form stays filled; Save reads Retry. */
  applicationError?: string | null;
  /** True while the two posts are in flight. */
  savingApplication?: boolean;
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
  applicationPrefill,
  onApplicationChange,
  applicationReady = false,
  applicationError,
  savingApplication = false,
}: DispositionPanelProps) {
  // If disposition is saved, show confirmation
  if (dispositionSaved) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface border border-rule p-6 rounded">
        <div className="w-2 h-2 bg-live mb-4" />
        <h3 className="text-sm font-mono uppercase tracking-widest text-brand-ink mb-2">
          Disposition Logged
        </h3>
        <p className="text-xs font-mono text-ink-2 uppercase tracking-widest">
          Awaiting next action
        </p>
      </div>
    );
  }

  const needsFollowUp = (FOLLOW_UP_DISPOSITIONS as readonly string[]).includes(selectedDisposition);
  const isFollowUpRequired =
    selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP';
  const wroteApplication = selectedDisposition === 'APPLICATION_SUBMITTED';

  /*
   * Validate save: disposition required, follow-up date required for
   * callback/follow-up, and a complete application when the agent says they
   * submitted one.
   *
   * The last condition is the point of this panel's change. "Application
   * submitted" with nothing recorded is the failure this whole feature exists
   * to remove: an agent who believes they logged business, an agency whose
   * closing percentage never counted it, and a higher price for both.
   */
  const canSave =
    !!selectedDisposition &&
    (!isFollowUpRequired || (!!followUpDate && !!followUpTime)) &&
    (!wroteApplication || applicationReady) &&
    !savingApplication;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-surface p-4">
      <h3 className="text-sm font-mono uppercase tracking-widest text-ink pb-4 border-b border-rule mb-4">
        Call Disposition
      </h3>

      {/* Disposition buttons */}
      <div className="space-y-2 mb-4">
        {DISPOSITION_BUTTONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              setSelectedDisposition(value);
              onDispositionSelect(value);
            }}
            className={
              'w-full p-3 rounded text-left text-xs font-mono uppercase tracking-widest transition-all border ' +
              (selectedDisposition === value
                ? DISPOSITION_COLORS[value as keyof typeof DISPOSITION_COLORS] ||
                  'bg-brand-tint border-brand text-brand-ink'
                : 'bg-surface border-rule text-ink-2 hover:bg-sunken')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Follow-Up Date/Time (for appointment, callback, follow-up) */}
      {needsFollowUp && (
        <div className="bg-surface border border-rule rounded p-4 mb-4 space-y-3">
          <h4 className="text-xs font-mono uppercase tracking-widest text-ink pb-2 border-b border-rule flex items-center gap-2">
            {selectedDisposition === 'SET_APPOINTMENT'
              ? '📅 Appointment Details'
              : selectedDisposition === 'SET_CALLBACK'
                ? '📞 Callback Schedule'
                : '📋 Follow-Up Schedule'}
            {isFollowUpRequired && (
              <span className="text-[10px] text-ringing-ink normal-case tracking-normal">
                (required)
              </span>
            )}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-ink-2 mb-1 block">
                Date
              </label>
              <input
                type="date"
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
                className="w-full bg-sunken border border-rule rounded px-3 py-2 text-ink text-xs font-mono focus:outline-none focus:border-brand-ink"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-ink-2 mb-1 block">
                Time
              </label>
              <input
                type="time"
                value={followUpTime}
                onChange={e => setFollowUpTime(e.target.value)}
                className="w-full bg-sunken border border-rule rounded px-3 py-2 text-ink text-xs font-mono focus:outline-none focus:border-brand-ink"
              />
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {selectedDisposition && (
        <div className="mb-4">
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-2 mb-1 block">
            Notes
          </label>
          <textarea
            value={callNotes}
            onChange={e => setCallNotes(e.target.value)}
            placeholder="Add call notes..."
            rows={3}
            className="w-full bg-sunken border border-rule rounded px-3 py-2 text-ink text-xs font-mono focus:outline-none focus:border-brand-ink resize-none"
          />
        </div>
      )}

      {/* The application the agent wrote, on any carrier. */}
      {wroteApplication && (
        <div className="mb-4">
          <ApplicationLogForm
            prefill={applicationPrefill}
            onChange={onApplicationChange}
            error={applicationError}
            disabled={savingApplication}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-2">
        <button
          onClick={handleSaveDisposition}
          disabled={!canSave}
          className="w-full py-3 bg-brand hover:bg-brand-ink hover:text-surface disabled:bg-sunken disabled:text-ink-3 disabled:cursor-not-allowed text-ink font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          {savingApplication ? 'Saving…' : applicationError ? 'Retry save' : 'Save & Exit'}
        </button>
        <button
          onClick={handleSkipDisposition}
          disabled={savingApplication}
          className="w-full py-3 bg-surface hover:bg-sunken border border-rule text-ink-2 font-mono uppercase tracking-widest text-xs rounded transition-colors"
        >
          Skip Entry
        </button>
      </div>
    </div>
  );
}
