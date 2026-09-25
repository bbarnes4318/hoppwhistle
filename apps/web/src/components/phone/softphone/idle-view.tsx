import { History, Keyboard, Settings } from 'lucide-react';
import * as React from 'react';

import { Segmented, SegmentedItem } from '@/components/domain/segmented';
import { cn } from '@/lib/utils';

import { formatPhoneNumber } from './format';

/**
 * The softphone with no call: Keypad, Recent and Settings, one at a time.
 * Each tab's content is passed in, so the real panel and /design-preview put
 * their own behind the same frame.
 */
export type IdleTab = 'dialpad' | 'history' | 'settings';

const TABS: ReadonlyArray<{ id: IdleTab; label: string; Icon: typeof Keyboard }> = [
  { id: 'dialpad', label: 'Keypad', Icon: Keyboard },
  { id: 'history', label: 'Recent', Icon: History },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export interface IdleViewProps {
  tab: IdleTab;
  onTabChange: (tab: IdleTab) => void;
  /** Above the tabs, e.g. the matched customer. */
  lead?: React.ReactNode;
  children: React.ReactNode;
}

export function IdleView({ tab, onTabChange, lead, children }: IdleViewProps): JSX.Element {
  const baseId = React.useId();
  return (
    <div className="flex flex-col">
      {lead}
      <div className="px-4 pt-3">
        <Segmented role="tablist" aria-label="Phone" className="flex w-full">
          {TABS.map(({ id, label, Icon }) => (
            <SegmentedItem
              key={id}
              role="tab"
              id={`${baseId}-${id}`}
              aria-selected={tab === id}
              aria-controls={`${baseId}-panel`}
              active={tab === id}
              onClick={() => onTabChange(id)}
              className="h-8 flex-1 gap-1.5 text-[13px] [@media(pointer:coarse)]:min-h-[44px]"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${tab}`}
        className="px-4 pb-4 pt-3"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Which of the agency's numbers the call goes out from. Compact: it is set
 * once a shift, and the keypad is what the space is for.
 */
export function CallerIdSelect({
  numbers,
  value,
  onChange,
}: {
  numbers: ReadonlyArray<{ id: string; number: string }>;
  value: string | null;
  onChange: (value: string) => void;
}): JSX.Element | null {
  const id = React.useId();
  if (numbers.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="t-label shrink-0 text-ink-3">
        Calling from
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'h-8 min-w-0 flex-1 cursor-pointer rounded-control border border-rule-strong bg-surface px-2 font-mono text-[13px] text-ink',
          'transition-[border-color,box-shadow] duration-150 ease-out ne-motion hover:border-ink-3',
          'focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          '[@media(pointer:coarse)]:min-h-[44px]'
        )}
      >
        {numbers.map(num => (
          <option key={num.id} value={num.number}>
            {formatPhoneNumber(num.number)}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

/** Microphone, speaker, and the way into the screen-pop field picker. */
export function DeviceSettings({
  inputs,
  outputs,
  input,
  output,
  onInputChange,
  onOutputChange,
  onConfigureScreenPop,
}: {
  inputs: ReadonlyArray<DeviceOption>;
  outputs: ReadonlyArray<DeviceOption>;
  input: string | null;
  output: string | null;
  onInputChange: (id: string) => void;
  onOutputChange: (id: string) => void;
  onConfigureScreenPop?: () => void;
}): JSX.Element {
  const micId = React.useId();
  const speakerId = React.useId();
  const selectClass = cn(
    'h-10 w-full cursor-pointer rounded-control border border-rule-strong bg-surface px-3 text-sm text-ink',
    'transition-[border-color,box-shadow] duration-150 ease-out ne-motion hover:border-ink-3',
    'focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    '[@media(pointer:coarse)]:min-h-[44px]'
  );
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={micId} className="t-label mb-1.5 block text-ink-3">
          Microphone
        </label>
        <select
          id={micId}
          value={input ?? ''}
          onChange={e => onInputChange(e.target.value)}
          className={selectClass}
        >
          {inputs.length === 0 ? <option value="">Default microphone</option> : null}
          {inputs.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={speakerId} className="t-label mb-1.5 block text-ink-3">
          Speaker
        </label>
        <select
          id={speakerId}
          value={output ?? ''}
          onChange={e => onOutputChange(e.target.value)}
          className={selectClass}
        >
          {outputs.length === 0 ? <option value="">Default speaker</option> : null}
          {outputs.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      {onConfigureScreenPop ? (
        <div className="border-t border-rule pt-4">
          <p className="t-meta mb-2 text-ink-2">
            Choose which prospect details show when a call rings.
          </p>
          <button
            type="button"
            onClick={onConfigureScreenPop}
            className={cn(
              'inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-rule-strong bg-surface text-sm font-medium text-ink shadow-card hover:bg-sunken',
              'transition-colors duration-150 ease-out ne-motion',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
              '[@media(pointer:coarse)]:min-h-[44px]'
            )}
          >
            <Settings className="h-4 w-4" aria-hidden />
            Screen pop fields
          </button>
        </div>
      ) : null}
    </div>
  );
}
