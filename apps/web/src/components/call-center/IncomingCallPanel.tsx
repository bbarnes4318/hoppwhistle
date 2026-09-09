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
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-surface space-y-6">
      {/* Caller Info Header */}
      <div className="text-center w-full">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Phone className="w-3.5 h-3.5 text-ringing-ink" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-ringing-ink">
            Inbound Call
          </span>
        </div>
        <p className="text-2xl font-bold text-ink">
          {String(incomingCallData?.first_name ?? '')} {String(incomingCallData?.last_name ?? '')}
        </p>
        <p className="text-ink-2 font-mono text-lg mt-1">
          {String(incomingCallData?.caller_id ?? '')}
        </p>
        {!!(incomingCallData?.city || incomingCallData?.state) && (
          <p className="text-ink-2 text-xs uppercase tracking-widest mt-2">
            {[incomingCallData.city, incomingCallData.state].filter(Boolean).join(', ')}
          </p>
        )}
      </div>

      {/* Ring Duration */}
      <p className="text-ink-2 font-mono text-xs">
        {`T-${String(Math.floor(Number(ringDuration) / 60)).padStart(2, '0')}:${String(Number(ringDuration) % 60).padStart(2, '0')}`}
      </p>

      {/* Lead Source */}
      {!!(incomingCallData as Record<string, unknown>)?.lead_source && (
        <div className="px-3 py-1 bg-sunken border border-rule rounded">
          <span className="text-ink-2 font-mono text-[10px] uppercase tracking-widest">
            SOURCE: {String((incomingCallData as Record<string, unknown>).lead_source)}
          </span>
        </div>
      )}

      {/* Action Hierarchy */}
      <div className="w-full flex flex-col gap-3 mt-4">
        <button
          onClick={handleAnswerCall}
          className="w-full py-3 bg-brand hover:bg-brand-ink hover:text-surface text-ink font-mono uppercase tracking-widest text-xs rounded transition-colors flex items-center justify-center gap-2"
        >
          <Phone className="w-4 h-4" />
          <span>Accept</span>
        </button>
        <button
          onClick={handleDeclineCall}
          className="w-full py-3 bg-dropped-tint hover:opacity-90 border border-dropped text-dropped-ink font-mono uppercase tracking-widest text-xs rounded transition-colors flex items-center justify-center gap-2"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Decline</span>
        </button>
      </div>

      {/* Subdued Keyboard Hints */}
      <p className="text-ink-3 text-[10px] font-mono uppercase tracking-widest mt-4">
        [A] Accept · [D] Decline
      </p>
    </div>
  );
}
