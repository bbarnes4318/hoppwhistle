'use client';

import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * Shared DIDs: one number, several agencies, round robin.
 *
 * A group pools agents: whole campaigns (one per agency) and individual agents
 * of any agency, added whether or not they are on a campaign. A call to any
 * DID on the group is offered to the agents licensed for the caller's state, one at a
 * time, in round-robin order across every agency, and is recorded under the
 * agency whose agent answers it. See apps/api/src/services/shared-routing.ts.
 *
 * No RoleGuard, the same as the other cross-agency screens: `/admin/shared-routing`
 * is in STAFF_ONLY_ROUTES and every endpoint behind it requires `isPlatformAdmin`.
 */

type Status = 'ACTIVE' | 'PAUSED';

interface Member {
  id: string;
  status: Status;
  tenantId: string;
  campaignId: string | null;
  /** Set when the member is a single agent rather than a whole campaign. */
  userId: string | null;
  tenant: { name: string };
  user: { firstName: string | null; lastName: string | null; email: string } | null;
  campaign: { name: string; status: string; _count: { agents: number } } | null;
}

interface AgentOption {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string | null;
  licensedStates: string[];
  roles: string[];
  /** False for an owner or administrator: adding them makes them an agent too. */
  isAgent: boolean;
  status: string;
}

function memberAgentName(member: Member): string {
  const user = member.user;
  if (!user) return 'Agent';
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}

interface Group {
  id: string;
  name: string;
  status: Status;
  members: Member[];
  didRoutes: { id: string; did: string; tenantId: string; status: string; totalCalls: number }[];
}

interface CampaignOption {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
  activeAgents: number;
}

interface NumberOption {
  id: string;
  number: string;
  tenantName: string | null;
  sharedRoutingGroupId: string | null;
  campaignId: string | null;
}

const BASE = '/api/v1/platform/shared-routing-groups';

function StatusBadge({ status }: { status: Status }): JSX.Element {
  return status === 'ACTIVE' ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="warning">Paused</Badge>
  );
}

function AddMember({
  group,
  onChanged,
  onError,
}: {
  group: Group;
  onChanged: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<CampaignOption[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void apiClient
        .get<Envelope<CampaignOption[]>>(`${BASE}/options/campaigns?q=${encodeURIComponent(q)}`)
        .then(response => setOptions(payload(response) ?? []));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  // One whole campaign per agency. Agents added individually don't count.
  const memberTenants = new Set(group.members.filter(m => !m.userId).map(m => m.tenantId));

  const add = async (campaignId: string) => {
    const response = await apiClient.post(`${BASE}/${group.id}/members`, { campaignId });
    if (response.error) onError(response.error.message);
    onChanged();
  };

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search campaigns or agencies to add"
        value={q}
        onChange={event => setQ(event.target.value)}
      />
      <ul className="max-h-48 divide-y divide-rule overflow-y-auto rounded border border-rule">
        {options.map(option => {
          const taken = memberTenants.has(option.tenantId);
          return (
            <li key={option.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="t-body min-w-0 truncate">
                <span className="font-medium">{option.tenantName}</span> · {option.name}
                <span className="text-ink-3"> · {option.activeAgents} agents</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={taken}
                title={taken ? 'This agency already has a campaign in the group' : undefined}
                onClick={() => void add(option.id)}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </li>
          );
        })}
        {options.length === 0 && (
          <li className="t-body px-3 py-2 text-ink-3">No campaigns found.</li>
        )}
      </ul>
    </div>
  );
}

function AddAgent({
  group,
  onChanged,
  onError,
}: {
  group: Group;
  onChanged: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<AgentOption[]>([]);
  const [picked, setPicked] = useState<AgentOption | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignId, setCampaignId] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiClient
        .get<Envelope<AgentOption[]>>(`${BASE}/options/agents?q=${encodeURIComponent(q)}`)
        .then(response => setOptions(payload(response) ?? []));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setCampaignId('');
    if (!picked) {
      setCampaigns([]);
      return;
    }
    void apiClient
      .get<
        Envelope<{ id: string; name: string }[]>
      >(`${BASE}/options/agency-campaigns?tenantId=${encodeURIComponent(picked.tenantId)}`)
      .then(response => setCampaigns(payload(response) ?? []));
  }, [picked]);

  const inGroup = new Set(group.members.map(m => m.userId).filter(Boolean));

  const add = async () => {
    if (!picked) return;
    const response = await apiClient.post(`${BASE}/${group.id}/members`, {
      userId: picked.id,
      ...(campaignId ? { campaignId } : {}),
    });
    if (response.error) onError(response.error.message);
    setPicked(null);
    setQ('');
    onChanged();
  };

  if (picked) {
    return (
      <div className="space-y-2 rounded border border-rule p-3">
        <p className="t-body">
          <span className="font-medium">{picked.name}</span>
          <span className="text-ink-3"> · {picked.tenantName ?? 'No agency'}</span>
        </p>
        {!picked.isAgent && (
          <p className="t-body text-ink-3">
            {picked.name} is {picked.roles.join('/').toLowerCase()} of this agency and is not an
            agent yet. Adding them makes them an agent as well (they keep their other roles), so
            they get the softphone and are credited with the calls they answer.
          </p>
        )}
        <p className="t-body text-ink-3">
          Licensed in:{' '}
          {picked.licensedStates.length > 0
            ? picked.licensedStates.join(', ')
            : 'none set (rings for every state)'}
        </p>
        <label className="t-body block space-y-1">
          <span>Record their calls under</span>
          <select
            className="w-full rounded border border-rule bg-surface px-2 py-1"
            value={campaignId}
            onChange={event => setCampaignId(event.target.value)}
          >
            <option value="">Their agency only (no campaign)</option>
            {campaigns.map(campaign => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void add()}>
            <Plus className="mr-1 h-3 w-3" />
            Add agent
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search agents, owners or admins by name, email or agency"
        value={q}
        onChange={event => setQ(event.target.value)}
      />
      {options.length > 0 && (
        <ul className="max-h-48 divide-y divide-rule overflow-y-auto rounded border border-rule">
          {options.map(option => (
            <li key={option.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="t-body min-w-0 truncate">
                <span className="font-medium">{option.name}</span>
                <span className="text-ink-3">
                  {' '}
                  · {option.tenantName ?? 'No agency'}
                  {!option.isAgent &&
                    ` · ${option.roles.join('/').toLowerCase()}, will be made an agent`}
                  {option.status !== 'ACTIVE' && ` · ${option.status.toLowerCase()}`}
                  {option.licensedStates.length > 0 && ` · ${option.licensedStates.join(', ')}`}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={inGroup.has(option.id) || option.status !== 'ACTIVE'}
                title={
                  inGroup.has(option.id)
                    ? 'Already in the group'
                    : option.status !== 'ACTIVE'
                      ? 'This account is not active, so it cannot take calls'
                      : undefined
                }
                onClick={() => setPicked(option)}
              >
                Choose
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachDid({
  group,
  onChanged,
  onError,
}: {
  group: Group;
  onChanged: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<NumberOption[]>([]);

  useEffect(() => {
    if (q.replace(/\D/g, '').length < 3) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiClient
        .get<Envelope<NumberOption[]>>(`${BASE}/options/numbers?q=${encodeURIComponent(q)}`)
        .then(response => setOptions(payload(response) ?? []));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const attach = async (option: NumberOption) => {
    if (
      option.campaignId &&
      !window.confirm(
        `${option.number} is routed to a campaign now. Attaching it here moves it off that campaign. Continue?`
      )
    ) {
      return;
    }
    const response = await apiClient.post(`${BASE}/${group.id}/dids`, { phoneNumberId: option.id });
    if (response.error) onError(response.error.message);
    setQ('');
    onChanged();
  };

  return (
    <div className="space-y-2">
      <Input
        placeholder="Type at least 3 digits of a number to attach"
        value={q}
        onChange={event => setQ(event.target.value)}
      />
      {options.length > 0 && (
        <ul className="max-h-48 divide-y divide-rule overflow-y-auto rounded border border-rule">
          {options.map(option => {
            const here = option.sharedRoutingGroupId === group.id;
            return (
              <li key={option.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="t-body min-w-0 truncate">
                  <span className="font-mono">{option.number}</span>
                  <span className="text-ink-3"> · {option.tenantName ?? 'No agency'}</span>
                  {option.sharedRoutingGroupId && !here && (
                    <span className="text-ink-3"> · in another group</span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={here}
                  onClick={() => void attach(option)}
                >
                  Attach
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GroupCard({
  group,
  onChanged,
  onError,
}: {
  group: Group;
  onChanged: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const run = async (request: Promise<{ error?: { message: string } }>) => {
    const response = await request;
    if (response.error) onError(response.error.message);
    onChanged();
  };
  const toggled = (status: Status): Status => (status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {group.name} <StatusBadge status={group.status} />
          </CardTitle>
          <CardDescription>
            Round robin across {group.members.length}{' '}
            {group.members.length === 1 ? 'member' : 'members'}. Only agents licensed for the
            caller&rsquo;s state are offered the call.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void run(apiClient.patch(`${BASE}/${group.id}`, { status: toggled(group.status) }))
            }
          >
            {group.status === 'ACTIVE' ? (
              <Pause className="mr-1 h-3 w-3" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            {group.status === 'ACTIVE' ? 'Pause' : 'Resume'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={group.didRoutes.length > 0}
            title={group.didRoutes.length > 0 ? 'Remove its DIDs first' : undefined}
            onClick={() => {
              if (window.confirm(`Delete ${group.name}?`)) {
                void run(apiClient.delete(`${BASE}/${group.id}`));
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="t-label">Agencies and agents</h3>
          <ul className="divide-y divide-rule rounded border border-rule">
            {group.members.map(member => (
              <li key={member.id} className="flex items-center justify-between gap-2 px-3 py-2">
                {member.userId ? (
                  <span className="t-body min-w-0">
                    <span className="font-medium">{memberAgentName(member)}</span>
                    <span className="text-ink-3">
                      {' '}
                      · agent · {member.tenant.name}
                      {member.campaign ? ` · records under ${member.campaign.name}` : ''}
                    </span>
                  </span>
                ) : (
                  <span className="t-body min-w-0">
                    <span className="font-medium">{member.tenant.name}</span> ·{' '}
                    {member.campaign?.name ?? 'Campaign'}
                    <span className="text-ink-3">
                      {' '}
                      · {member.campaign?._count.agents ?? 0} agents
                    </span>
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={member.status} />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(
                        apiClient.patch(`${BASE}/${group.id}/members/${member.id}`, {
                          status: toggled(member.status),
                        })
                      )
                    }
                  >
                    {member.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(apiClient.delete(`${BASE}/${group.id}/members/${member.id}`))
                    }
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
            {group.members.length === 0 && (
              <li className="t-body px-3 py-2 text-ink-3">No agencies or agents yet.</li>
            )}
          </ul>
          <p className="t-label">Add a whole campaign</p>
          <AddMember group={group} onChanged={onChanged} onError={onError} />
          <p className="t-label">Add a single agent</p>
          <AddAgent group={group} onChanged={onChanged} onError={onError} />
        </section>

        <section className="space-y-3">
          <h3 className="t-label">DIDs</h3>
          <ul className="divide-y divide-rule rounded border border-rule">
            {group.didRoutes.map(route => (
              <li key={route.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="t-body">
                  <span className="font-mono">{route.did}</span>
                  <span className="text-ink-3"> · {route.totalCalls} calls</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(`Take ${route.did} off this group? It will stop ringing.`)) {
                      void run(apiClient.delete(`${BASE}/${group.id}/dids/${route.id}`));
                    }
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
            {group.didRoutes.length === 0 && (
              <li className="t-body px-3 py-2 text-ink-3">No DIDs yet.</li>
            )}
          </ul>
          <AttachDid group={group} onChanged={onChanged} onError={onError} />
        </section>
      </CardContent>
    </Card>
  );
}

export default function SharedRoutingPage(): JSX.Element {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<Group[]>>(BASE);
    const data = payload(response);
    if (data) setGroups(data);
    else setError(response.error?.message ?? 'Shared DIDs could not be loaded.');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    const response = await apiClient.post(BASE, { name: name.trim() });
    if (response.error) setError(response.error.message);
    setName('');
    void load();
  };

  return (
    <div className="page-canvas space-y-6">
      <PageHeader description="One number for several agencies. Each call goes to the next agent in line who is licensed for the caller's state, and is recorded under the agency whose agent answers." />

      {error && (
        <p className="t-body text-dropped-ink" role="alert">
          {error}
        </p>
      )}

      <form
        className="flex max-w-md gap-2"
        onSubmit={event => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          placeholder="New group name, e.g. FL/GA final expense"
          value={name}
          onChange={event => setName(event.target.value)}
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Create
        </Button>
      </form>

      {groups === null && !error && <p className="t-body text-ink-3">Loading…</p>}
      {groups?.length === 0 && <p className="t-body text-ink-3">No shared DIDs yet.</p>}
      {groups?.map(group => (
        <GroupCard
          key={group.id}
          group={group}
          onChanged={() => void load()}
          onError={message => setError(message)}
        />
      ))}
    </div>
  );
}
