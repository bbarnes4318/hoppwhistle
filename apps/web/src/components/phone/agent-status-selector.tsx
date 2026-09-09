'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { usePhone, type AgentStatus } from './phone-provider';


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

export function AgentStatusSelector(): JSX.Element {
  const { agentStatus, setAgentStatus, currentCall } = usePhone();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get current status option
  const currentOption = statusOptions.find(opt => opt.value === agentStatus) ?? statusOptions[3];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle status selection
  const handleSelect = useCallback(
    (status: AgentStatus) => {
      // Don't allow status change during active call
      if (currentCall && currentCall.state !== 'ended') {
        return;
      }
      setAgentStatus(status);
      setIsOpen(false);
    },
    [currentCall, setAgentStatus]
  );

  // Check if on call
  const isOnCall = currentCall && currentCall.state !== 'ended';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={Boolean(isOnCall)}
        className={cn(
          'flex items-center gap-2 px-2 py-1 rounded-lg',
          'text-xs font-medium transition-all',
          'hover:bg-sunken',
          isOnCall && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className={cn('w-2 h-2 rounded-full', currentOption.bgColor)} />
        <span className={currentOption.color}>{isOnCall ? 'On Call' : currentOption.label}</span>
        {!isOnCall && (
          <ChevronDown
            className={cn('w-3 h-3 text-ink-3 transition-transform', isOpen && 'rotate-180')}
          />
        )}
      </button>

      {/* Dropdown */}
      {isOpen && !isOnCall && (
        <div
          className={cn(
            'absolute top-full left-0 mt-2 w-56 z-50',
            'bg-surface border border-rule rounded-card',
            'shadow-lg overflow-hidden',
            'animate-in fade-in-0 zoom-in-95 duration-150'
          )}
        >
          {statusOptions.map(option => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={cn(
                'w-full px-4 py-3 flex items-center gap-3 text-left',
                'hover:bg-sunken transition-colors',
                agentStatus === option.value && 'bg-brand-tint'
              )}
            >
              <span className={cn('w-2.5 h-2.5 rounded-full', option.bgColor)} />
              <div>
                <p className={cn('text-sm font-medium', option.color)}>{option.label}</p>
                <p className="text-xs text-ink-3">{option.description}</p>
              </div>
              {agentStatus === option.value && (
                <span className="ml-auto text-brand-ink text-xs">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentStatusSelector;
