'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * When one agent works.
 *
 * ── The two kinds of "not working" ───────────────────────────────────────────
 *
 * NO SCHEDULE means no hours are enforced: the agent is routable whenever
 * everything else allows it. That is how every agent starts, and it is what
 * "Remove schedule" returns them to.
 *
 * A schedule with NO DAYS SELECTED is an agent on leave, and it does stop calls
 * reaching them. The two produce opposite routing behaviour, so this dialog
 * keeps them visibly distinct rather than treating an empty form as "off".
 *
 * ── Overnight shifts are allowed on purpose ──────────────────────────────────
 *
 * An end time before the start time is a night shift (21:00 to 05:00), not a
 * mistake, and the server reads it as one. The form says so rather than
 * refusing it — a night shift is ordinary in this business, and rejecting it
 * would push the agency back to having no schedule at all.
 */

const DAYS = [
  { key: 'MON', label: 'Mon' },
  { key: 'TUE', label: 'Tue' },
  { key: 'WED', label: 'Wed' },
  { key: 'THU', label: 'Thu' },
  { key: 'FRI', label: 'Fri' },
  { key: 'SAT', label: 'Sat' },
  { key: 'SUN', label: 'Sun' },
] as const;

export interface AgentSchedule {
  days: string[];
  startTime: string;
  endTime: string;
}

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: { id: string; name: string; schedule: AgentSchedule | null } | null;
  /** The clock the times are written in. The agency's, never the browser's. */
  timeZone: string;
  onSaved: () => void;
}

export function ScheduleDialog({
  open,
  onOpenChange,
  agent,
  timeZone,
  onSaved,
}: ScheduleDialogProps): JSX.Element {
  const [days, setDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    setDays(agent.schedule?.days ?? ['MON', 'TUE', 'WED', 'THU', 'FRI']);
    setStartTime(agent.schedule?.startTime ?? '09:00');
    setEndTime(agent.schedule?.endTime ?? '17:00');
    setError(null);
  }, [agent]);

  const overnight = startTime > endTime;

  async function save(schedule: AgentSchedule | null): Promise<void> {
    if (!agent) return;
    setSaving(true);
    setError(null);
    try {
      /*
       * Clearing is its own verb, not a `null` body. `apiClient.put(url, null)`
       * sends NO body at all -- `null` is falsy -- so an endpoint that read a
       * null body as "clear" could not tell a well-formed clear from a
       * malformed request.
       */
      if (schedule === null) {
        await apiClient.delete(`/api/v1/agent-roster/${agent.id}/schedule`);
      } else {
        await apiClient.put(`/api/v1/agent-roster/${agent.id}/schedule`, schedule);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The schedule could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Working hours{agent ? ` — ${agent.name}` : ''}</DialogTitle>
          <DialogDescription>
            Calls are not routed to this agent outside these hours. Times are in{' '}
            <span className="font-medium">{timeZone}</span>, the agency&apos;s clock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Days</Label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {DAYS.map(day => {
                const on = days.includes(day.key);
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() =>
                      setDays(current =>
                        on ? current.filter(d => d !== day.key) : [...current, day.key]
                      )
                    }
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-accent'
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            {days.length === 0 ? (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                No days selected. This agent will be routed no calls at all — use &ldquo;Remove
                schedule&rdquo; instead if you want their hours left unrestricted.
              </p>
            ) : null}
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="schedule-start">Start</Label>
              <Input
                id="schedule-start"
                type="time"
                value={startTime}
                onChange={event => setStartTime(event.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="schedule-end">End</Label>
              <Input
                id="schedule-end"
                type="time"
                value={endTime}
                onChange={event => setEndTime(event.target.value)}
              />
            </div>
          </div>

          {overnight ? (
            <p className="text-xs text-muted-foreground">
              Overnight shift: {startTime} until {endTime} the next morning. The days above are the
              days it <span className="font-medium">starts</span> on.
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void save(null)}
            disabled={saving || !agent?.schedule}
            title="Stop enforcing hours for this agent"
          >
            Remove schedule
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save({ days, startTime, endTime })} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
