import { Headphones, Settings } from 'lucide-react';
import React from 'react';

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
  onExit: () => void;
}

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
  onExit,
}: CallCenterHeaderProps) {
  return (
    <div className="bg-card border-b border-border px-6 py-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Headphones className="w-5 h-5 text-muted-foreground" />
            <h1 className="text-sm font-bold uppercase tracking-widest text-foreground">
              Operator Console
            </h1>
          </div>

          <select
            value={agentStatus}
            onChange={e => setAgentStatus(e.target.value as AgentStatus)}
            disabled={isCallActive || isIncomingCall}
            className="appearance-none bg-muted text-foreground text-xs uppercase tracking-widest pl-3 pr-8 py-1.5 rounded border border-border focus:border-primary focus:outline-none cursor-pointer disabled:opacity-50"
          >
            <option value="available">Available</option>
            <option value="away">Away</option>
            <option value="on_call">On Call</option>
          </select>

          {/* User Role Badge */}
          <span className="px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground font-mono bg-muted border border-border rounded">
            {rolesLoading ? '...' : derivedJobTitle}
          </span>

          {/* Script Selector */}
          <select
            value={selectedScript}
            onChange={e => setSelectedScript(e.target.value as SelectedScript)}
            className="appearance-none bg-muted text-foreground text-xs uppercase tracking-widest pl-3 pr-8 py-1.5 rounded border border-border focus:border-primary focus:outline-none cursor-pointer"
            title="Select call script"
          >
            <option value="sales">Contractor</option>
            {canAccessRetentionScript && <option value="retention">Retention</option>}
            <option value="underwriting">Underwriting</option>
            <option value="verification">Verification</option>
            <option value="cold_call_transfer">Cold Call Transfer</option>
            <option value="better_plan_callback">Better Plan Callback</option>
          </select>
        </div>

        <div className="flex items-center space-x-4">
          {isCallActive && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-primary/10 border border-primary/30 rounded">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <span className="text-primary font-mono text-sm">{formatTime(callTimer)}</span>
            </div>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 bg-muted hover:bg-muted/80 rounded border border-border transition-colors text-muted-foreground"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={onExit}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors font-mono"
          >
            ← EXIT
          </button>
        </div>
      </div>
    </div>
  );
}
