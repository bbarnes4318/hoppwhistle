'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { usePhone, type AgentStatus } from './phone-provider';
import { FOCUS_RING, TOUCH_TARGET } from './softphone/parts';

// ============================================================================
// Agent Status Selector Component
// ============================================================================

interface StatusOption {
  value: AgentStatus;
  label: string;
  color: string;
  bgColor: string;
  description: string;
}

const statusOptions: StatusOption[] = [
  {
    value: 'available',
    label: 'Available',
    color: 'text-live-ink',
    bgColor: 'bg-live',
    description: 'Ready to receive calls',
  },
  {
    value: 'away',
    label: 'Away',
    color: 'text-dropped-ink',
    bgColor: 'bg-dropped',
    description: 'Temporarily unavailable',
  },
  {
    value: 'dnd',
    label: 'Do Not Disturb',
    color: 'text-blocked-ink',
    bgColor: 'bg-blocked',
    description: 'No calls or notifications',
  },
  {
    value: 'offline',
    label: 'Offline',
    color: 'text-ink-3',
    bgColor: 'bg-ink-3',
    description: 'Not logged in',
  },
];

export interface AgentStatusMenuProps {
  value: AgentStatus;
  /** A call is up: the status reads "On call" and cannot be changed. */
  onCall: boolean;
  onChange: (status: AgentStatus) => void;
  className?: string;
}

/**
 * The status pill and its menu, with no provider behind it — the softphone
 * feeds it from usePhone() and /design-preview feeds it a fixed value.
 */
export function AgentStatusMenu({
  value,
  onCall,
  onChange,
  className,
}: AgentStatusMenuProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentOption = statusOptions.find(opt => opt.value === value) ?? statusOptions[3];

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = useCallback(
    (status: AgentStatus) => {
      // A status change mid-call would tell routing something untrue about
      // the call in progress.
      if (onCall) return;
      onChange(status);
      setIsOpen(false);
    },
    [onCall, onChange]
  );

  return (
    <div
      className={cn('relative', className)}
      ref={dropdownRef}
      onKeyDown={e => {
        // Esc closes the menu, not the whole phone behind it.
        if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={onCall}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Your status: ${onCall ? 'On call' : currentOption.label}. Change status.`}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full border border-rule-strong bg-surface px-2.5',
          'text-xs font-medium transition-colors duration-150 ease-out ne-motion',
          'hover:bg-sunken disabled:cursor-default disabled:hover:bg-surface',
          FOCUS_RING,
          TOUCH_TARGET
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', onCall ? 'bg-live' : currentOption.bgColor)} />
        <span className={onCall ? 'text-live-ink' : currentOption.color}>
          {onCall ? 'On call' : currentOption.label}
        </span>
        {!onCall && (
          <ChevronDown
            className={cn(
              'h-3 w-3 text-ink-3 transition-transform duration-150 ne-motion',
              isOpen && 'rotate-180'
            )}
            aria-hidden
          />
        )}
      </button>

      {isOpen && !onCall && (
        <div
          role="menu"
          aria-label="Set your status"
          className={cn(
            'absolute left-0 top-full z-50 mt-2 w-56',
            'overflow-hidden rounded-card border border-rule bg-surface shadow-pop',
            'animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none'
          )}
        >
          {statusOptions.map(option => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left',
                'transition-colors duration-150 ne-motion hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none',
                value === option.value && 'bg-brand-tint'
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', option.bgColor)} />
              <div>
                <p className={cn('text-sm font-medium', option.color)}>{option.label}</p>
                <p className="text-xs text-ink-3">{option.description}</p>
              </div>
              {value === option.value && (
                <Check className="ml-auto h-4 w-4 text-brand-ink" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentStatusSelector({ className }: { className?: string } = {}): JSX.Element {
  const { agentStatus, setAgentStatus, currentCall } = usePhone();
  const isOnCall = Boolean(currentCall && currentCall.state !== 'ended');

  return (
    <AgentStatusMenu
      value={agentStatus}
      onCall={isOnCall}
      onChange={setAgentStatus}
      className={className}
    />
  );
}

export default AgentStatusSelector;
