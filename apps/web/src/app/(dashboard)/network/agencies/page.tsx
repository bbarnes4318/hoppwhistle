'use client';

import { Building2, Handshake, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { count, pct } from '@/components/delivery/ledger';
import { EmptyState, Notice, Panel, PanelBody, StatusChip } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
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
 */
export default function NetworkAgenciesPage(): JSX.Element {
  const state = usePeriod('THIS_MONTH');
  const { sendable, query } = state;

  const [data, setData] = useState<NetworkAgencies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="page-canvas">
      <PageHeader
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
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Agents</TableHead>
                    <TableHead className="text-right">Inbound calls</TableHead>
                    <TableHead className="text-right">Answered by agents</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Onboarded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.agencies.map(agency => {
                    const owner = OWNER_LABEL[agency.owner.status];
                    return (
                      <TableRow key={agency.tenantId}>
                        <TableCell className="font-medium">{agency.name}</TableCell>
                        <TableCell>
                          <StatusChip value={agency.status} enumName="TenantStatus" size="sm" />
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
                        <TableCell>
                          <StatusChip
                            value={agency.owner.status}
                            label={owner.label}
                            tone={owner.tone}
                            size="sm"
                          />
                          {agency.owner.email ? (
                            <div className="mt-0.5 t-meta text-ink-3">{agency.owner.email}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="t-meta text-ink-2">
                          {formatDisplayDate(agency.createdAt)}
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
    </div>
  );
}
