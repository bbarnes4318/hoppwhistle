'use client';

import { Building2, Handshake, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { InviteOwnerDialog } from '@/components/agencies/invite-owner-dialog';
import { count, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  StatTile,
  StatTileRow,
  StatusChip,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { ChildStatementButton } from '@/components/statements/statements-view';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import type { NetworkAgencies, NetworkAgencyRow } from '@/components/white-label/types';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDisplayDate } from '@/lib/format-time';
import { cn } from '@/lib/utils';

/** How an owner's activation reads, and the tone it is drawn in. */
const OWNER_LABEL: Record<
  NetworkAgencyRow['owner']['status'],
  { label: string; tone: 'live' | 'ringing' | 'neutral' | 'dropped' }
> = {
  ACCEPTED: { label: 'Owner active', tone: 'live' },
  PENDING: { label: 'Invite pending', tone: 'ringing' },
  EXPIRED: { label: 'Invite expired', tone: 'dropped' },
  NOT_INVITED: { label: 'Not invited', tone: 'neutral' },
};

/**
 * Agencies: a white-label agency's own downline.
 *
 * Aggregates only, by design and by the API: each row is counts and a closing
 * percentage, and there is no way from here into a child agency's calls,
 * leads or people. The parent can onboard a child and invite its owner; it
 * cannot enter one.
 *
 * Each agency's name opens its own page (`/network/agencies/<id>`), where the
 * parent edits its details and sets its phone-numbers limit and upgrades.
 */
export default function NetworkAgenciesPage(): JSX.Element {
  const state = usePeriod('THIS_MONTH');
  const { sendable, query } = state;

  const [data, setData] = useState<NetworkAgencies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState<NetworkAgencyRow | null>(null);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  const load = useCallback(async () => {
    if (!sendable) return;
    setLoading(true);
    try {
      const response = await apiClient.get<Envelope<NetworkAgencies>>(
        `/api/v1/network/agencies?${query}`
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      setError(null);
      setData(payload(response) ?? null);
    } finally {
      setLoading(false);
    }
  }, [query, sendable]);

  useEffect(() => {
    if (platform.loading || withoutAgency) return;
    void load();
  }, [load, platform.loading, withoutAgency]);

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see its downline." />
      </div>
    );
  }

  const waiting = (data?.agencies ?? []).filter(agency => agency.owner.status !== 'ACCEPTED');
  const active = (data?.agencies ?? []).length - waiting.length;

  return (
    <div className="page-canvas">
      <PageHeader
        compact
        description="Your agencies: calls, applications and closing percentage"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link href="/network/onboarding">
                <Handshake className="mr-1.5 h-3.5 w-3.5" />
                Onboard an Agency
              </Link>
            </Button>
          </>
        }
      />

      <PeriodToolbar state={state} resolved={data?.period ?? null} label="Agencies period" />

      {error ? <Notice tone="error" title={error} /> : null}

      {data && data.agencies.length > 0 ? (
        <>
          <StatTileRow className="lg:grid-cols-4">
            <StatTile label="Agencies" value={count(data.agencies.length)} />
            <StatTile label="Owners active" value={count(active)} />
            <StatTile
              label="Waiting on an owner"
              value={count(waiting.length)}
              sub={
                waiting.length > 0 ? 'Invite them from the table below' : 'Everyone is signed in'
              }
            />
            <StatTile
              label="Applications"
              value={count(data.agencies.reduce((sum, agency) => sum + agency.applications, 0))}
            />
          </StatTileRow>

          {waiting.length > 0 ? (
            <Notice
              tone="warning"
              title={`${waiting.length} ${waiting.length === 1 ? 'agency has' : 'agencies have'} no owner signed in yet`}
              action={
                waiting.length === 1 ? (
                  <Button size="sm" onClick={() => setInviting(waiting[0] ?? null)}>
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {waiting[0]?.owner.status === 'NOT_INVITED' ? 'Invite owner' : 'Resend invite'}
                  </Button>
                ) : undefined
              }
            >
              An agency cannot take calls until its owner has accepted the invitation and signed in.
            </Notice>
          ) : null}
        </>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading your agencies
        </div>
      ) : !data ? null : (
        <Panel className="min-w-0">
          <PanelBody flush className="overflow-x-auto">
            {data.agencies.length === 0 ? (
              <EmptyState
                headline="You have not onboarded an agency yet."
                body="Onboard an agency and it appears here with its calls, applications and closing percentage."
                icon={Building2}
                action={{ label: 'Onboard an Agency', href: '/network/onboarding' }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agency</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Agents</TableHead>
                    <TableHead className="text-right">Inbound calls</TableHead>
                    <TableHead className="text-right">Answered</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agencies.map(agency => {
                    const owner = OWNER_LABEL[agency.owner.status];
                    const accepted = agency.owner.status === 'ACCEPTED';
                    const neverInvited = agency.owner.status === 'NOT_INVITED';
                    return (
                      <TableRow key={agency.tenantId}>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/network/agencies/${agency.tenantId}`}
                              className="font-medium text-brand-ink hover:underline"
                            >
                              {agency.name}
                            </Link>
                            <StatusChip value={agency.status} enumName="TenantStatus" size="sm" />
                          </div>
                          <div className="mt-0.5 t-meta text-ink-3">
                            {`Onboarded ${formatDisplayDate(agency.createdAt)}`}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <StatusChip
                              value={agency.owner.status}
                              label={owner.label}
                              tone={owner.tone}
                              size="sm"
                            />
                            {agency.owner.email ? (
                              <span className="t-meta text-ink-3">{agency.owner.email}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(agency.agents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(agency.inboundCalls)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(agency.answeredByAgents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {count(agency.applications)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct(agency.closingPct, 1)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {accepted ? null : (
                              <Button
                                size="sm"
                                variant={neverInvited ? 'default' : 'outline'}
                                onClick={() => setInviting(agency)}
                              >
                                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                                {neverInvited ? 'Invite owner' : 'Resend invite'}
                              </Button>
                            )}
                            <ChildStatementButton tenantId={agency.tenantId} name={agency.name} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </PanelBody>
        </Panel>
      )}

      <InviteOwnerDialog
        open={inviting !== null}
        onOpenChange={open => {
          if (!open) setInviting(null);
        }}
        scope="network"
        agency={
          inviting
            ? {
                tenantId: inviting.tenantId,
                name: inviting.name,
                email: inviting.owner.email,
                alreadyInvited: inviting.owner.status !== 'NOT_INVITED',
              }
            : null
        }
        onInvited={() => void load()}
      />
    </div>
  );
}
