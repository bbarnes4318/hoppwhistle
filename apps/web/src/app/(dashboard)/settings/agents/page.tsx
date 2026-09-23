'use client';

import { AlertTriangle, CheckCircle2, Loader2, PhoneOff, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { InviteAgentDialog } from '@/components/agents/invite-agent-dialog';
import { ScheduleDialog, type AgentSchedule } from '@/components/agents/schedule-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LicensedStatesDialog } from '@/components/users/licensed-states-dialog';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { jurisdictionName } from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * The agency's agents, and whether each one can actually take a call.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * Setting an agent up meant four things in four places, and two of them had no
 * screen at all:
 *
 *   invite                 the generic Users page, whose token the owner then
 *                          hand-delivered
 *   licensed states        the Users page
 *   SIP identity           nowhere -- allocated silently on first softphone use
 *   a campaign to take     nowhere -- NetEnroll staff hand-built a BuyerEndpoint
 *   calls from             per agent, on a screen an agency cannot reach
 *
 * So an agency could add a user all day and that user would never ring, with
 * nothing on any screen saying why.
 *
 * ── One row answers "why is this agent not getting calls" ────────────────────
 *
 * That question has five different answers -- they never accepted the
 * invitation, no licence is recorded, they are on no campaign, they have never
 * opened the softphone, or they are simply offline right now -- and four of
 * them were invisible. The server computes the blocking one in order, because
 * granting a campaign to an agent with no licence changes nothing, and a screen
 * that listed all five would make somebody work out which to fix first.
 *
 * An agent with nothing blocking them shows their live softphone status
 * instead, which is the only thing left that decides whether the next call
 * rings.
 */

interface RosterAgent {
  id: string;
  email: string;
  name: string;
  status: string;
  licensedStates: string[];
  extension: string | null;
  hasSipCredential: boolean;
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

interface RosterCampaign {
  id: string;
  name: string;
}

interface Roster {
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
function ScheduleCell({ schedule }: { schedule: AgentSchedule | null }): JSX.Element {
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

function LicenceCell({ states }: { states: string[] }): JSX.Element {
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
function ReadinessCell({ agent }: { agent: RosterAgent }): JSX.Element {
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

  const style = STATUS_STYLES[agent.softphoneStatus] ?? STATUS_STYLES.offline;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', style.className)}>
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      {style.label}
    </span>
  );
}

export default function AgentRosterPage(): JSX.Element {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [licenceAgent, setLicenceAgent] = useState<RosterAgent | null>(null);
  const [scheduleAgent, setScheduleAgent] = useState<RosterAgent | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{ data: Roster }>('/api/v1/agent-roster');
      setRoster(response.data?.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The roster could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (platform.loading) return;
    /*
     * A roster belongs to one agency. /settings is reachable by NetEnroll staff
     * with no agency entered, and asking for one then is a request the server
     * refuses 409 — for a table that could never have rendered. Same shape as
     * the guard on the Users page.
     */
    if (withoutAgency) {
      setRoster(null);
      setLoading(false);
      return;
    }
    void load();
  }, [platform.loading, withoutAgency, load]);

  async function setCampaigns(agent: RosterAgent, campaignIds: string[]): Promise<void> {
    setSavingId(agent.id);
    try {
      await apiClient.put(`/api/v1/agent-roster/${agent.id}/campaigns`, { campaignIds });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assignment could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  async function setConcurrency(agent: RosterAgent, maxConcurrentCalls: number): Promise<void> {
    setSavingId(agent.id);
    try {
      await apiClient.patch(`/api/v1/agent-roster/${agent.id}`, { maxConcurrentCalls });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The setting could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  if (withoutAgency) {
    return (
      <div className="p-6">
        <p className="mt-2 text-muted-foreground">Select an agency to see its agents.</p>
      </div>
    );
  }

  const agents = roster?.agents ?? [];
  const campaigns = roster?.campaigns ?? [];
  /*
   * One campaign is the ordinary case for an agency, and "which campaigns does
   * this agent take" is then a question with one answer. It renders as a single
   * switch rather than a list of one checkbox.
   */
  const singleCampaign = campaigns.length === 1 ? campaigns[0] : null;
  const readyCount = agents.filter(a => !a.blockedReason).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-4 flex flex-shrink-0 items-start justify-between">
        <div>
          <p className="text-muted-foreground">
            {agents.length === 0
              ? 'Add the agents who work for your agency.'
              : `${readyCount} of ${agents.length} ready to take calls.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add agent
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {campaigns.length === 0 && !loading ? (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This agency has no active campaign, so there is nothing to assign an agent to yet.
          NetEnroll sets that up.
        </div>
      ) : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex-shrink-0">
          <CardTitle>Roster</CardTitle>
          <CardDescription>
            An agent takes calls once they have accepted their invitation, have their licensed
            states recorded, are assigned a campaign, and have opened the softphone once.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading
            </div>
          ) : agents.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <p>No agents yet.</p>
              <p className="text-sm">Add one and they will be emailed a link to set up.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Taking calls</TableHead>
                  <TableHead>Licensed states</TableHead>
                  <TableHead>Extension</TableHead>
                  <TableHead>At once</TableHead>
                  <TableHead>Working hours</TableHead>
                  <TableHead>{singleCampaign ? 'On the queue' : 'Campaigns'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map(agent => {
                  const busy = savingId === agent.id;
                  return (
                    <TableRow key={agent.id} className={cn(busy && 'opacity-60')}>
                      <TableCell>
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-muted-foreground">{agent.email}</div>
                      </TableCell>

                      <TableCell>
                        <ReadinessCell agent={agent} />
                      </TableCell>

                      <TableCell>
                        <button
                          type="button"
                          className="text-left hover:opacity-80"
                          onClick={() => setLicenceAgent(agent)}
                          title="Edit licensed states"
                        >
                          <LicenceCell states={agent.licensedStates} />
                        </button>
                      </TableCell>

                      <TableCell>
                        {agent.extension ? (
                          <span className="font-mono text-xs">{agent.extension}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Select
                          value={String(agent.maxConcurrentCalls)}
                          onValueChange={value => void setConcurrency(agent, Number(value))}
                          disabled={busy}
                        >
                          <SelectTrigger className="h-8 w-16">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5].map(n => (
                              <SelectItem key={n} value={String(n)}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      <TableCell>
                        <button
                          type="button"
                          className="text-left hover:opacity-80"
                          onClick={() => setScheduleAgent(agent)}
                          title="Edit working hours"
                        >
                          <ScheduleCell schedule={agent.schedule} />
                        </button>
                      </TableCell>

                      <TableCell>
                        {singleCampaign ? (
                          <Switch
                            checked={agent.campaignIds.includes(singleCampaign.id)}
                            disabled={busy}
                            onCheckedChange={on =>
                              void setCampaigns(agent, on ? [singleCampaign.id] : [])
                            }
                            aria-label={`Take calls from ${singleCampaign.name}`}
                          />
                        ) : campaigns.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="space-y-1">
                            {campaigns.map(campaign => {
                              const on = agent.campaignIds.includes(campaign.id);
                              return (
                                <label
                                  key={campaign.id}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <Checkbox
                                    checked={on}
                                    disabled={busy}
                                    onCheckedChange={next =>
                                      void setCampaigns(
                                        agent,
                                        next === true
                                          ? [...agent.campaignIds, campaign.id]
                                          : agent.campaignIds.filter(id => id !== campaign.id)
                                      )
                                    }
                                  />
                                  {campaign.name}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InviteAgentDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => void load()}
      />

      <ScheduleDialog
        open={scheduleAgent !== null}
        onOpenChange={next => {
          if (!next) setScheduleAgent(null);
        }}
        agent={scheduleAgent}
        timeZone={roster?.deliveryTimeZone ?? 'America/New_York'}
        onSaved={() => {
          setScheduleAgent(null);
          void load();
        }}
      />

      <LicensedStatesDialog
        open={licenceAgent !== null}
        onOpenChange={next => {
          if (!next) setLicenceAgent(null);
        }}
        user={licenceAgent}
        onSaved={() => {
          setLicenceAgent(null);
          void load();
        }}
      />
    </div>
  );
}
