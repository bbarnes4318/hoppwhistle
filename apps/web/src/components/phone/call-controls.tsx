'use client';

import { Grid, Mic, MicOff, Pause, PhoneForwarded, PhoneOff, Play, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AddCallDialog } from './add-call-dialog';
import { CallTransferDialog } from './call-transfer-dialog';
import { usePhone } from './phone-provider';

import { cn } from '@/lib/utils';

// ============================================================================
// Call Controls Component
// ============================================================================

export function CallControls(): JSX.Element {
  const { currentCall, toggleMute, toggleHold, hangupCall } = usePhone();
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAddCall, setShowAddCall] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);

  const isMuted = currentCall?.isMuted ?? false;
  const isOnHold = currentCall?.isOnHold ?? false;

  // Handle mute toggle
  const handleMute = useCallback(() => {
    toggleMute();
  }, [toggleMute]);

  // Handle hold toggle
  const handleHold = useCallback(() => {
    void toggleHold();
  }, [toggleHold]);

  // Handle hangup
  const handleHangup = useCallback(() => {
    void hangupCall();
  }, [hangupCall]);

  // Handle transfer
  const handleTransfer = useCallback(() => {
    setShowTransfer(true);
  }, []);

  // Handle add call
  const handleAddCall = useCallback(() => {
    setShowAddCall(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'm':
          handleMute();
          break;
        case 'h':
          handleHold();
          break;
        case 't':
          handleTransfer();
          break;
        case 'a':
          handleAddCall();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMute, handleHold, handleTransfer, handleAddCall]);

  if (!currentCall) return <></>;

  return (
    <>
      {/* Transfer Dialog - rendered via portal to avoid parent overflow:hidden */}
      {showTransfer &&
        typeof document !== 'undefined' &&
        createPortal(<CallTransferDialog onClose={() => setShowTransfer(false)} />, document.body)}

      {/* Add Call Dialog - rendered via portal */}
      {showAddCall &&
        typeof document !== 'undefined' &&
        createPortal(<AddCallDialog onClose={() => setShowAddCall(false)} />, document.body)}

      {/* Controls Grid */}
      <div className="space-y-4">
        {/* Main Controls */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          {/* Mute Button */}
          <button
            onClick={handleMute}
            className={cn(
              'group relative flex flex-col items-center gap-1.5',
              'transition-transform hover:scale-105 active:scale-95'
            )}
          >
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center',
                'transition-all duration-200',
                isMuted
                  ? 'bg-red-500/20 border-2 border-red-500'
                  : 'bg-white/10 border-2 border-transparent hover:bg-white/15'
              )}
            >
              {isMuted ? (
                <MicOff className="w-6 h-6 text-red-400" />
              ) : (
                <Mic className="w-6 h-6 text-white" />
              )}
            </div>
            <span className="text-xs text-gray-400">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Hold Button */}
          <button
            onClick={handleHold}
            className={cn(
              'group relative flex flex-col items-center gap-1.5',
              'transition-transform hover:scale-105 active:scale-95'
            )}
          >
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center',
                'transition-all duration-200',
                isOnHold
                  ? 'bg-amber-500/20 border-2 border-amber-500'
                  : 'bg-white/10 border-2 border-transparent hover:bg-white/15'
              )}
            >
              {isOnHold ? (
                <Play className="w-6 h-6 text-amber-400" />
              ) : (
                <Pause className="w-6 h-6 text-white" />
              )}
            </div>
            <span className="text-xs text-gray-400">{isOnHold ? 'Resume' : 'Hold'}</span>
          </button>

          {/* Keypad Button */}
          <button
            onClick={() => setShowKeypad(!showKeypad)}
            className={cn(
              'group relative flex flex-col items-center gap-1.5',
              'transition-transform hover:scale-105 active:scale-95'
            )}
          >
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center',
                'transition-all duration-200',
                showKeypad
                  ? 'bg-cyan-500/20 border-2 border-cyan-500'
                  : 'bg-white/10 border-2 border-transparent hover:bg-white/15'
              )}
            >
              <Grid className="w-6 h-6 text-white" />
            </div>
            <span className="text-xs text-gray-400">Keypad</span>
          </button>
        </div>

        {/* Secondary Controls (Transfer, Add Call) */}
        <div className="flex items-center justify-center gap-4">
          {/* Transfer Button */}
          <button
            onClick={handleTransfer}
            className={cn(
              'group relative flex flex-col items-center gap-1.5',
              'transition-transform hover:scale-105 active:scale-95'
            )}
          >
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center',
                'bg-white/10 border-2 border-transparent hover:bg-white/15',
                'transition-all duration-200'
              )}
            >
              <PhoneForwarded className="w-6 h-6 text-white" />
            </div>
            <span className="text-xs text-gray-400">Transfer</span>
          </button>

          {/* Add Call Button */}
          <button
            onClick={handleAddCall}
            className={cn(
              'group relative flex flex-col items-center gap-1.5',
              'transition-transform hover:scale-105 active:scale-95'
            )}
          >
            <div
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center',
                'bg-white/10 border-2 border-transparent hover:bg-white/15',
                'transition-all duration-200'
              )}
            >
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <span className="text-xs text-gray-400">Add Call</span>
          </button>
        </div>

        {/* In-Call Keypad */}
        {showKeypad && <InCallKeypad />}

        {/* End Call Button */}
        <button
          onClick={handleHangup}
          className={cn(
            'w-full py-4 rounded-xl flex items-center justify-center gap-3',
            'bg-gradient-to-r from-red-500 to-red-600',
            'hover:from-red-400 hover:to-red-500',
            'shadow-lg shadow-red-500/25 hover:shadow-xl hover:shadow-red-500/30',
            'transition-all duration-200',
            'active:scale-98'
          )}
        >
          <PhoneOff className="w-6 h-6 text-white" />
          <span className="text-white font-semibold">End Call</span>
        </button>

        {/* Keyboard Hints */}
        <div className="text-center">
          <p className="text-gray-600 text-xs">
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">M</kbd> Mute{' '}
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">H</kbd> Hold{' '}
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">T</kbd> Transfer{' '}
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">A</kbd> Add
          </p>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// In-Call Keypad Component
// ============================================================================

function InCallKeypad(): JSX.Element {
  const { sendDTMF } = usePhone();

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div className="grid grid-cols-3 gap-2 p-4 bg-white/5 rounded-xl">
      {digits.map(digit => (
        <button
          key={digit}
          onClick={() => sendDTMF(digit)}
          className={cn(
            'h-12 rounded-lg flex items-center justify-center',
            'bg-white/5 hover:bg-white/10 active:bg-cyan-500/20',
            'text-white text-lg font-medium',
            'transition-all duration-150 active:scale-95'
          )}
        >
          {digit}
        </button>
      ))}
    </div>
  );
}

export default CallControls;
