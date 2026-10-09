'use client';

import { FEEDBACK_CATEGORIES } from '@hopwhistle/shared';
import {
  CheckCircle2,
  Hammer,
  Inbox,
  ListChecks,
  MessageSquarePlus,
  Plus,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import {
  EmptyState,
  Notice,
  Pagination,
  Panel,
  Segmented,
  SegmentedItem,
} from '@/components/domain';
import { navFor } from '@/components/layout/nav-config';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useBrand } from '@/hooks/use-brand';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  AGENCY_FILTERS,
  categoryLabel,
  productAreasFor,
  type AgencyFilterKey,
  type FeedbackItem,
  type ListMeta,
  type RoadmapOverview,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackRowSkeleton, useDebounced } from './feedback-bits';
import { FeedbackDetailDrawer } from './feedback-detail-drawer';
import { FeedbackRow, MyFeedbackRow, ShippedCard } from './feedback-row';
import { SubmitFeedbackDialog } from './submit-feedback-dialog';

const PAGE_SIZE = 20;
/** How many of each roadmap column the overview shows before "View all". */
const OVERVIEW_ROWS = 4;

type FilterKey = AgencyFilterKey | 'organization';

/**
 * Feedback & Roadmap, the agency's side.
 *
 * The first screen answers two questions at once: what is happening with what
 * people have already asked for (the summary, the roadmap columns, the
 * viewer's own requests), and how to ask for something new (Submit Feedback,
 * docked in the topbar). A request opens in a drawer over the list, and its
 * address is `?item=<id>` so the emails can link straight to it.
 */
export function FeedbackRoadmap(): JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <FeedbackRoadmapInner />
    </React.Suspense>
  );
}

function FeedbackRoadmapInner(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const auth = useAuth();
  const platform = usePlatformContext();
  const { productName } = useBrand();

  const [overview, setOverview] = React.useState<RoadmapOverview | null>(null);
  const [overviewError, setOverviewError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<FilterKey>(() => {
    const requested = searchParams?.get('filter');
    return requested &&
      (AGENCY_FILTERS.some(f => f.key === requested) || requested === 'organization')
      ? (requested as FilterKey)
      : 'all';
  });
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState<string>('all');
  const [page, setPage] = React.useState(1);
  const [list, setList] = React.useState<{ items: FeedbackItem[]; meta: ListMeta } | null>(null);
  const [listLoading, setListLoading] = React.useState(false);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [busyVote, setBusyVote] = React.useState<string | null>(null);

  const openId = searchParams?.get('item') ?? null;
  const q = useDebounced(search.trim(), 300);
  const listMode = filter !== 'all' || q !== '' || category !== 'all';

  // The areas offered in the form are this viewer's own screens.
  const previewing = platform.previewRole != null || auth.user?.previewRole != null;
  const areas = React.useMemo(
    () =>
      productAreasFor(navFor({ ...auth, previewing, brandTheme: auth.user?.brand?.theme ?? null })),
    [auth, previewing]
  );

  const setParams = React.useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      for (const [key, value] of Object.entries(next)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(`${pathname ?? '/feedback'}${query ? `?${query}` : ''}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const loadOverview = React.useCallback(async () => {
    const response = await apiClient.get<Envelope<RoadmapOverview>>('/api/v1/feedback/roadmap');
    const data = payload(response);
    if (response.error || !data) {
      setOverviewError(response.error?.message ?? 'Could not load Feedback & Roadmap.');
      return;
    }
    setOverviewError(null);
    setOverview(data);
  }, []);

  const loadList = React.useCallback(async () => {
    if (!listMode) return;
    setListLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (filter === 'mine') params.set('view', 'mine');
      if (filter === 'organization') params.set('view', 'organization');
      const statuses = AGENCY_FILTERS.find(f => f.key === filter)?.statuses ?? [];
      if (statuses.length > 0) params.set('status', statuses.join(','));
      if (q) params.set('q', q);
      if (category !== 'all') params.set('category', category);
      const response = await apiClient.get<Envelope<FeedbackItem[]> & { meta: ListMeta }>(
        `/api/v1/feedback?${params.toString()}`
      );
      const items = payload(response);
      if (response.error || !items) {
        toast.error('Could not load feedback', response.error?.message);
        return;
      }
      setList({
        items,
        meta: response.data?.meta ?? { page, pageSize: PAGE_SIZE, total: items.length },
      });
    } finally {
      setListLoading(false);
    }
  }, [listMode, page, filter, q, category]);

  React.useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  React.useEffect(() => setPage(1), [filter, q, category]);

  const refresh = React.useCallback(() => {
    void loadOverview();
    void loadList();
  }, [loadOverview, loadList]);

  function chooseFilter(next: FilterKey) {
    setFilter(next);
    setParams({ filter: next === 'all' ? null : next });
  }

  function patchItem(id: string, change: Partial<FeedbackItem>) {
    const apply = (items: FeedbackItem[]) =>
      items.map(i => (i.id === id ? { ...i, ...change } : i));
    setList(current => (current ? { ...current, items: apply(current.items) } : current));
    setOverview(current =>
      current
        ? {
            ...current,
            sections: Object.fromEntries(
              Object.entries(current.sections).map(([key, section]) => [
                key,
                { ...section, items: apply(section.items) },
              ])
            ) as RoadmapOverview['sections'],
            mine: { ...current.mine, items: apply(current.mine.items) },
          }
        : current
    );
  }

  async function toggleInterest(item: FeedbackItem) {
    setBusyVote(item.id);
    try {
      const response = item.viewerInterested
        ? await apiClient.delete<Envelope<{ interestCount: number }>>(
            `/api/v1/feedback/${item.id}/vote`
          )
        : await apiClient.post<Envelope<{ interestCount: number }>>(
            `/api/v1/feedback/${item.id}/vote`,
            {}
          );
      const data = payload(response);
      if (response.error || !data) {
        toast.error('That did not go through', response.error?.message);
        return;
      }
      patchItem(item.id, {
        viewerInterested: !item.viewerInterested,
        interestCount: data.interestCount,
      });
      if (!item.viewerInterested) {
        toast.success(
          'Added your support',
          'You’ll see a “New update” marker when the product team posts on it.'
        );
      }
    } finally {
      setBusyVote(null);
    }
  }

  const open = (item: FeedbackItem | string) =>
    setParams({ item: typeof item === 'string' ? item : item.id });

  const sections = overview?.sections;
  const orgAdmin = overview?.viewer.orgAdmin ?? false;
  const filters: Array<{ key: FilterKey; label: string; badge?: number }> = [
    ...AGENCY_FILTERS.map(f => ({
      key: f.key as FilterKey,
      label: f.label,
      badge: f.key === 'mine' ? overview?.mineUnreadCount : undefined,
    })),
    ...(orgAdmin ? [{ key: 'organization' as FilterKey, label: 'Our Agency' }] : []),
  ];

  return (
    <div className="page-canvas !gap-5">
      <PageHeader
        actions={
          <Button onClick={() => setSubmitOpen(true)} data-submit-feedback="">
            <Plus aria-hidden className="mr-1.5 h-4 w-4" />
            Submit Feedback
          </Button>
        }
      />

      {/* What this is, and the state of the roadmap at a glance. */}
      <section className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between xl:gap-8">
        <div className="min-w-0 max-w-[600px]">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            Help shape {productName}
          </h2>
          <p className="mt-1 t-body text-ink-2">
            Tell us what would make the platform better for you. Submit an idea, report a problem,
            or request an improvement — then follow it from review through release.
          </p>
        </div>
        <div
          className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.3fr] xl:w-[660px]"
          aria-label="Roadmap summary"
        >
          <SummaryTile
            label="Under Review"
            count={sections?.underReview.count}
            icon={Inbox}
            active={filter === 'review'}
            onClick={() => chooseFilter(filter === 'review' ? 'all' : 'review')}
          />
          <SummaryTile
            label="Planned"
            count={sections?.planned.count}
            icon={ListChecks}
            active={filter === 'planned'}
            onClick={() => chooseFilter(filter === 'planned' ? 'all' : 'planned')}
          />
          <SummaryTile
            label="In Progress"
            count={sections?.inProgress.count}
            icon={Hammer}
            active={filter === 'progress'}
            onClick={() => chooseFilter(filter === 'progress' ? 'all' : 'progress')}
          />
          <SummaryTile
            label="Recently Shipped"
            count={sections?.recentlyShipped.count}
            icon={CheckCircle2}
            tone="live"
            active={filter === 'shipped'}
            onClick={() => chooseFilter(filter === 'shipped' ? 'all' : 'shipped')}
          />
        </div>
      </section>

      {overviewError ? <Notice tone="error" title={overviewError} /> : null}

      {/* Filters and search, one row. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Segmented aria-label="Show" className="self-start">
          {filters.map(f => (
            <SegmentedItem
              key={f.key}
              active={filter === f.key}
              onClick={() => chooseFilter(f.key)}
              data-filter={f.key}
            >
              {f.label}
              {f.badge ? (
                <span
                  className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-semibold text-brand-fg"
                  aria-label={`${f.badge} of yours with news`}
                >
                  {f.badge}
                </span>
              ) : null}
            </SegmentedItem>
          ))}
        </Segmented>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1 lg:w-[300px] lg:flex-none">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search ideas, requests, and updates…"
              aria-label="Search ideas, requests, and updates"
              className="h-9 pl-8"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger
              className={cn(
                'h-9 w-[112px] shrink-0 sm:w-[132px]',
                category !== 'all' && 'border-brand-ink bg-brand-tint text-brand-ink'
              )}
              aria-label="Kind of feedback"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {FEEDBACK_CATEGORIES.map(value => (
                <SelectItem key={value} value={value}>
                  {categoryLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {listMode ? (
            <ListPanel
              title={filters.find(f => f.key === filter)?.label ?? 'Results'}
              filter={filter}
              searching={q !== '' || category !== 'all'}
              list={list}
              loading={listLoading}
              busyVote={busyVote}
              onOpen={open}
              onToggleInterest={item => void toggleInterest(item)}
              onPageChange={setPage}
              onSubmit={() => setSubmitOpen(true)}
              onClear={() => {
                setSearch('');
                setCategory('all');
                chooseFilter('all');
              }}
            />
          ) : !overview ? (
            <Panel>
              <SectionHeader title="In Progress" />
              <ul className="divide-y divide-rule">
                {Array.from({ length: 4 }, (_, i) => (
                  <FeedbackRowSkeleton key={i} />
                ))}
              </ul>
            </Panel>
          ) : sections &&
            sections.inProgress.count + sections.planned.count + sections.underReview.count ===
              0 ? (
            <Panel>
              <EmptyState
                size="page"
                icon={MessageSquarePlus}
                headline="The roadmap starts with you"
                body={`Nothing is under review, planned or in progress yet. Tell the product team what would make ${productName} better, and you’ll see it move from review to release here.`}
                action={{ label: 'Submit Feedback', onClick: () => setSubmitOpen(true) }}
              />
            </Panel>
          ) : (
            <>
              <RoadmapSection
                title="In Progress"
                hint="Being built or tested right now"
                section={sections?.inProgress}
                busyVote={busyVote}
                onOpen={open}
                onToggleInterest={item => void toggleInterest(item)}
                onViewAll={() => chooseFilter('progress')}
              />
              <RoadmapSection
                title="Planned"
                hint="Accepted and queued for development"
                section={sections?.planned}
                busyVote={busyVote}
                onOpen={open}
                onToggleInterest={item => void toggleInterest(item)}
                onViewAll={() => chooseFilter('planned')}
              />
              <RoadmapSection
                title="Under Review"
                hint="Being evaluated by the product team"
                section={sections?.underReview}
                busyVote={busyVote}
                onOpen={open}
                onToggleInterest={item => void toggleInterest(item)}
                onViewAll={() => chooseFilter('review')}
              />
            </>
          )}
        </div>

        {/* The viewer's own requests, and what shipped. */}
        <aside
          className="flex min-w-0 flex-col gap-5"
          aria-label="Your feedback and recent releases"
        >
          {filter === 'mine' ? null : (
            <Panel data-panel="my-feedback">
              <SectionHeader
                title="My Feedback"
                count={overview?.mine.count}
                action={
                  overview && overview.mine.count > overview.mine.items.length ? (
                    <ViewAll onClick={() => chooseFilter('mine')} />
                  ) : null
                }
              />
              {!overview ? (
                <div className="space-y-2 p-4" aria-hidden>
                  <div className="h-4 w-3/4 animate-pulse rounded bg-sunken" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-sunken" />
                </div>
              ) : overview.mine.items.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="t-body font-medium text-ink">You haven’t submitted anything yet</p>
                  <p className="mt-1 t-meta text-ink-2">
                    See something we could make better? Tell the product team.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setSubmitOpen(true)}
                  >
                    Submit Feedback
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-rule">
                  {overview.mine.items.map(item => (
                    <MyFeedbackRow key={item.id} item={item} onOpen={open} />
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel data-panel="recently-shipped">
            <SectionHeader
              title="Recently Shipped"
              count={overview?.sections.recentlyShipped.count}
              action={
                overview &&
                overview.sections.recentlyShipped.count >
                  overview.sections.recentlyShipped.items.length ? (
                  <ViewAll onClick={() => chooseFilter('shipped')} />
                ) : null
              }
            />
            {!overview ? (
              <div className="h-20 animate-pulse bg-sunken/50" aria-hidden />
            ) : overview.sections.recentlyShipped.items.length === 0 ? (
              <p className="px-4 py-5 t-meta text-ink-2">
                Nothing has shipped in the last {overview.recentlyShippedDays} days yet. When a
                request is released, it lands here with what changed.
              </p>
            ) : (
              <ul className="divide-y divide-rule">
                {overview.sections.recentlyShipped.items.slice(0, 4).map(item => (
                  <ShippedCard key={item.id} item={item} onOpen={open} />
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      <SubmitFeedbackDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        areas={areas}
        productName={productName}
        onSubmitted={refresh}
        onView={id => open(id)}
      />
      <FeedbackDetailDrawer
        id={openId}
        onClose={() => setParams({ item: null })}
        onChanged={refresh}
        onOpenOther={id => open(id)}
      />
    </div>
  );
}

function SummaryTile({
  label,
  count,
  icon: Icon,
  active,
  tone = 'brand',
  onClick,
}: {
  label: string;
  count: number | undefined;
  icon: LucideIcon;
  active: boolean;
  tone?: 'brand' | 'live';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2.5 rounded-card border bg-surface px-3 py-2.5 text-left shadow-card transition-[border-color,background-color] duration-150',
        'hover:border-rule-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-brand-ink/50 bg-brand-tint/50' : 'border-rule'
      )}
      data-summary={label}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-control',
          tone === 'live' ? 'bg-live-tint text-live-ink' : 'bg-brand-tint text-brand-ink'
        )}
      >
        <Icon aria-hidden className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[20px] font-semibold leading-none tabular-nums text-ink">
          {count ?? (
            <span className="inline-block h-5 w-6 animate-pulse rounded bg-sunken align-middle" />
          )}
        </span>
        <span className="mt-1 block truncate whitespace-nowrap t-meta text-ink-2">{label}</span>
      </span>
    </button>
  );
}

function SectionHeader({
  title,
  hint,
  count,
  action,
}: {
  title: string;
  hint?: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3 min-[1440px]:px-6">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="t-label uppercase tracking-[0.06em] text-ink-2">{title}</h2>
        {count !== undefined ? (
          <span className="t-meta tabular-nums text-ink-3">{count}</span>
        ) : null}
        {hint ? (
          <span className="hidden truncate t-meta text-ink-3 sm:inline">· {hint}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function ViewAll({ onClick, count }: { onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 t-meta font-medium text-brand-ink hover:underline"
    >
      View all{count !== undefined ? ` ${count}` : ''} →
    </button>
  );
}

function RoadmapSection({
  title,
  hint,
  section,
  busyVote,
  onOpen,
  onToggleInterest,
  onViewAll,
}: {
  title: string;
  hint: string;
  section: RoadmapOverview['sections']['planned'] | undefined;
  busyVote: string | null;
  onOpen: (item: FeedbackItem) => void;
  onToggleInterest: (item: FeedbackItem) => void;
  onViewAll: () => void;
}) {
  // An empty column is not drawn: three empty boxes say less than none.
  if (!section || section.count === 0) return null;
  const shown = section.items.slice(0, OVERVIEW_ROWS);
  return (
    <Panel data-section={title}>
      <SectionHeader
        title={title}
        hint={hint}
        count={section.count}
        action={
          section.count > shown.length ? (
            <ViewAll onClick={onViewAll} count={section.count} />
          ) : null
        }
      />
      <ul className="divide-y divide-rule">
        {shown.map(item => (
          <FeedbackRow
            key={item.id}
            item={item}
            onOpen={onOpen}
            onToggleInterest={onToggleInterest}
            busy={busyVote === item.id}
          />
        ))}
      </ul>
    </Panel>
  );
}

function ListPanel({
  title,
  filter,
  searching,
  list,
  loading,
  busyVote,
  onOpen,
  onToggleInterest,
  onPageChange,
  onSubmit,
  onClear,
}: {
  title: string;
  filter: FilterKey;
  searching: boolean;
  list: { items: FeedbackItem[]; meta: ListMeta } | null;
  loading: boolean;
  busyVote: string | null;
  onOpen: (item: FeedbackItem) => void;
  onToggleInterest: (item: FeedbackItem) => void;
  onPageChange: (page: number) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  return (
    <Panel data-list={filter}>
      <SectionHeader title={searching ? 'Results' : title} count={list?.meta.total} />
      {!list || (loading && list.items.length === 0) ? (
        <ul className="divide-y divide-rule">
          {Array.from({ length: 4 }, (_, i) => (
            <FeedbackRowSkeleton key={i} />
          ))}
        </ul>
      ) : list.items.length === 0 ? (
        filter === 'mine' && !searching ? (
          <EmptyState
            icon={MessageSquarePlus}
            headline="You haven’t submitted anything yet"
            body="See something we could make better? Tell the product team."
            action={{ label: 'Submit Feedback', onClick: onSubmit }}
          />
        ) : (
          <EmptyState
            variant="filtered"
            headline={
              searching ? 'Nothing matches that search' : `Nothing ${title.toLowerCase()} right now`
            }
            body={
              searching
                ? 'Try other words, or submit it as new feedback.'
                : 'When requests reach this stage, they appear here.'
            }
            action={{ label: 'Show everything', onClick: onClear }}
            secondaryAction={{ label: 'Submit Feedback', onClick: onSubmit }}
          />
        )
      ) : (
        <>
          <ul className={cn('divide-y divide-rule', loading && 'opacity-60')}>
            {list.items.map(item => (
              <FeedbackRow
                key={item.id}
                item={item}
                onOpen={onOpen}
                onToggleInterest={onToggleInterest}
                busy={busyVote === item.id}
              />
            ))}
          </ul>
          {list.meta.total > list.meta.pageSize ? (
            <div className="border-t border-rule px-5 py-2">
              <Pagination
                page={list.meta.page}
                pageSize={list.meta.pageSize}
                total={list.meta.total}
                onPageChange={onPageChange}
                noun="requests"
              />
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
