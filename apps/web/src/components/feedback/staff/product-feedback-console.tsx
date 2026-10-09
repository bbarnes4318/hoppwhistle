'use client';

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_LABELS,
  FEEDBACK_STATUSES,
  type FeedbackPriority,
} from '@hopwhistle/shared';
import { MessageCircleReply, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import {
  EmptyState,
  Notice,
  Pagination,
  Panel,
  Toolbar,
  ToolbarClear,
  ToolbarSearch,
  ToolbarSelect,
} from '@/components/domain';
import { AGENT_NAV, PLATFORM_NAV, WHITE_LABEL_OWNER_NAV } from '@/components/layout/nav-config';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  ageInDays,
  categoryLabel,
  productAreaLabel,
  productAreasFor,
  compactRelativeTime,
  statusLabel,
  type ListMeta,
  type StaffFeedbackRow,
  type StaffSummary,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackStatusChip, useDebounced } from '../feedback-bits';

import { NewRoadmapItemDialog } from './new-roadmap-item-dialog';
import { StaffFeedbackDrawer } from './staff-feedback-drawer';

const PRIORITY_CLASS: Record<FeedbackPriority, string> = {
  LOW: 'text-ink-3',
  NORMAL: 'text-ink-2',
  HIGH: 'text-ringing-ink font-medium',
  CRITICAL: 'text-dropped-ink font-semibold',
};

/** Every area an agency could have filed under: the agency navs, then staff's. */
const ALL_AREAS = (() => {
  const seen = new Map<string, string>();
  for (const groups of [AGENT_NAV, WHITE_LABEL_OWNER_NAV, PLATFORM_NAV]) {
    for (const area of productAreasFor(groups))
      if (!seen.has(area.value)) seen.set(area.value, area.label);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
})();

interface Filters {
  q: string;
  tenantId: string;
  status: string;
  category: string;
  productArea: string;
  priority: string;
  owner: string;
  sort: string;
  awaiting: boolean;
}

const EMPTY: Filters = {
  q: '',
  tenantId: 'all',
  status: 'open',
  category: 'all',
  productArea: 'all',
  priority: 'all',
  owner: 'all',
  sort: 'recent',
  awaiting: false,
};

/** The status filter's choices: groups first, then each status. */
const STATUS_GROUPS: Record<string, string> = {
  open: 'NEW,UNDER_REVIEW,NEEDS_INFO,CONSIDERING,PLANNED,IN_PROGRESS,TESTING',
  triage: 'NEW,UNDER_REVIEW,CONSIDERING',
  roadmap: 'PLANNED,IN_PROGRESS,TESTING',
  closed: 'SHIPPED,NOT_PLANNED',
};

/**
 * Admin -> Product feedback: every agency's feedback, as the product team runs
 * it. Counts across the top (each one a filter), one row of filters, the queue,
 * and a drawer to triage, answer and ship each request.
 */
export function ProductFeedbackConsole(): JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <ConsoleInner />
    </React.Suspense>
  );
}

function ConsoleInner(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [summary, setSummary] = React.useState<StaffSummary | null>(null);
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<{ items: StaffFeedbackRow[]; meta: ListMeta } | null>(
    null
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const q = useDebounced(filters.q.trim(), 300);
  const openId = searchParams?.get('item') ?? null;

  const setOpen = (id: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (id) params.set('item', id);
    else params.delete('item');
    const query = params.toString();
    router.replace(`${pathname ?? ''}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const loadSummary = React.useCallback(async () => {
    const response = await apiClient.get<Envelope<StaffSummary>>(
      '/api/v1/admin/product-feedback/summary'
    );
    const data = payload(response);
    if (data) setSummary(data);
  }, []);

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        sort: filters.sort,
      });
      const status =
        STATUS_GROUPS[filters.status] ?? (filters.status === 'all' ? 'all' : filters.status);
      if (status !== 'all') params.set('status', status);
      if (filters.status === 'all') params.set('status', FEEDBACK_STATUSES.join(','));
      if (q) params.set('q', q);
      if (filters.tenantId !== 'all') params.set('tenantId', filters.tenantId);
      if (filters.category !== 'all') params.set('category', filters.category);
      if (filters.productArea !== 'all') params.set('productArea', filters.productArea);
      if (filters.priority !== 'all') params.set('priority', filters.priority);
      if (filters.owner !== 'all') params.set('assignedToUserId', filters.owner);
      if (filters.awaiting) params.set('awaiting', '1');
      const response = await apiClient.get<Envelope<StaffFeedbackRow[]> & { meta: ListMeta }>(
        `/api/v1/admin/product-feedback?${params.toString()}`
      );
      const items = payload(response);
      if (response.error || !items) {
        setError(response.error?.message ?? 'Could not load the queue.');
        return;
      }
      setError(null);
      setRows({ items, meta: response.data?.meta ?? { page, pageSize: 25, total: items.length } });
    } finally {
      setLoading(false);
    }
  }, [page, filters, q]);

  React.useEffect(() => {
    void loadSummary();
  }, [loadSummary]);
  React.useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const update = (patch: Partial<Filters>) => {
    setFilters(current => ({ ...current, ...patch }));
    setPage(1);
  };
  const refresh = () => {
    void loadSummary();
    void loadRows();
  };

  const counts = summary?.counts;
  const tiles: Array<{
    key: string;
    label: string;
    value: number | undefined;
    apply: Partial<Filters>;
    urgent?: boolean;
  }> = [
    {
      key: 'new',
      label: 'New',
      value: counts?.new,
      apply: { status: 'NEW', awaiting: false },
      urgent: true,
    },
    {
      key: 'review',
      label: 'Needs review',
      value: counts?.underReview,
      apply: { status: 'triage', awaiting: false },
    },
    {
      key: 'info',
      label: 'Needs info',
      value: counts?.needsInfo,
      apply: { status: 'NEEDS_INFO', awaiting: false },
    },
    {
      key: 'awaiting',
      label: 'Awaiting response',
      value: counts?.awaitingResponse,
      apply: { status: 'open', awaiting: true },
      urgent: true,
    },
    {
      key: 'planned',
      label: 'Planned',
      value: counts?.planned,
      apply: { status: 'PLANNED', awaiting: false },
    },
    {
      key: 'progress',
      label: 'In progress',
      value: counts?.inProgress,
      apply: { status: 'roadmap', awaiting: false },
    },
    {
      key: 'shipped',
      label: 'Shipped this month',
      value: counts?.shippedThisMonth,
      apply: { status: 'SHIPPED', awaiting: false, sort: 'recent' },
    },
  ];
  const activeTile = tiles.find(
    t => t.apply.status === filters.status && !!t.apply.awaiting === filters.awaiting
  )?.key;
  const filtered = JSON.stringify({ ...filters, sort: 'recent' }) !== JSON.stringify(EMPTY);

  return (
    <div className="page-canvas !gap-5">
      <PageHeader
        description="Every agency’s feedback: triage it, put it on the roadmap, keep agencies posted, ship it."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden className="mr-1.5 h-4 w-4" />
            New roadmap item
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="Summary">
        {tiles.map(tile => (
          <button
            key={tile.key}
            type="button"
            aria-pressed={activeTile === tile.key}
            onClick={() =>
              update(activeTile === tile.key ? { status: 'open', awaiting: false } : tile.apply)
            }
            className={cn(
              'rounded-card border bg-surface px-3 py-2.5 text-left shadow-card transition-colors duration-150 hover:border-rule-strong',
              activeTile === tile.key ? 'border-brand-ink/50 bg-brand-tint/50' : 'border-rule'
            )}
            data-tile={tile.key}
          >
            <span
              className={cn(
                'block text-[22px] font-semibold leading-none tabular-nums',
                tile.urgent && (tile.value ?? 0) > 0 ? 'text-ringing-ink' : 'text-ink'
              )}
            >
              {tile.value ?? '–'}
            </span>
            <span className="mt-1 block truncate t-meta text-ink-2">{tile.label}</span>
          </button>
        ))}
      </div>

      <Toolbar>
        <ToolbarSearch
          value={filters.q}
          onChange={value => update({ q: value })}
          placeholder="Search title, agency, email or #number"
        />
        <ToolbarSelect
          label="Agency"
          value={filters.tenantId}
          onChange={value => update({ tenantId: value })}
          options={[
            ...(summary?.tenants ?? []).map(t => ({
              value: t.id,
              label: `${t.name} (${t.count})`,
            })),
            { value: 'none', label: 'Product team items' },
          ]}
        />
        <ToolbarSelect
          label="Status"
          value={filters.status}
          allValue="all"
          allLabel="Every status"
          onChange={value => update({ status: value, awaiting: false })}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'triage', label: 'Needs review' },
            { value: 'roadmap', label: 'On the roadmap' },
            { value: 'closed', label: 'Closed' },
            ...FEEDBACK_STATUSES.map(s => ({ value: s, label: statusLabel(s, true) })),
          ]}
        />
        <ToolbarSelect
          label="Kind"
          value={filters.category}
          onChange={value => update({ category: value })}
          options={FEEDBACK_CATEGORIES.map(c => ({ value: c, label: categoryLabel(c) }))}
        />
        <ToolbarSelect
          label="Area"
          value={filters.productArea}
          onChange={value => update({ productArea: value })}
          options={[
            ...(summary?.productAreas ?? []).map(a => ({
              value: a,
              label: productAreaLabel(a) ?? a,
            })),
            { value: 'none', label: 'Not set' },
          ]}
        />
        <ToolbarSelect
          label="Priority"
          value={filters.priority}
          onChange={value => update({ priority: value })}
          options={[...FEEDBACK_PRIORITIES]
            .reverse()
            .map(p => ({ value: p, label: FEEDBACK_PRIORITY_LABELS[p] }))}
        />
        <ToolbarSelect
          label="Owner"
          value={filters.owner}
          onChange={value => update({ owner: value })}
          options={[
            { value: 'none', label: 'Unassigned' },
            ...(summary?.owners ?? []).map(o => ({ value: o.id, label: o.name })),
          ]}
        />
        <ToolbarSelect
          label="Sort"
          value={filters.sort}
          allValue={null}
          onChange={value => update({ sort: value })}
          options={[
            { value: 'recent', label: 'Recently updated' },
            { value: 'interest', label: 'Most interest' },
            { value: 'priority', label: 'Priority' },
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
          ]}
        />
        {filtered ? <ToolbarClear onClick={() => update(EMPTY)} /> : null}
      </Toolbar>

      {error ? <Notice tone="error" title={error} /> : null}

      <Panel>
        {!rows ? (
          <div className="space-y-px" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 animate-pulse border-b border-rule bg-sunken/40" />
            ))}
          </div>
        ) : rows.items.length === 0 ? (
          <EmptyState
            variant={filtered ? 'filtered' : 'empty'}
            headline={filtered ? 'Nothing matches these filters' : 'No feedback yet'}
            body={
              filtered
                ? 'Clear a filter or two to see more.'
                : 'When an agency sends feedback, it lands here as New.'
            }
            action={filtered ? { label: 'Clear filters', onClick: () => update(EMPTY) } : undefined}
          />
        ) : (
          <>
            {/* A table from lg up; cards below it. Never a sideways-scrolling table. */}
            <table className={cn('hidden w-full table-fixed lg:table', loading && 'opacity-60')}>
              <thead>
                <tr className="border-b border-rule text-left t-label text-ink-3">
                  <th className="w-[34%] px-5 py-2.5 font-medium">Request</th>
                  <th className="w-[16%] px-3 py-2.5 font-medium">Agency</th>
                  <th className="w-[7%] px-3 py-2.5 text-right font-medium">Interest</th>
                  <th className="w-[8%] px-3 py-2.5 font-medium">Priority</th>
                  <th className="w-[13%] px-3 py-2.5 font-medium">Status</th>
                  <th className="w-[11%] px-3 py-2.5 font-medium">Owner / target</th>
                  <th className="w-[11%] px-5 py-2.5 text-right font-medium">Age / updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.items.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => setOpen(row.id)}
                    className="cursor-pointer align-top transition-colors duration-150 hover:bg-sunken/60"
                    data-queue-row={row.id}
                  >
                    <td className="px-5 py-3">
                      <p className="truncate t-body font-medium text-ink" title={row.title}>
                        {row.publicTitle ?? row.title}
                      </p>
                      <p className="mt-0.5 truncate t-meta text-ink-3">
                        #{row.number} · {categoryLabel(row.category)}
                        {row.productArea ? ` · ${productAreaLabel(row.productArea)}` : ''}
                        {row.visibility === 'PUBLIC'
                          ? ' · Public'
                          : row.visibility === 'TENANT'
                            ? ' · Agency-wide'
                            : ''}
                      </p>
                      {row.latestUpdate ? (
                        <p className="mt-0.5 truncate t-meta text-ink-2">
                          {row.latestUpdate.kind === 'QUESTION' ? 'Asked: ' : 'Last update: '}
                          {row.latestUpdate.body}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="truncate t-body text-ink">
                        {row.tenant?.name ?? 'Product team'}
                      </p>
                      <p className="truncate t-meta text-ink-3">
                        {row.submittedBy?.name ?? '—'}
                        {row.submittedByRole ? ` · ${row.submittedByRole.toLowerCase()}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right t-body tabular-nums text-ink">
                      {row.interestCount}
                    </td>
                    <td className={cn('px-3 py-3 t-body', PRIORITY_CLASS[row.priority])}>
                      {FEEDBACK_PRIORITY_LABELS[row.priority]}
                    </td>
                    <td className="px-3 py-3">
                      <FeedbackStatusChip status={row.status} staff />
                      {row.awaitingResponse ? (
                        <p className="mt-1 inline-flex items-center gap-1 t-meta font-medium text-ringing-ink">
                          <MessageCircleReply aria-hidden className="h-3 w-3" /> Replied
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <p className="truncate t-body text-ink-2">
                        {row.assignedTo?.name ?? 'Unassigned'}
                      </p>
                      <p className="truncate t-meta text-ink-3">
                        {row.target.kind === 'NONE' ? 'No target' : row.target.label}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <p className="t-body tabular-nums text-ink-2">{ageInDays(row.createdAt)}d</p>
                      <p className="whitespace-nowrap t-meta text-ink-3">
                        {compactRelativeTime(row.updatedAt)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className={cn('divide-y divide-rule lg:hidden', loading && 'opacity-60')}>
              {rows.items.map(row => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(row.id)}
                    className="block w-full px-4 py-3 text-left hover:bg-sunken/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="t-body font-medium text-ink">
                        {row.publicTitle ?? row.title}
                      </span>
                      <FeedbackStatusChip status={row.status} staff />
                    </div>
                    <p className="mt-1 t-meta text-ink-3">
                      #{row.number} · {row.tenant?.name ?? 'Product team'} ·{' '}
                      {categoryLabel(row.category)} · {row.interestCount} interested ·{' '}
                      <span className={PRIORITY_CLASS[row.priority]}>
                        {FEEDBACK_PRIORITY_LABELS[row.priority]}
                      </span>
                    </p>
                    <p className="mt-0.5 t-meta text-ink-3">
                      {row.assignedTo?.name ?? 'Unassigned'} · {ageInDays(row.createdAt)}d old
                      {row.awaitingResponse ? ' · agency replied' : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>

            {rows.meta.total > rows.meta.pageSize ? (
              <div className="border-t border-rule px-5 py-2">
                <Pagination
                  page={rows.meta.page}
                  pageSize={rows.meta.pageSize}
                  total={rows.meta.total}
                  onPageChange={setPage}
                  noun="requests"
                />
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <StaffFeedbackDrawer
        id={openId}
        summary={summary}
        areas={ALL_AREAS}
        onClose={() => setOpen(null)}
        onChanged={refresh}
        onOpenOther={id => setOpen(id)}
      />
      <NewRoadmapItemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenants={summary?.tenants ?? []}
        areas={ALL_AREAS}
        onCreated={id => {
          toast.success('Added to the roadmap');
          refresh();
          setOpen(id);
        }}
      />
    </div>
  );
}
