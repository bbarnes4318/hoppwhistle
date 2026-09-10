import { FilePlus2, Headphones, Settings } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

import type { AgentStatus, SelectedScript } from './types';

interface CallCenterHeaderProps {
  agentStatus: AgentStatus;
  setAgentStatus: (status: AgentStatus) => void;
  isCallActive: boolean;
  isIncomingCall: boolean;
  isAdminOrOwner: boolean;
  rolesLoading: boolean;
  derivedJobTitle: string;
  canAccessRetentionScript: boolean;
  selectedScript: SelectedScript;
  setSelectedScript: (script: SelectedScript) => void;
  callTimer: number;
  formatTime: (seconds: number) => string;
  setShowSettings: (show: boolean) => void;
  /**
   * Open the application form with no call attached, for business written on a
   * callback outside a softphone session. Without it that business is written
   * and never counted, which understates the agency's closing percentage.
   */
  onLogApplication: () => void;
  onExit: () => void;
}

/**
 * The console's call state, resolved to one of four readings.
 *
 * ── Why this is the biggest thing on the screen ─────────────────────────────
 *
 * An agent sits at this page for eight hours and a floor lead reads it from
 * across a desk. The one fact either of them needs at a glance is whether the
 * agent is on a call, waiting for one, ringing, or away — so that fact is
 * rendered once, large, in the call-state colour, and nothing else in the
 * header competes with it. The controls that change it sit beside it, quiet.
 *
 * The colours are the call-state signals, not the brand: a connected call is
 * --live because that is what --live means, an incoming call is --ringing, and
 * "away" is --blocked because it is a deliberate stop rather than a failure.
 * Brand green appears nowhere in this header.
 */
function callState(
  isIncomingCall: boolean,
  isCallActive: boolean,
  agentStatus: AgentStatus
): { label: string; className: string; dot: string; pulse: boolean } {
  if (isIncomingCall) {
    return {
      label: 'Incoming call',
      className: 'bg-ringing-tint text-ringing-ink',
      dot: 'bg-ringing',
      pulse: true,
    };
  }
  if (isCallActive) {
    return {
      label: 'On call',
      className: 'bg-live-tint text-live-ink',
      dot: 'bg-live',
      pulse: false,
    };
  }
  if (agentStatus === 'away') {
    return {
      label: 'Away',
      className: 'bg-blocked-tint text-blocked-ink',
      dot: 'bg-blocked',
      pulse: false,
    };
  }
  return {
    label: 'Available',
    className: 'bg-sunken text-ink',
    dot: 'bg-live',
    pulse: false,
  };
}

const CONTROL =
  'h-8 cursor-pointer appearance-none rounded-control border border-rule bg-surface pl-2.5 pr-7 t-meta font-medium uppercase tracking-wide text-ink-2 hover:border-rule-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function CallCenterHeader({
  agentStatus,
  setAgentStatus,
  isCallActive,
  isIncomingCall,
  isAdminOrOwner: _isAdminOrOwner,
  rolesLoading,
  derivedJobTitle,
  canAccessRetentionScript,
  selectedScript,
  setSelectedScript,
  callTimer,
  formatTime,
  setShowSettings,
  onLogApplication,
  onExit,
}: CallCenterHeaderProps) {
  const state = callState(isIncomingCall, isCallActive, agentStatus);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-rule bg-surface px-4">
      {/* The state. One block, readable from across a desk. */}
      <div
        role="status"
        aria-live="polite"
        data-call-state={state.label.toLowerCase().replace(/\s+/g, '-')}
        className={cn(
          'flex h-10 min-w-[12rem] items-center gap-3 rounded-card px-4',
          state.className
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            state.dot,
            state.pulse && 'animate-pulse'
          )}
        />
        <span className="t-title uppercase tracking-[0.08em]">{state.label}</span>
        {isCallActive && (
          <span className="t-figure ml-auto pl-3 tabular" aria-label="Call duration">
            {formatTime(callTimer)}
          </span>
        )}
      </div>

      {/* The controls that change it. */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="agent-status">
          Agent status
        </label>
        <select
          id="agent-status"
          value={agentStatus}
          onChange={e => setAgentStatus(e.target.value as AgentStatus)}
          disabled={isCallActive || isIncomingCall}
          className={CONTROL}
        >
          <option value="available">Available</option>
          <option value="away">Away</option>
          <option value="on_call">On call</option>
        </select>

        <label className="sr-only" htmlFor="call-script">
          Call script
        </label>
        <select
          id="call-script"
          value={selectedScript}
          onChange={e => setSelectedScript(e.target.value as SelectedScript)}
          className={CONTROL}
          title="Select call script"
        >
          <option value="hvac">HVAC</option>
          <option value="sales">Contractor</option>
          {canAccessRetentionScript && <option value="retention">Retention</option>}
          <option value="underwriting">Underwriting</option>
          <option value="verification">Verification</option>
          <option value="cold_call_transfer">Cold call transfer</option>
          <option value="better_plan_callback">Better plan callback</option>
        </select>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 t-meta text-ink-3 md:flex">
          <Headphones aria-hidden className="h-3.5 w-3.5" />
          {rolesLoading ? '…' : derivedJobTitle}
        </span>
        <button
          type="button"
          onClick={onLogApplication}
          className="flex items-center gap-1.5 rounded-control border border-rule px-2.5 py-1.5 t-meta font-medium text-ink-2 hover:border-rule-strong hover:bg-sunken hover:text-ink focus-visible:outline-none"
          title="Record business written on a callback, with no call attached"
        >
          <FilePlus2 aria-hidden className="h-3.5 w-3.5" />
          Log an application
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="rounded-control p-1.5 text-ink-3 hover:bg-sunken hover:text-ink focus-visible:outline-none"
          title="Settings"
          aria-label="Console settings"
        >
          <Settings aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded-control px-2 py-1 t-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none"
        >
          Exit console
        </button>
      </div>
    </header>
  );
}
