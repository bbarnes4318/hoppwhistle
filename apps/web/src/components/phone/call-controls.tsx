'use client';

import {
  Grid,
  Merge,
  Mic,
  MicOff,
  Pause,
  PhoneForwarded,
  PhoneOff,
  Play,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AddCallDialog } from './add-call-dialog';
import { CallTransferDialog } from './call-transfer-dialog';
import { usePhone } from './phone-provider';

import { cn } from '@/lib/utils';

// ============================================================================
// Control Button
// ============================================================================

type ControlTone = 'red' | 'amber' | 'cyan' | 'purple';

const toneStyles: Record<ControlTone, { ring: string; icon: string }> = {
  red: { ring: 'bg-red-500/20 border-red-500', icon: 'text-red-400' },
  amber: { ring: 'bg-amber-500/20 border-amber-500', icon: 'text-amber-400' },
  cyan: { ring: 'bg-cyan-500/20 border-cyan-500', icon: 'text-cyan-400' },
  purple: { ring: 'bg-purple-500/20 border-purple-500', icon: 'text-purple-400' },
};

interface ControlButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Renders the button in its "engaged" colour (muted, on hold, keypad open). */
  active?: boolean;
  disabled?: boolean;
  title?: string;
  tone?: ControlTone;
  pulse?: boolean;
}

function ControlButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  title,
  tone = 'red',
  pulse = false,
}: ControlButtonProps): JSX.Element {
  const styles = toneStyles[tone];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'flex flex-col items-center gap-1.5 min-w-0',
        'transition-transform duration-150',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:scale-105 active:scale-95'
      )}
    >
      <div
        className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center shrink-0',
          'border-2 transition-all duration-200',
          active
            ? styles.ring
            : 'bg-white/10 border-transparent hover:bg-white/15 hover:border-white/10'
        )}
      >
        <Icon
          className={cn('w-5 h-5', active ? styles.icon : 'text-white', pulse && 'animate-pulse')}
        />
      </div>
      <span className="text-[10px] leading-tight text-gray-400 truncate max-w-full">{label}</span>
    </button>
  );
}

// ============================================================================
// Call Controls Component
// ============================================================================

export function CallControls(): JSX.Element {
  const {
    currentCall,
    toggleMute,
    toggleHold,
    hangupCall,
    hasHeldCalls,
    canMerge,
    isMerging,
    mergeCalls,
  } = usePhone();
  const [showTransfer, setShowTransfer] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [showAddCall, setShowAddCall] = useState(false);

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

  // Handle merge
  const handleMerge = useCallback(() => {
    void mergeCalls();
  }, [mergeCalls]);

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMute, handleHold, handleTransfer]);

  if (!currentCall) return <></>;

  return (
    <>
      {/* Transfer Dialog */}
      {showTransfer && <CallTransferDialog onClose={() => setShowTransfer(false)} />}

      {/* Add Call Dialog — dials the third party itself via the phone context. */}
      {showAddCall && <AddCallDialog onClose={() => setShowAddCall(false)} />}

      <div className="space-y-4">
        {/* Controls grid.
            A wrapping 3-column grid rather than a single flex row: the phone
            panel is only 340px wide, and six 56px buttons plus gaps needed
            ~416px — which pushed Merge, the last button, off the right edge. */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-3 justify-items-center">
          <ControlButton
            icon={isMuted ? MicOff : Mic}
            label={isMuted ? 'Unmute' : 'Mute'}
            onClick={handleMute}
            active={isMuted}
          />

          <ControlButton
            icon={isOnHold ? Play : Pause}
            label={isOnHold ? 'Resume' : 'Hold'}
            onClick={handleHold}
            active={isOnHold}
            tone="amber"
          />

          <ControlButton icon={PhoneForwarded} label="Transfer" onClick={handleTransfer} />

          <ControlButton
            icon={Grid}
            label="Keypad"
            onClick={() => setShowKeypad(!showKeypad)}
            active={showKeypad}
            tone="cyan"
          />

          <ControlButton icon={UserPlus} label="Add Call" onClick={handleAddCall} />

          {/* Only shown once a second call exists, and only enabled once that
              call is answered — merging a ringing leg tears down both calls. */}
          {hasHeldCalls && (
            <ControlButton
              icon={Merge}
              label={isMerging ? 'Merging…' : canMerge ? 'Merge' : 'Ringing…'}
              onClick={handleMerge}
              active={canMerge}
              disabled={!canMerge}
              tone="purple"
              pulse={isMerging}
              title={
                canMerge
                  ? 'Merge both calls into a 3-way conference'
                  : 'Waiting for the added call to be answered'
              }
            />
          )}
        </div>

        {/* In-Call Keypad */}
        {showKeypad && <InCallKeypad />}

        {/* End Call Button */}
        <button
          onClick={handleHangup}
          className={cn(
            'w-full py-3.5 rounded-xl flex items-center justify-center gap-3',
            'bg-destructive hover:bg-destructive/90',
            'shadow-lg shadow-destructive/20',
            'transition-all duration-200 active:scale-[0.98]'
          )}
        >
          <PhoneOff className="w-5 h-5 text-white" />
          <span className="text-white font-semibold">End Call</span>
        </button>

        {/* Keyboard Hints */}
        <div className="text-center">
          <p className="text-gray-600 text-xs">
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">M</kbd> Mute{' '}
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">H</kbd> Hold{' '}
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-gray-500">T</kbd> Transfer
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
    <div className="grid grid-cols-3 gap-2 p-3 bg-white/5 rounded-xl">
      {digits.map(digit => (
        <button
          key={digit}
          onClick={() => sendDTMF(digit)}
          className={cn(
            'h-11 rounded-lg flex items-center justify-center',
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
