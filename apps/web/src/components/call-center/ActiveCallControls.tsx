import { Circle, Merge, Mic, MicOff, Pause, PhoneForwarded, PhoneOff, Play, UserPlus } from 'lucide-react';
import React, { useState } from 'react';
import type { ProspectData } from './types';

interface ActiveCallControlsProps {
  activeCallData: ProspectData | null;
  isMuted: boolean;
  isOnHold: boolean;
  toggleMute: () => void;
  toggleHold: () => void;
  isAddingThirdParty: boolean;
  setIsAddingThirdParty: (adding: boolean) => void;
  thirdPartyConnected: boolean;
  handleHangup: () => void;
  makeCall: (num: string) => Promise<void>;
  callNotes: string;
  setCallNotes: (notes: string) => void;
  hasHeldCalls: boolean;
  mergeCalls: () => Promise<void>;
}

export function ActiveCallControls({
  activeCallData,
  isMuted,
  isOnHold,
  toggleMute,
  toggleHold,
  isAddingThirdParty,
  setIsAddingThirdParty,
  thirdPartyConnected,
  handleHangup,
  makeCall,
  callNotes,
  setCallNotes,
  hasHeldCalls,
  mergeCalls,
}: ActiveCallControlsProps) {
  const [showTransferPanel, setShowTransferPanel] = useState(false);
  const [transferNumber, setTransferNumber] = useState('');

  return (
    <div className="flex-1 p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col min-h-0 m-2">
      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        <div className="text-center mb-6 pt-2">
          <p className="text-xl font-bold uppercase tracking-widest text-foreground truncate">
            {String(activeCallData?.first_name || activeCallData?.firstName || '')}{' '}
            {String(activeCallData?.last_name || activeCallData?.lastName || '')}
          </p>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            {String(activeCallData?.caller_id || activeCallData?.phone || '')}
          </p>
          <div className="flex items-center justify-center space-x-2 mt-2">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            <span className="text-green-500 font-mono text-xs uppercase tracking-widest">Connected</span>
          </div>
        </div>

        {/* Call Controls */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            onClick={toggleMute}
            className={
              'px-2 py-3 rounded flex flex-col items-center border transition-all ' +
              (isMuted
                ? 'bg-destructive/20 border-destructive hover:bg-destructive/30'
                : 'bg-card border-border hover:bg-muted')
            }
          >
            {isMuted ? (
              <MicOff className="w-4 h-4 text-destructive" />
            ) : (
              <Mic className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2">Mute</span>
          </button>
          <button
            onClick={toggleHold}
            className={
              'px-2 py-3 rounded flex flex-col items-center border transition-all ' +
              (isOnHold
                ? 'bg-amber-500/20 border-amber-500 hover:bg-amber-500/30'
                : 'bg-card border-border hover:bg-muted')
            }
          >
            {isOnHold ? (
              <Play className="w-4 h-4 text-amber-500" />
            ) : (
              <Pause className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2">Hold</span>
          </button>
          <div
            className="px-2 py-3 rounded flex flex-col items-center border border-border bg-card cursor-default"
            title="Recording is handled automatically"
          >
            <Circle className="w-4 h-4 text-red-500 fill-red-500 animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-2">Rec</span>
          </div>
        </div>

        {/* Merge Button (Only appears when there is a held call) */}
        {hasHeldCalls && (
          <div className="mb-4">
            <button
              onClick={() => void mergeCalls()}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-mono uppercase tracking-widest text-sm rounded flex items-center justify-center space-x-2 transition-colors shadow-lg shadow-purple-600/20"
            >
              <Merge className="w-4.5 h-4.5" />
              <span>Merge Calls</span>
            </button>
          </div>
        )}

        {/* 3-Way / Transfer Buttons */}
        {!isAddingThirdParty && !thirdPartyConnected && !hasHeldCalls && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setIsAddingThirdParty(true)}
              className="p-2 rounded bg-card border border-border hover:bg-muted flex flex-col items-center transition-all"
            >
              <UserPlus className="w-4 h-4 text-muted-foreground" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">Add 3rd Party</span>
            </button>
            <button
              onClick={() => setShowTransferPanel(!showTransferPanel)}
              className="p-2 rounded bg-card border border-border hover:bg-muted flex flex-col items-center transition-all"
            >
              <PhoneForwarded className="w-4 h-4 text-muted-foreground" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">Transfer</span>
            </button>
          </div>
        )}

        {/* Warm Transfer Panel */}
        {showTransferPanel && (
          <div className="bg-muted border border-border rounded p-3 mb-4">
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Transfer Destination</h4>
            <input
              type="tel"
              value={transferNumber}
              onChange={(e) => setTransferNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="Phone number..."
              className="w-full bg-card border border-border rounded px-2 py-1.5 text-foreground font-mono text-sm mb-3 focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (transferNumber && transferNumber.length >= 10) {
                    void makeCall(transferNumber);
                    setShowTransferPanel(false);
                    setTransferNumber('');
                  }
                }}
                className="flex-1 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-mono uppercase tracking-widest text-[10px] rounded transition-colors"
              >
                Transfer
              </button>
              <button
                onClick={() => setShowTransferPanel(false)}
                className="flex-1 py-1.5 bg-card border border-border hover:bg-muted text-foreground font-mono uppercase tracking-widest text-[10px] rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Agent & Agency Info Card */}
        <div className="bg-muted/40 border border-border/60 rounded p-3 mb-4 flex-shrink-0">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Agent & Agency Info</h4>
          <div className="text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Agency:</span>
              <span className="text-white font-medium">American Beneficiary LLC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Agent:</span>
              <span className="text-white font-medium">Yazzyl Vasquez</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Agent ID:</span>
              <span className="text-white font-mono font-medium">MLSR181715</span>
            </div>
          </div>
        </div>

        {/* Live Call Notes Section */}
        <div className="flex flex-col min-h-[140px] mb-4 flex-shrink-0">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Live Call Notes</h4>
          <textarea
            value={callNotes}
            onChange={(e) => setCallNotes(e.target.value)}
            placeholder="Type call notes here..."
            className="flex-1 w-full bg-card border border-border rounded p-2 text-sm text-white placeholder:text-muted-foreground/30 resize-none focus:outline-none focus:border-primary min-h-[120px]"
          />
        </div>
      </div>

      {/* Pinned Action Area */}
      <div className="pt-4 border-t border-border mt-auto flex-shrink-0">
        <button
          onClick={handleHangup}
          className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-mono uppercase tracking-widest text-sm rounded flex items-center justify-center space-x-2 transition-colors shadow-lg shadow-red-600/20"
        >
          <PhoneOff className="w-4 h-4" />
          <span>End Call</span>
        </button>
      </div>
    </div>
  );
}
