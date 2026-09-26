'use client';

import { Loader2, Plus, UserMinus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState, Notice, StatusChip } from '@/components/domain';
import type { Roster, RosterAgent } from '@/components/team/roster-cells';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AGENT_LIVE_STATUS_LABEL,
  AGENT_LIVE_STATUS_TONE,
  agentLiveStatus,
} from '@/lib/agent-status';
import { apiClient } from '@/lib/api';

/**
 * "Your agents": who in the agency takes this campaign's calls.
 *
 * The agent roster is the source: an agent is on this campaign when the
 * campaign is in their `campaignIds`, and adding or removing one writes that
 * agent's whole list back through `PUT /api/v1/agent-roster/:userId/campaigns`
 * -- the same endpoint Team Members uses, so the two screens cannot disagree.
 * The status is the softphone's, read the way Today reads it.
 */
export function CampaignAgentsTab({
  campaignId,
  canManage,
}: {
  campaignId: string;
  canManage: boolean;
}): JSX.Element {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState('');

  const load = useCallback(async () => {
    const response = await apiClient.get<Roster>('/api/v1/agent-roster');
    if (response.error || !response.data) {
      setError(response.error?.message ?? 'The agents could not be loaded.');
      return;
    }
    setError(null);
    setRoster(response.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assigned = useMemo(
    () => (roster?.agents ?? []).filter(agent => agent.campaignIds.includes(campaignId)),
    [roster, campaignId]
  );
  const available = useMemo(
    () => (roster?.agents ?? []).filter(agent => !agent.campaignIds.includes(campaignId)),
    [roster, campaignId]
  );

  async function save(agent: RosterAgent, campaignIds: string[]): Promise<void> {
    setSavingId(agent.id);
    try {
      const response = await apiClient.put(`/api/v1/agent-roster/${agent.id}/campaigns`, {
        campaignIds,
      });
      if (response.error) {
        setError(response.error.message);
        return;
      }
      await load();
    } finally {
      setSavingId(null);
    }
  }

  function add(): void {
    const agent = available.find(candidate => candidate.id === adding);
    if (!agent) return;
    setAdding('');
    void save(agent, [...agent.campaignIds, campaignId]);
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Your agents</CardTitle>
          <CardDescription>
            The agents who take this campaign&apos;s calls, and whether each one can right now.
          </CardDescription>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Select value={adding} onValueChange={setAdding} disabled={available.length === 0}>
              <SelectTrigger className="h-8 w-56" aria-label="Agent to add">
                <SelectValue
                  placeholder={available.length === 0 ? 'Every agent is on it' : 'Choose an agent'}
                />
              </SelectTrigger>
              <SelectContent>
                {available.map(agent => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name || agent.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={add} disabled={!adding || savingId !== null}>
              <Plus className="mr-1 h-4 w-4" />
              Add agent
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {error ? <Notice tone="error" title={error} className="m-4" /> : null}
        {roster === null && !error ? (
          <div className="flex items-center justify-center gap-2 py-10 t-body text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agents
          </div>
        ) : assigned.length === 0 ? (
          <EmptyState
            headline="No agents take this campaign's calls yet."
            body={canManage ? 'Add one above and they start ringing on its next call.' : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Licensed states</TableHead>
                  {canManage ? <TableHead className="text-right">Remove</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assigned.map(agent => {
                  const status = agentLiveStatus(agent.softphoneStatus);
                  return (
                    <TableRow key={agent.id} data-campaign-agent={agent.id}>
                      <TableCell>
                        <div className="font-medium text-ink">{agent.name || agent.email}</div>
                        {agent.name ? <div className="t-meta text-ink-3">{agent.email}</div> : null}
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          value={status}
                          label={AGENT_LIVE_STATUS_LABEL[status]}
                          tone={AGENT_LIVE_STATUS_TONE[status]}
                          size="sm"
                        />
                        {agent.blockedReason ? (
                          <div className="mt-1 t-meta text-ink-3">{agent.blockedReason}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[20rem]">
                        {agent.licensedStates.length === 0 ? (
                          <span className="t-meta text-dropped-ink">None</span>
                        ) : (
                          <span className="t-body text-ink-2">
                            {agent.licensedStates.join(', ')}
                          </span>
                        )}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${agent.name || agent.email} from this campaign`}
                            disabled={savingId !== null}
                            onClick={() =>
                              void save(
                                agent,
                                agent.campaignIds.filter(id => id !== campaignId)
                              )
                            }
                          >
                            {savingId === agent.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserMinus className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
