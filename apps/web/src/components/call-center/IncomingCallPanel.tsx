import { Phone, PhoneOff } from 'lucide-react';
import React from 'react';
import type { ProspectData } from './types';

interface IncomingCallPanelProps {
  incomingCallData: ProspectData | null;
  ringDuration: number;
  handleAnswerCall: () => void;
  handleDeclineCall: () => void;
}

export function IncomingCallPanel({
  incomingCallData,
  ringDuration,
  handleAnswerCall,
  handleDeclineCall,
}: IncomingCallPanelProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background space-y-6">
      {/* Caller Info Header */}
      <div className="text-center w-full">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Phone className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Inbound Call</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {String(incomingCallData?.first_name ?? '')} {String(incomingCallData?.last_name ?? '')}
        </p>
        <p className="text-muted-foreground font-mono text-lg mt-1">
          {String(incomingCallData?.caller_id ?? '')}
        </p>
        {!!(incomingCallData?.city || incomingCallData?.state) && (
          <p className="text-muted-foreground text-xs uppercase tracking-widest mt-2">
            {[incomingCallData.city, incomingCallData.state].filter(Boolean).join(', ')}
          </p>
        )}
      </div>

      {/* Ring Duration */}
      <p className="text-muted-foreground font-mono text-xs">
        {`T-${String(Math.floor(Number(ringDuration) / 60)).padStart(2, '0')}:${String(Number(ringDuration) % 60).padStart(2, '0')}`}
      </p>

      {/* Lead Source */}
      {!!(incomingCallData as Record<string, unknown>)?.lead_source && (
        <div className="px-3 py-1 bg-muted border border-border rounded">
          <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
            SOURCE: {String((incomingCallData as Record<string, unknown>).lead_source)}
          </span>
        </div>
      )}

      {/* Action Hierarchy */}
      <div className="w-full flex flex-col gap-3 mt-4">
        <button
          onClick={handleAnswerCall}
          className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors flex items-center justify-center gap-2"
        >
          <Phone className="w-4 h-4" />
          <span>Accept</span>
        </button>
        <button
          onClick={handleDeclineCall}
          className="w-full py-3 bg-card hover:bg-muted border border-border text-muted-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors flex items-center justify-center gap-2"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Decline</span>
        </button>
      </div>

      {/* Subdued Keyboard Hints */}
      <p className="text-muted-foreground/50 text-[10px] font-mono uppercase tracking-widest mt-4">
        [A] Accept · [D] Decline
      </p>
    </div>
  );
}
