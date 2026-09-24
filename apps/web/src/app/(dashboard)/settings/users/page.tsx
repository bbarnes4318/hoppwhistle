'use client';

import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { InviteAgentDialog } from '@/components/agents/invite-agent-dialog';
import { ScheduleDialog } from '@/components/agents/schedule-dialog';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  Toolbar,
  ToolbarActions,
  ToolbarClear,
  ToolbarMeta,
  ToolbarSearch,
  ToolbarSelect,
} from '@/components/domain';
import {
  CellForwardField,
  ReadinessCell,
  RosterLicenceCell,
  ScheduleCell,
  type Roster,
  type RosterAgent,
} from '@/components/team/roster-cells';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tooltip } from '@/components/ui/tooltip';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { LicensedStatesDialog } from '@/components/users/licensed-states-dialog';
import { PendingApprovals } from '@/components/users/pending-approvals';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { jurisdictionName } from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * Team Members: everybody in the agency, and for an agent, whether they can
 * actually take a call.
 *
 * ── Why this used to be two screens ──────────────────────────────────────────
 *
 * `/settings/users` listed every account -- roles, status, licence -- and
 * `/settings/agents` listed the agents AGAIN with the four things that decide
 * whether one of them ever rings: their licensed states, a SIP extension, how
 * many calls at once, and a campaign to take them from. Both pages listed the
 * same people. Neither was complete.
 *
 * The cost was not the duplication, it was that neither screen answered a whole
 * question. Somebody adding a person had to know which door to use. Somebody
 * asking "why is this agent getting nothing?" had to know the other door
 * existed at all, because the Users page showed them present, active and
 * correctly roled while the roster held the reason.
 *
 * One page. One row per person. An agent's row OPENS onto the readiness
 * controls, so the answer to "why is nobody ringing" is one click from the
 * place you already are, rather than on a screen you had to know about.
 *
 * ── Two sources, joined on the user id ───────────────────────────────────────
 *
 * `/api/v1/users` is every account. `/api/v1/agent-roster` is the operational
 * half, and it selects from `prisma.user` -- so `RosterAgent.id` IS the user
 * id and the join is an identity, not a guess by email. A user with no roster
 * row is simply not an agent, which is the ordinary case for an owner.
 *
 * The roster failing is NOT the page failing. The account list is the thing
 * this page is chiefly for; if the roster does not load, every row still
 * renders and the agent rows say so rather than the screen going blank.
 */

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  roles: string[];
  buyerId?: string | null;
  buyerName?: string | null;
  buyerCode?: string | null;
  invitedAt: string;
  lastLoginAt: string | null;
  /** Normalised by the server; absent on a row written before it validated. */
  licensedStates?: string[];
}

/**
 * Only an agent is gated on a licence.
 *
 * `lib/licensed-states.ts` restricts a principal that holds AGENT and is not
 * staff, so showing an empty licence beside an owner or a buyer would report a
 * gap that does not exist and send somebody granting licences to people who do
 * not need them.
 */
function isLicenceGated(user: User): boolean {
  const roles = user.roles.map(role => role.toUpperCase());
  return roles.includes('AGENT') && !roles.includes('OWNER') && !roles.includes('ADMIN');
}

/**
 * One agent's licence, read at a glance.
 *
 * Three states, and the middle one is the reason this column exists. An empty
 * licence is not a blank cell: it is default-deny in force, and an
 * administrator scanning this table needs to see that it is the reason an agent
 * is getting no work -- not wonder whether the column failed to load.
 */
function LicenceCell({ user }: { user: User }): JSX.Element {
  if (!isLicenceGated(user)) {
    return <span className="text-sm text-ink-3">—</span>;
  }

  const states = user.licensedStates ?? [];

  if (states.length === 0) {
    return (
      <span
        className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-ringing-tint px-2.5 text-[12px] font-medium text-ringing-ink"
        title="No licence recorded. This agent is served no leads and routed no state-identified calls."
      >
        <AlertTriangle className="h-3 w-3" />
        None recorded
      </span>
    );
  }

  // Six is what fits on one line at this width; the rest go behind a count
  // rather than wrapping the row to three lines.
  const shown = states.slice(0, 6);
  const rest = states.length - shown.length;

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      title={states.map(jurisdictionName).join(', ')}
    >
      {shown.map(code => (
        <Badge key={code} variant="outline" className="px-2">
          {code}
        </Badge>
      ))}
      {rest > 0 ? <span className="t-meta tabular-nums text-ink-3">+{rest}</span> : null}
    </div>
  );
}

function roleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role.toLowerCase()) {
    case 'admin':
    case 'owner':
      return 'default';
    case 'buyer':
      return 'secondary';
    default:
      return 'outline';
  }
}

/**
 * The filter, which is the whole reason one table can replace two.
 *
 * "Everyone" is the default and not "Agents": the page is the agency's people,
 * and opening on a filtered view would recreate the old problem of a screen
 * that shows some of them without saying so.
 */
type RoleFilter = 'all' | 'agents' | 'admins' | 'other';

const FILTERS: Array<{ id: RoleFilter; label: string }> = [
  { id: 'all', label: 'Everyone' },
  { id: 'agents', label: 'Agents' },
  { id: 'admins', label: 'Administrators' },
  { id: 'other', label: 'Other' },
];

function matchesFilter(user: User, filter: RoleFilter): boolean {
  const roles = user.roles.map(r => r.toUpperCase());
  const isAdmin = roles.includes('OWNER') || roles.includes('ADMIN');
  const isAgent = roles.includes('AGENT');

  switch (filter) {
    case 'agents':
      return isAgent;
    case 'admins':
      return isAdmin;
    case 'other':
      return !isAgent && !isAdmin;
    default:
      return true;
  }
}

export default function TeamMembersPage(): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [inviteUserOpen, setInviteUserOpen] = useState(false);
  const [inviteAgentOpen, setInviteAgentOpen] = useState(false);
  const [licenceUser, setLicenceUser] = useState<User | null>(null);
  const [scheduleAgent, setScheduleAgent] = useState<RosterAgent | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const { hasFullAccess } = useAuth();
  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  // The API returns status lowercased. Approving is admin-only on the server,
  // so a non-admin is not offered buttons that would come back 403.
  const pendingUsers = users.filter(u => u.status?.toLowerCase() === 'pending');
  const activeUsers = users.filter(u => u.status?.toLowerCase() !== 'pending');

  /*
   * Both lists, in parallel, and the roster is allowed to fail on its own.
   *
   * A user list belongs to one agency and this page is reachable without one:
   * /settings is platform-wide so NetEnroll staff can open it with no agency
   * entered, and asking either endpoint then is a request the server refuses
   * 409 for a table that could never have rendered.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRosterError(null);

    const [userResult, rosterResult] = await Promise.allSettled([
      apiClient.get<{ data: User[] }>('/api/v1/users'),
      apiClient.get<{ data: Roster }>('/api/v1/agent-roster'),
    ]);

    if (userResult.status === 'fulfilled' && userResult.value.data?.data) {
      setUsers(userResult.value.data.data);
    } else {
      setError('The team could not be loaded.');
    }

    if (rosterResult.status === 'fulfilled' && rosterResult.value.data?.data) {
      setRoster(rosterResult.value.data.data);
    } else {
      // Deliberately not `error`: the account rows are still good, and blanking
      // the whole page because the operational half is unavailable would hide
      // the part that loaded.
      //
      // The server's reason is shown, not swallowed. This failed in production
      // with nothing on screen but the sentence below, while the API was
      // answering with the exact cause (a missing column or table from a
      // migration that had not been applied).
      const reason =
        rosterResult.status === 'fulfilled'
          ? rosterResult.value.error?.message
          : rosterResult.reason instanceof Error
            ? rosterResult.reason.message
            : undefined;
      setRosterError(
        reason
          ? `The agent roster could not be loaded, so readiness is not shown. Server said: ${reason}`
          : 'The agent roster could not be loaded, so readiness is not shown.'
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (platform.loading) return;
    if (withoutAgency) {
      setUsers([]);
      setRoster(null);
      setLoading(false);
      return;
    }
    void load();
  }, [platform.loading, withoutAgency, load]);

  /** user id -> roster row. An absent entry means "not an agent". */
  const agentsById = useMemo(() => {
    const map = new Map<string, RosterAgent>();
    for (const agent of roster?.agents ?? []) map.set(agent.id, agent);
    return map;
  }, [roster]);

  const campaigns = roster?.campaigns ?? [];
  /*
   * One campaign is the ordinary case for an agency, and "which campaigns does
   * this agent take" is then a question with one answer. It renders as a single
   * switch rather than a list of one checkbox.
   */
  const singleCampaign = campaigns.length === 1 ? campaigns[0] : null;

  const counts = useMemo(() => {
    const out: Record<RoleFilter, number> = { all: 0, agents: 0, admins: 0, other: 0 };
    for (const f of FILTERS) out[f.id] = activeUsers.filter(u => matchesFilter(u, f.id)).length;
    return out;
  }, [activeUsers]);

  /*
   * The statuses actually present, so the status filter never offers a value
   * that would empty the table. Pending accounts are not among them: they sit
   * in the approvals panel above, not in this table.
   */
  const statuses = useMemo(
    () => Array.from(new Set(activeUsers.map(u => u.status).filter(Boolean))).sort(),
    [activeUsers]
  );

  const needle = search.trim().toLowerCase();
  const visible = activeUsers.filter(
    u =>
      matchesFilter(u, filter) &&
      (statusFilter === 'all' || u.status === statusFilter) &&
      (needle === '' ||
        [u.firstName, u.lastName, u.email, u.buyerName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle))
  );

  const hasActiveFilters = filter !== 'all' || statusFilter !== 'all' || needle !== '';

  const readyCount = (roster?.agents ?? []).filter(a => !a.blockedReason).length;
  const agentTotal = roster?.agents.length ?? 0;

  function toggle(id: string): void {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setCampaigns(agent: RosterAgent, campaignIds: string[]): Promise<void> {
    setSavingId(agent.id);
    try {
      await apiClient.put(`/api/v1/agent-roster/${agent.id}/campaigns`, { campaignIds });
      await load();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'The assignment could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  async function setAvailability(agent: RosterAgent, availableForCalls: boolean): Promise<void> {
    setSavingId(agent.id);
    try {
      const response = await apiClient.put(`/api/v1/agent-roster/${agent.id}/availability`, {
        availableForCalls,
      });
      if (response.error) {
        setRosterError(response.error.message);
        return;
      }
      setRosterError(null);
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function setCellForward(
    agent: RosterAgent,
    cellForwardNumber: string | null
  ): Promise<void> {
    setSavingId(agent.id);
    try {
      const response = await apiClient.patch(`/api/v1/agent-roster/${agent.id}`, {
        cellForwardNumber,
      });
      // The client returns a refusal rather than throwing it, and a mistyped
      // number is exactly the refusal the owner needs to see.
      if (response.error) {
        setRosterError(response.error.message);
        return;
      }
      setRosterError(null);
      await load();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'The cell number could not be saved.');
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
      setRosterError(err instanceof Error ? err.message : 'The setting could not be saved.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page-canvas">
      {/* ── Search, filters and the page's actions: one row ─────────────── */}
      <Toolbar>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name or email…" />

        {/*
         * The role filter carries its counts in the menu, which is what the old
         * row of tabs showed at a glance.
         */}
        <ToolbarSelect
          label="Role"
          value={filter}
          onChange={value => setFilter(value as RoleFilter)}
          allLabel={`Everyone (${counts.all})`}
          options={FILTERS.filter(f => f.id !== 'all').map(f => ({
            value: f.id,
            label: `${f.label} (${counts[f.id]})`,
          }))}
        />

        {statuses.length > 1 ? (
          <ToolbarSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            allLabel="Any status"
            options={statuses.map(status => ({
              value: status,
              label: status.charAt(0).toUpperCase() + status.slice(1),
            }))}
          />
        ) : null}

        {/*
         * Readiness is the one fact the old subtitle carried; what "ready"
         * requires moved from a paragraph above the table into the tooltip.
         */}
        {agentTotal > 0 ? (
          <Tooltip content="An agent takes calls once they have accepted their invitation, have their licensed states recorded, are assigned a campaign, and have opened the softphone once (or have a cell number to ring instead). Open a row to set those.">
            <ToolbarMeta>{`${readyCount} of ${agentTotal} ready`}</ToolbarMeta>
          </Tooltip>
        ) : null}

        <ToolbarActions>
          {hasActiveFilters ? (
            <ToolbarClear
              onClick={() => {
                setFilter('all');
                setStatusFilter('all');
                setSearch('');
              }}
            />
          ) : null}
          <Tooltip content="Refresh">
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh"
              onClick={() => void load()}
              disabled={loading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInviteUserOpen(true)}
            className="h-8 text-xs"
          >
            Invite user
          </Button>
          <Button size="sm" onClick={() => setInviteAgentOpen(true)} className="h-8 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add agent
          </Button>
        </ToolbarActions>
      </Toolbar>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {rosterError && !withoutAgency ? <Notice tone="warning">{rosterError}</Notice> : null}

      {campaigns.length === 0 && !loading && !withoutAgency && agentTotal > 0 ? (
        <Notice tone="warning">
          This agency has no active campaign, so there is nothing to assign an agent to yet.
          NetEnroll sets that up.
        </Notice>
      ) : null}

      {hasFullAccess && <PendingApprovals users={pendingUsers} onDecided={() => void load()} />}

      <Panel className="min-w-0">
        <PanelBody flush className="min-w-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-ink-3" />
            </div>
          ) : withoutAgency ? (
            <div className="p-5">
              <Notice tone="info">
                People belong to an agency. Enter one in the switcher above to see and manage its
                team.
              </Notice>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              variant={activeUsers.length === 0 ? 'empty' : 'filtered'}
              headline={
                activeUsers.length === 0 ? 'No one here yet.' : 'Nobody matches those filters.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Taking calls</TableHead>
                  <TableHead>Licensed states</TableHead>
                  <TableHead>Buyer company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(user => {
                  const agent = agentsById.get(user.id);
                  const isOpen = expanded.has(user.id);
                  const busy = savingId === user.id;

                  return [
                    <TableRow key={user.id} className={cn('h-14', busy && 'opacity-60')}>
                      <TableCell className="w-8 pr-0">
                        {agent ? (
                          <button
                            type="button"
                            onClick={() => toggle(user.id)}
                            aria-expanded={isOpen}
                            aria-label={
                              isOpen
                                ? `Hide call settings for ${user.email}`
                                : `Show call settings for ${user.email}`
                            }
                            className="rounded-control p-1 text-ink-3 hover:bg-sunken hover:text-ink"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </TableCell>

                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-semibold text-brand-ink">
                            {(
                              `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}` ||
                              user.email.slice(0, 1)
                            ).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            {(user.firstName || user.lastName) && (
                              <div className="truncate font-medium text-ink">
                                {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                              </div>
                            )}
                            <div
                              className={cn(
                                'truncate',
                                user.firstName || user.lastName
                                  ? 't-meta text-ink-3'
                                  : 'font-medium text-ink'
                              )}
                            >
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map(role => (
                            <Badge key={role} variant={roleBadgeVariant(role)} className="w-fit">
                              <Shield className="h-3 w-3" />
                              {role.toUpperCase()}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>

                      {/*
                        The column the two pages were split over. An agent gets
                        the roster's reading; anybody else gets an em dash,
                        because "can this person take a call" is not a question
                        about an owner or a buyer.
                      */}
                      <TableCell>
                        {agent ? (
                          <ReadinessCell agent={agent} />
                        ) : (
                          <span className="text-sm text-ink-3">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <LicenceCell user={user} />
                      </TableCell>

                      <TableCell>
                        {user.buyerId ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-4 w-4 shrink-0 text-ink-3" />
                            <div>
                              <div className="text-sm font-medium text-ink">{user.buyerName}</div>
                              <div className="t-meta text-ink-3">{user.buyerCode}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-ink-3">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant={user.status === 'active' ? 'success' : 'warning'}>
                          {user.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        {isLicenceGated(user) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLicenceUser(user)}
                            disabled={!hasFullAccess}
                            title={
                              hasFullAccess
                                ? undefined
                                : 'Only an owner or administrator can change a licence'
                            }
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Licence
                          </Button>
                        ) : (
                          <span className="text-sm text-ink-3">—</span>
                        )}
                      </TableCell>
                    </TableRow>,

                    agent && isOpen ? (
                      <TableRow key={`${user.id}-settings`} className="bg-sunken/50">
                        <TableCell />
                        <TableCell colSpan={7} className="py-4">
                          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                            <div>
                              <div className="mb-1 t-label text-ink-3">Extension</div>
                              {agent.extension ? (
                                <span className="t-data text-ink">{agent.extension}</span>
                              ) : (
                                <span className="t-meta text-ink-3">
                                  Allocated when they first open the softphone
                                </span>
                              )}
                            </div>

                            <div>
                              <div className="mb-1 t-label text-ink-3">Phone</div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={agent.availableForCalls !== false}
                                  disabled={busy}
                                  onCheckedChange={on => void setAvailability(agent, on)}
                                  aria-label={`Send calls to ${agent.name}`}
                                />
                                <span className="t-meta text-ink-3">
                                  {agent.availableForCalls !== false ? 'On' : 'Off'}
                                </span>
                              </div>
                            </div>

                            <div>
                              <div className="mb-1 t-label text-ink-3">Ring on</div>
                              <CellForwardField
                                agent={agent}
                                disabled={busy}
                                onSave={value => setCellForward(agent, value)}
                              />
                            </div>

                            <div>
                              <div className="mb-1 t-label text-ink-3">Calls at once</div>
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
                            </div>

                            <div>
                              <div className="mb-1 t-label text-ink-3">Working hours</div>
                              <button
                                type="button"
                                className="text-left hover:opacity-80"
                                onClick={() => setScheduleAgent(agent)}
                                title="Edit working hours"
                              >
                                <ScheduleCell schedule={agent.schedule} />
                              </button>
                            </div>

                            <div>
                              <div className="mb-1 t-label text-ink-3">
                                {singleCampaign ? 'On the queue' : 'Campaigns'}
                              </div>
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
                                <span className="t-meta text-ink-3">No active campaign</span>
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
                            </div>
                          </div>

                          <div className="mt-4 t-meta text-ink-3">
                            Licensed states:{' '}
                            <button
                              type="button"
                              className="align-middle hover:opacity-80"
                              onClick={() => setLicenceUser(user)}
                              title="Edit licensed states"
                            >
                              <RosterLicenceCell states={agent.licensedStates} />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null,
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>

      <InviteUserDialog
        open={inviteUserOpen}
        onOpenChange={setInviteUserOpen}
        onSuccess={() => void load()}
      />

      <InviteAgentDialog
        open={inviteAgentOpen}
        onOpenChange={setInviteAgentOpen}
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
        open={licenceUser !== null}
        onOpenChange={open => {
          if (!open) setLicenceUser(null);
        }}
        user={licenceUser}
        onSaved={() => {
          setLicenceUser(null);
          void load();
        }}
      />
    </div>
  );
}
