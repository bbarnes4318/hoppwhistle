'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { count, dollars, duration } from '@/components/delivery/ledger';
import {
  DrawerField,
  DrawerSection,
  Segmented,
  SegmentedItem,
  SheetDrawer,
} from '@/components/domain';
import { periodQuery } from '@/components/leaderboard/period-picker';
import type { PeriodKey } from '@/components/leaderboard/types';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDayLabel, formatDayRange } from '@/lib/format-time';
import { lastNewYorkDays } from '@/lib/new-york-day';
import { formatPhoneNumber } from '@/lib/utils';

/**
 * A publisher's figures, opened in place from the Publishers list.
 *
 * The counts, payout, revenue and profit are the publisher's row of the Sales
 * screen for the same period (`GET /api/v1/publishers/:id/stats` reads them
 * with the same helper), so the drawer and Revenue cannot disagree. Revenue
 * and profit arrive only for the agency's owner; a publisher never sees them.
 *
 * The period is a name the server resolves, as on every white-label screen.
 * "Last 7 days" is not one of the server's names, so it is sent as the custom
 * range of the last seven New York calendar days.
 */

type Preset = 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'THIS_MONTH' | 'LAST_MONTH';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'LAST_7', label: 'Last 7 days' },
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
];

/** The query string a preset asks with. */
export function presetQuery(preset: Preset, now: Date = new Date()): string {
  if (preset === 'LAST_7') {
    const { from, to } = lastNewYorkDays(7, now);
    return periodQuery('CUSTOM', from, to);
  }
  return periodQuery(preset as PeriodKey, '', '');
}

export interface PublisherStatsResponse {
  period?: { key: string; label: string; from: string; to: string; days: number };
  totalCalls: number;
  billableCalls: number;
  billableToBuyers?: number;
  billableAgentAnswered?: number;
  payout: number;
  /** Owner only. */
  revenue?: number;
  /** Owner only. */
  profit?: number;
  averageConnectedDuration: number;
  topCampaigns: Array<{
    campaignId: string;
    campaignName: string;
    callsCount: number;
    payout: number;
  }>;
  recentCalls: Array<{
    id: string;
    createdAt: string;
    callerId?: string;
    billable: boolean;
    payout?: number;
    campaign?: { name: string } | null;
  }>;
}

interface DailyEntry {
  day: string;
  calls: number;
  billable: number;
  payout: number;
}

export function PublisherStatsDrawer({
  publisher,
  onOpenChange,
}: {
  /** The publisher to show; null closes the drawer. */
  publisher: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [preset, setPreset] = useState<Preset>('LAST_7');
  const [stats, setStats] = useState<PublisherStatsResponse | null>(null);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publisherId = publisher?.id ?? null;

  // A different publisher starts from a blank drawer, not the last one's figures.
  useEffect(() => {
    setStats(null);
    setDaily([]);
  }, [publisherId]);

  useEffect(() => {
    if (!publisherId) return;
    let cancelled = false;
    const query = presetQuery(preset);
    setLoading(true);
    setError(null);
    void Promise.all([
      apiClient.get<PublisherStatsResponse>(`/api/v1/publishers/${publisherId}/stats?${query}`),
      apiClient.get<Envelope<{ days: DailyEntry[] }>>(
        `/api/v1/publishers/${publisherId}/daily?${query}`
      ),
    ])
      .then(([statsRes, dailyRes]) => {
        if (cancelled) return;
        if (statsRes.data) setStats(statsRes.data);
        else setError(statsRes.error?.message ?? 'Could not load stats.');
        setDaily(payload(dailyRes)?.days ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load stats.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publisherId, preset]);

  const period = stats?.period;
  const chartData = daily.map(entry => ({
    name: formatDayLabel(entry.day),
    Calls: entry.calls,
    Billable: entry.billable,
  }));

  return (
    <SheetDrawer
      open={publisher !== null}
      onOpenChange={onOpenChange}
      title="Publisher stats"
      description={
        publisher
          ? period
            ? `${publisher.name} · ${
                period.from === period.to
                  ? formatDayLabel(period.from)
                  : formatDayRange(period.from, period.to)
              }`
            : publisher.name
          : undefined
      }
      footer={
        <Link
          href="/publishers?tab=payouts"
          onClick={() => onOpenChange(false)}
          className="t-body text-ink underline-offset-2 hover:underline"
        >
          Payouts
        </Link>
      }
    >
      <div className="border-b border-rule px-4 py-3">
        <Segmented aria-label="Period">
          {PRESETS.map(option => (
            <SegmentedItem
              key={option.key}
              active={preset === option.key}
              aria-pressed={preset === option.key}
              onClick={() => setPreset(option.key)}
            >
              {option.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      {error ? (
        <p className="px-4 py-3 t-meta text-dropped-ink">{error}</p>
      ) : !stats ? (
        <div className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : (
        <div className={loading ? 'opacity-60' : undefined}>
          <DrawerSection title="Calls">
            <DrawerField label="Calls">{count(stats.totalCalls)}</DrawerField>
            <DrawerField label="Billable">{count(stats.billableCalls)}</DrawerField>
            <DrawerField label="To buyers">{count(stats.billableToBuyers)}</DrawerField>
            <DrawerField label="Answered by your agents">
              {count(stats.billableAgentAnswered)}
            </DrawerField>
            <DrawerField label="Avg connected">
              {duration(stats.averageConnectedDuration)}
            </DrawerField>
          </DrawerSection>

          <DrawerSection title="Money">
            <DrawerField label="Payout owed">{dollars(stats.payout)}</DrawerField>
            {stats.revenue !== undefined ? (
              <DrawerField label="Revenue">{dollars(stats.revenue)}</DrawerField>
            ) : null}
            {stats.profit !== undefined ? (
              <DrawerField label="Profit">{dollars(stats.profit)}</DrawerField>
            ) : null}
          </DrawerSection>

          <section className="border-b border-rule px-4 py-3">
            <h3 className="t-label mb-2 text-ink-3">Calls per day</h3>
            {chartData.length > 1 ? (
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--rule)" />
                    <XAxis
                      dataKey="name"
                      stroke="var(--ink-3)"
                      style={{ fontSize: 10 }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--ink-3)"
                      style={{ fontSize: 10 }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--rule)',
                        color: 'var(--ink)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Calls"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      fill="var(--brand)"
                      fillOpacity={0.1}
                    />
                    <Area
                      type="monotone"
                      dataKey="Billable"
                      stroke="var(--brand-ink)"
                      strokeWidth={2}
                      fill="var(--brand-ink)"
                      fillOpacity={0.1}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="t-meta text-ink-3">
                {chartData.length === 1
                  ? `${count(chartData[0].Calls)} calls, ${count(chartData[0].Billable)} billable.`
                  : 'No days in this period.'}
              </p>
            )}
          </section>

          <DrawerSection title="Top campaigns">
            {stats.topCampaigns.length === 0 ? (
              <p className="t-meta text-ink-3">No calls in this period.</p>
            ) : (
              stats.topCampaigns.map(campaign => (
                <DrawerField key={campaign.campaignId} label={campaign.campaignName}>
                  {count(campaign.callsCount)} calls · {dollars(campaign.payout)}
                </DrawerField>
              ))
            )}
          </DrawerSection>

          <DrawerSection title="Recent calls">
            {stats.recentCalls.length === 0 ? (
              <p className="t-meta text-ink-3">No calls in this period.</p>
            ) : (
              stats.recentCalls.map(call => (
                <DrawerField key={call.id} label={new Date(call.createdAt).toLocaleString()}>
                  <Link
                    href={`/calls?call=${encodeURIComponent(call.id)}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {call.callerId ? formatPhoneNumber(call.callerId) : 'Call'}
                  </Link>
                  <span className="t-meta text-ink-3">
                    {' · '}
                    {call.billable ? 'Billable' : 'Not billable'}
                    {call.campaign?.name ? ` · ${call.campaign.name}` : ''}
                  </span>
                </DrawerField>
              ))
            )}
          </DrawerSection>
        </div>
      )}
    </SheetDrawer>
  );
}
