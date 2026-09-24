import { AlertTriangle, CheckCircle2, PhoneOff, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { AgentSchedule } from '@/components/agents/schedule-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { jurisdictionName } from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * The agent roster, and the three cells that read it.
 *
 * ── Why this is a module and not a page ──────────────────────────────────────
 *
 * It was a page: `/settings/agents`, beside `/settings/users`. Two screens, two
 * tables, and no answer to "which one do I open" -- the Users page listed
 * everybody including agents, and the Agents page listed the same agents again
 * with the controls that decide whether they can actually take a call. Somebody
 * adding a person had to know which door to use, and somebody wondering why an
 * agent was not ringing had to know the other one existed.
 *
 * They are one page now -- Team Members, at `/settings/users` -- and these
 * types and cells moved here so that page can render an agent row without
 * owning the roster's vocabulary. Nothing here talks to the network; the page
 * loads `/api/v1/agent-roster` and passes rows in.
 */

export interface RosterAgent {
  id: string;
  email: string;
  name: string;
  status: string;
  licensedStates: string[];
  extension: string | null;
  hasSipCredential: boolean;
  /**
   * `+1XXXXXXXXXX` when the agent takes calls on their own cell instead of the
   * softphone. Calls still route as this agent and are credited to them.
   */
  cellForwardNumber: string | null;
  maxConcurrentCalls: number;
  campaignIds: string[];
  /** Null means no hours are enforced. An empty `days` is an agent on leave. */
  schedule: AgentSchedule | null;
  softphoneStatus: string;
  /**
   * The agent's own on/off switch. Not `softphoneStatus`, which reports what
   * their browser is doing and is overwritten automatically on every
   * reconnect. This one is deliberate, durable, and the one routing obeys.
   */
  availableForCalls: boolean;
  availabilityChangedAt: string | null;
  blockedReason: string | null;
  /**
   * The same fact as `blockedReason`, machine-readable. Branch on this, never
   * on the sentence: the sentence is written to be read by a person and will
   * be reworded.
   */
  blockedBy:
    | 'INVITE_PENDING'
    | 'ACCOUNT_STATUS'
    | 'NO_LICENSED_STATES'
    | 'NO_CAMPAIGN'
    | 'NO_SOFTPHONE'
    | 'UNAVAILABLE'
    | null;
}

export interface RosterCampaign {
  id: string;
  name: string;
}

export interface Roster {
  agents: RosterAgent[];
  campaigns: RosterCampaign[];
  defaultMaxConcurrentCalls: number;
  /** The clock every schedule is written in. The agency's, never the browser's. */
  deliveryTimeZone: string;
}

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * A schedule at a glance.
 *
 * "Any time" and "No days" are opposite states and read as such: the first is
 * an agent whose hours are not enforced, which is how everyone starts; the
 * second is an agent on leave, who is routed nothing.
 */
export function ScheduleCell({ schedule }: { schedule: AgentSchedule | null }): JSX.Element {
  if (!schedule) {
    return <span className="text-xs text-muted-foreground">Any time</span>;
  }

  if (schedule.days.length === 0) {
    return (
      <span
        className="text-xs font-medium text-amber-700 dark:text-amber-300"
        title="No days selected, so this agent is routed no calls."
      >
        No days
      </span>
    );
  }

  const ordered = DAY_ORDER.filter(d => schedule.days.includes(d)).map(
    d => d[0] + d[1].toLowerCase()
  );
  const overnight = schedule.startTime > schedule.endTime;

  return (
    <div className="text-xs">
      <div className="font-medium">
        {schedule.startTime}–{schedule.endTime}
        {overnight ? <span className="ml-1 text-muted-foreground">+1</span> : null}
      </div>
      <div className="text-muted-foreground">{ordered.join(' ')}</div>
    </div>
  );
}

/** How a live softphone status reads, and what it means for the next call. */
const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  available: { label: 'Available', className: 'text-emerald-600 dark:text-emerald-400' },
  'on-call': { label: 'On a call', className: 'text-blue-600 dark:text-blue-400' },
  away: { label: 'Away', className: 'text-amber-600 dark:text-amber-400' },
  dnd: { label: 'Do not disturb', className: 'text-amber-600 dark:text-amber-400' },
  offline: { label: 'Offline', className: 'text-muted-foreground' },
};

export function RosterLicenceCell({ states }: { states: string[] }): JSX.Element {
  if (states.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
        title="No licence recorded. This agent is served no leads and routed no state-identified calls."
      >
        <AlertTriangle className="h-3 w-3" />
        None
      </span>
    );
  }

  const shown = states.slice(0, 4);
  const rest = states.length - shown.length;
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      title={states.map(jurisdictionName).join(', ')}
    >
      {shown.map(code => (
        <Badge key={code} variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
          {code}
        </Badge>
      ))}
      {rest > 0 ? <span className="text-xs text-muted-foreground">+{rest}</span> : null}
    </div>
  );
}

/**
 * The one cell somebody reads before doing anything else.
 *
 * A blocking reason outranks a live status: an agent who is "available" on a
 * softphone but assigned to no campaign is not available for anything, and
 * showing the green word would be the screen lying.
 */
export function ReadinessCell({ agent }: { agent: RosterAgent }): JSX.Element {
  /*
   * An agent who has turned their own phone off is not a problem to fix, and
   * the amber warning below would read as one. They are set up correctly and
   * have stepped away, so it is stated plainly, in the muted colour, and the
   * owner is told when -- which is the question they actually ask ("since
   * when?"), and the difference between a lunch break and somebody who went
   * off on Tuesday and never came back.
   *
   * This reads `blockedBy`, which the API only sets to UNAVAILABLE once every
   * SETUP blocker is clear. An agent who is off AND has no campaign still
   * shows the campaign, in amber: that one is the owner's to fix and will
   * still be there when the agent comes back.
   */
  if (agent.blockedBy === 'UNAVAILABLE') {
    const since = agent.availabilityChangedAt
      ? new Date(agent.availabilityChangedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        title={since ? `Turned their phone off ${since}` : 'Turned their phone off'}
      >
        <PhoneOff className="h-3.5 w-3.5 shrink-0" />
        Phone off{since ? ` · ${since}` : ''}
      </span>
    );
  }

  if (agent.blockedReason) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {agent.blockedReason}
      </span>
    );
  }

  /*
   * A forwarding agent has no softphone to be online, so its status would read
   * "Offline" while calls are in fact reaching them. Say where they ring.
   */
  if (agent.cellForwardNumber) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <Smartphone className="h-3.5 w-3.5 shrink-0" />
        Rings cell · {formatUsPhone(agent.cellForwardNumber)}
      </span>
    );
  }

  const style = STATUS_STYLES[agent.softphoneStatus] ?? STATUS_STYLES.offline;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', style.className)}>
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      {style.label}
    </span>
  );
}

/** `+18655551234` → `(865) 555-1234`; anything else is shown as stored. */
export function formatUsPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/**
 * Where the agent's calls ring: the softphone (empty) or their own cell.
 *
 * Saving is the page's job -- this module does not talk to the network -- so
 * `onSave` receives the typed number, or null to go back to the softphone. The
 * API validates and normalises it; its refusal comes back through the page's
 * own error notice.
 */
export function CellForwardField({
  agent,
  disabled,
  onSave,
}: {
  agent: RosterAgent;
  disabled?: boolean;
  onSave: (cellForwardNumber: string | null) => Promise<void>;
}): JSX.Element {
  const stored = agent.cellForwardNumber;
  const [draft, setDraft] = useState(stored ? formatUsPhone(stored) : '');

  useEffect(() => {
    setDraft(stored ? formatUsPhone(stored) : '');
  }, [stored]);

  const trimmed = draft.trim();
  const unchanged = trimmed === (stored ? formatUsPhone(stored) : '');

  return (
    <div className="space-y-1.5">
      <form
        className="flex items-center gap-2"
        onSubmit={event => {
          event.preventDefault();
          if (!unchanged) void onSave(trimmed === '' ? null : trimmed);
        }}
      >
        <Input
          type="tel"
          inputMode="tel"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Softphone"
          aria-label={`Cell number for ${agent.name}`}
          className="h-8 w-36"
          disabled={disabled}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8"
          disabled={disabled || unchanged}
        >
          Save
        </Button>
      </form>
      {stored ? (
        <button
          type="button"
          className="t-meta text-ink-3 underline-offset-2 hover:underline"
          onClick={() => void onSave(null)}
          disabled={disabled}
        >
          Ring the softphone instead
        </button>
      ) : (
        <div className="t-meta text-ink-3">Enter a cell to ring it instead</div>
      )}
    </div>
  );
}
