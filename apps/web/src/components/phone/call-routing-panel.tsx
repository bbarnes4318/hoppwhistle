'use client';

import { Headset, Loader2, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle } from '@/components/domain';
import { formatUsPhone } from '@/components/team/roster-cells';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * "Where your calls ring", as a full panel on the agent's own pages (Today and
 * Account), where it cannot be missed.
 *
 * The same choice as `RingOnControl` in the softphone header, and the same
 * setting the agency's Agents page writes ("Ring on"):
 * `PUT /api/v1/agent/call-destination`. Renders nothing for somebody who is
 * not an agent (the read is refused).
 */
interface CallDestination {
  ringOn: 'softphone' | 'cell';
  cellForwardNumber: string | null;
}

type Choice = 'softphone' | 'cell';

export function CallRoutingPanel({ className }: { className?: string }): JSX.Element | null {
  const [current, setCurrent] = useState<CallDestination | null>(null);
  const [choice, setChoice] = useState<Choice>('softphone');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const adopt = useCallback((next: CallDestination) => {
    setCurrent(next);
    setChoice(next.ringOn === 'cell' && next.cellForwardNumber ? 'cell' : 'softphone');
    setDraft(next.cellForwardNumber ? formatUsPhone(next.cellForwardNumber) : '');
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiClient.get<CallDestination>('/api/v1/agent/call-destination');
        if (active && response.data) adopt(response.data);
      } catch {
        // Not an agent, or the endpoint refused: render nothing.
      }
    })();
    return () => {
      active = false;
    };
  }, [adopt]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (choice === 'cell' && trimmed === '') {
      setError('Enter your cell phone number.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await apiClient.put<CallDestination>('/api/v1/agent/call-destination', {
        cellForwardNumber: choice === 'cell' ? trimmed : null,
      });
      if (response.error || !response.data) {
        setError(response.error?.message ?? 'Could not save. Try again.');
        return;
      }
      adopt(response.data);
      setSaved(true);
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }, [adopt, choice, draft]);

  if (!current) return null;

  const storedCell = current.cellForwardNumber ? formatUsPhone(current.cellForwardNumber) : '';
  const dirty = choice !== current.ringOn || (choice === 'cell' && draft.trim() !== storedCell);

  return (
    <Panel className={className} data-call-routing>
      <PanelHeader>
        <PanelTitle>Where your calls ring</PanelTitle>
        <PanelDescription>
          {current.ringOn === 'cell' && storedCell
            ? `Your calls are ringing your cell phone, ${storedCell}.`
            : 'Your calls are ringing the softphone in this browser.'}
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="space-y-4">
        <div
          role="radiogroup"
          aria-label="Where your calls ring"
          className="grid gap-3 sm:grid-cols-2"
        >
          <OptionCard
            selected={choice === 'softphone'}
            onSelect={() => {
              setChoice('softphone');
              setSaved(false);
            }}
            icon={<Headset className="h-4 w-4" />}
            title="Softphone"
            detail="Calls ring in your browser while you are signed in."
          />
          <OptionCard
            selected={choice === 'cell'}
            onSelect={() => {
              setChoice('cell');
              setSaved(false);
            }}
            icon={<Smartphone className="h-4 w-4" />}
            title="My cell phone"
            detail="Calls ring your cell instead, and show the customer's number when the carrier allows it."
          />
        </div>

        {choice === 'cell' ? (
          <div className="space-y-1.5">
            <label htmlFor="call-routing-cell" className="t-meta text-ink-2">
              Your cell phone number (US)
            </label>
            <Input
              id="call-routing-cell"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              placeholder="(555) 555-5555"
              className="h-9 max-w-xs"
              disabled={saving}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Save
          </Button>
          {saved && !dirty ? (
            <span className="text-xs font-medium text-live-ink" role="status">
              Saved
            </span>
          ) : null}
          {error ? (
            <span className="text-xs font-medium text-dropped-ink" role="alert">
              {error}
            </span>
          ) : null}
        </div>

        <p className="t-meta text-ink-3">
          Calls only reach you while you are taking calls (the on/off switch on your phone).
        </p>
      </PanelBody>
    </Panel>
  );
}

function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-[44px] items-start gap-3 rounded-card border px-3 py-3 text-left',
        'transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-brand bg-brand-tint' : 'border-rule bg-surface hover:bg-paper'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-control',
          selected ? 'bg-brand text-white' : 'bg-paper text-ink-2'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="t-meta block text-ink-3">{detail}</span>
      </span>
    </button>
  );
}
