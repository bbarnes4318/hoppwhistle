'use client';

import { Headset, Loader2, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { formatUsPhone } from '@/components/team/roster-cells';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The agent's own choice of where their calls ring: the softphone, or their
 * own cell phone.
 *
 * It writes the same setting the agency's Agents page writes ("Ring on"), so
 * either side sees the other's choice. Routing still holds a cell-forwarding
 * agent to their on/off switch, licence, schedule and busy checks, and credits
 * the answered call to them.
 */
interface CallDestination {
  ringOn: 'softphone' | 'cell';
  cellForwardNumber: string | null;
}

export function RingOnControl({ className }: { className?: string }): JSX.Element | null {
  const [current, setCurrent] = useState<CallDestination | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiClient.get<CallDestination>('/api/v1/agent/call-destination');
        if (active && response.data) setCurrent(response.data);
      } catch {
        // Not an agent, or the endpoint refused: render nothing.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setDraft(current?.cellForwardNumber ? formatUsPhone(current.cellForwardNumber) : '');
      setError(null);
    }
  }, [open, current]);

  const save = useCallback(async (cellForwardNumber: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put<CallDestination>('/api/v1/agent/call-destination', {
        cellForwardNumber,
      });
      if (response.error || !response.data) {
        setError(response.error?.message ?? 'Could not save');
        return;
      }
      setCurrent(response.data);
      setOpen(false);
    } catch {
      setError('Could not save');
    } finally {
      setSaving(false);
    }
  }, []);

  if (!current) return null;

  const onCell = current.ringOn === 'cell' && current.cellForwardNumber;
  const trimmed = draft.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium',
            onCell ? 'text-phone-ink' : 'text-ink-2',
            className
          )}
          title="Choose where your calls ring"
        >
          {onCell ? (
            <Smartphone className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Headset className="h-3.5 w-3.5" aria-hidden />
          )}
          {onCell
            ? `Ringing my cell · ${formatUsPhone(current.cellForwardNumber as string)}`
            : 'Ringing softphone'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="space-y-3">
        <div>
          <div className="text-sm font-semibold">Where should your calls ring?</div>
          <p className="t-meta mt-1 text-ink-3">
            Calls only reach you while you are taking calls. On your cell you&apos;ll see the
            customer&apos;s number when the carrier allows it.
          </p>
        </div>

        <form
          className="space-y-2"
          onSubmit={event => {
            event.preventDefault();
            if (trimmed !== '') void save(trimmed);
          }}
        >
          <label className="t-meta text-ink-2" htmlFor="ring-on-cell">
            My cell phone (US)
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="ring-on-cell"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder="(555) 555-5555"
              className="h-8"
              disabled={saving}
            />
            <Button type="submit" size="sm" className="h-8" disabled={saving || trimmed === ''}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Saving" />
              ) : (
                'Ring my cell'
              )}
            </Button>
          </div>
        </form>

        {onCell ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full"
            disabled={saving}
            onClick={() => void save(null)}
          >
            <Headset className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ring my softphone instead
          </Button>
        ) : null}

        {error ? (
          <div className="text-xs font-medium text-dropped-ink" role="alert">
            {error}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
