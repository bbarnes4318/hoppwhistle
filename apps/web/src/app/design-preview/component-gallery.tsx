'use client';

import { Inbox, PhoneOff, SearchX, ServerCrash } from 'lucide-react';
import * as React from 'react';

import {
  DataTable,
  DurationBar,
  EmptyState,
  FilterBar,
  LiveStrip,
  MoneyCell,
  Pagination,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  PhoneCell,
  RecordingPlayer,
  SavedViews,
  SheetDrawer,
  DrawerField,
  DrawerSection,
  StatTile,
  StatTileRow,
  StatusChip,
  type Column,
  type DateRangeValue,
  type LiveConnectionState,
  type SavedView,
} from '@/components/domain';
import { DEFAULT_TONE, ENUM_TONE } from '@/components/domain/status-tones';
import { Button } from '@/components/ui/button';

/* ------------------------------ shared bits ------------------------------- */

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        {sub ? <p className="t-meta mt-0.5 text-ink-3">{sub}</p> : null}
      </PanelHeader>
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return <div className="t-label mb-2 text-ink-3">{children}</div>;
}

/* --------------------------------- data ----------------------------------- */

interface CallRow {
  id: string;
  from: string;
  campaign: string;
  status: string;
  seconds: number;
  threshold: number | null;
  payoutCents: number | null;
}

const CALL_ROWS: CallRow[] = [
  {
    id: 'cal_9f3b2e71',
    from: '+14155550142',
    campaign: 'ACA Tier-1 — Florida',
    status: 'COMPLETED',
    seconds: 96,
    threshold: 60,
    payoutCents: 1840,
  },
  {
    id: 'cal_1a08c4d2',
    from: '+13125558827',
    campaign: 'ACA Tier-1 — Florida',
    status: 'NO_ANSWER',
    seconds: 41,
    threshold: 60,
    payoutCents: null,
  },
  {
    id: 'cal_77be0915',
    from: '+17865553390',
    campaign: 'FE Nationwide',
    status: 'COMPLETED',
    seconds: 152,
    threshold: 60,
    payoutCents: 2215,
  },
  {
    id: 'cal_c3d5f118',
    from: '+16025551174',
    campaign: 'FE Nationwide',
    status: 'DO_NOT_CALL',
    seconds: 0,
    threshold: 60,
    payoutCents: null,
  },
  {
    id: 'cal_44a91b03',
    from: '+12065556621',
    campaign: 'B2B Outbound',
    status: 'RINGING',
    seconds: 18,
    threshold: 60,
    payoutCents: null,
  },
];

const SHARED_SCALE = 180;

const CALL_COLUMNS: Column<CallRow>[] = [
  {
    id: 'from',
    header: 'From',
    cell: r => <PhoneCell number={r.from} />,
    width: '210px',
  },
  {
    id: 'campaign',
    header: 'Campaign',
    cell: r => <span className="truncate">{r.campaign}</span>,
    hideBelow: 'md',
  },
  {
    id: 'status',
    header: 'Status',
    cell: r => <StatusChip value={r.status} enumName="CallStatus" size="sm" />,
    width: '150px',
  },
  {
    id: 'length',
    header: 'Length',
    width: '30%',
    cell: r => (
      <DurationBar
        seconds={r.seconds}
        thresholdSeconds={r.threshold}
        scaleSeconds={SHARED_SCALE}
        showValue
      />
    ),
  },
  {
    id: 'payout',
    header: 'Payout',
    numeric: true,
    width: '110px',
    cell: r => <MoneyCell amount={r.payoutCents} tone="auto" />,
  },
];

/* ------------------------------- StatusChip -------------------------------- */

/**
 * Rather than hand-list chips, this renders straight from the tone tables, so
 * the gallery cannot drift from what StatusChip actually does.
 */
function StatusChipGallery() {
  const byTone = React.useMemo(() => {
    const groups: Record<string, string[]> = {
      live: [],
      ringing: [],
      dropped: [],
      blocked: [],
      money: [],
      neutral: [],
    };
    for (const [value, tone] of Object.entries(DEFAULT_TONE)) groups[tone].push(value);
    return groups;
  }, []);

  const overrideEntries = React.useMemo(
    () =>
      Object.entries(ENUM_TONE).flatMap(([enumName, values]) =>
        Object.keys(values).map(value => ({ enumName, value }))
      ),
    []
  );

  const total = Object.values(byTone).reduce((n, v) => n + v.length, 0);

  return (
    <div className="space-y-5">
      <p className="t-body text-ink-2">
        Every one of the {total} distinct enum value names in{' '}
        <code className="t-data">schema.prisma</code>, grouped by tone. Rendered from the tone table
        itself, so this cannot drift from the component.{' '}
        <code className="t-data">pnpm check:status-tones</code> fails the build if a schema value
        has no tone.
      </p>

      {(['blocked', 'dropped', 'ringing', 'live', 'money', 'neutral'] as const).map(tone => (
        <div key={tone}>
          <StateLabel>
            {tone} · {byTone[tone].length}
            {tone === 'blocked' ? ' — stopped on purpose, never red' : ''}
            {tone === 'dropped' ? ' — actually failed' : ''}
          </StateLabel>
          <div className="flex flex-wrap gap-1.5">
            {byTone[tone].map(v => (
              <StatusChip key={v} value={v} />
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-control bg-sunken p-3">
        <StateLabel>Per-enum overrides — same word, different meaning</StateLabel>
        <p className="t-meta mb-2 text-ink-3">
          Each pair below resolves differently because of the enum it came from.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {overrideEntries.map(({ enumName, value }) => (
            <span key={`${enumName}.${value}`} className="inline-flex items-center gap-1">
              <StatusChip value={value} enumName={enumName} />
              <code className="t-meta text-ink-3">{enumName}</code>
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-control bg-sunken p-3">
        <StateLabel>Sizes and options</StateLabel>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip value="COMPLETED" enumName="CallStatus" size="sm" />
          <StatusChip value="COMPLETED" enumName="CallStatus" size="md" />
          <StatusChip value="COMPLETED" enumName="CallStatus" dot={false} />
          <StatusChip value="COMPLETED" label="Custom label" />
          <StatusChip value="ANYTHING_UNMAPPED" />
          <span className="t-meta text-ink-3">← unmapped falls back to neutral</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- StatTile --------------------------------- */

function StatTileGallery() {
  return (
    <div className="space-y-4">
      <p className="t-body text-ink-2">
        The sparkline lane is reserved on every tile. The third tile has no series and the fourth is
        loading — all four figures still sit on one baseline.
      </p>
      <StatTileRow>
        <StatTile
          label="Earnings today"
          figure={<MoneyCell amount={1840265} size="figure" tone="money" />}
          sub="42 billable of 118"
          delta={{ value: '12.4%', direction: 'up' }}
          series={[3, 5, 4, 8, 7, 11, 9, 14, 18]}
        />
        <StatTile
          label="Abandon rate"
          figure="6.2%"
          sub="target under 8%"
          // `good: 'down'` — a falling abandon rate is good news.
          delta={{ value: '1.8pt', direction: 'down', good: 'down' }}
          series={[14, 12, 13, 10, 9, 8, 7, 6, 6]}
        />
        <StatTile label="Calls in flight" figure="7" sub="live right now" />
        <StatTile label="Avg time to answer" figure="—" loading />
      </StatTileRow>

      <StateLabel>Emphasis — the one number the page is about</StateLabel>
      <div className="max-w-[260px]">
        <StatTile
          emphasis
          label="Billable rate"
          figure="35.6%"
          sub="42 of 118 calls"
          delta={{ value: '4.1pt', direction: 'down', good: 'up' }}
          series={[40, 39, 41, 38, 37, 36, 36, 35]}
        />
      </div>
    </div>
  );
}

/* ------------------------------- DataTable --------------------------------- */

function DataTableGallery({ onOpenDrawer }: { onOpenDrawer: (r: CallRow) => void }) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <StateLabel>Populated — click or press Enter on a row</StateLabel>
        <p className="t-meta mb-2 text-ink-3">
          Tab once to enter the table, then arrow up/down between rows, Home/End to jump.
        </p>
        <div className="overflow-hidden rounded-card border border-rule">
          <DataTable
            caption="Example call log"
            columns={CALL_COLUMNS}
            rows={CALL_ROWS}
            rowKey={r => r.id}
            isRowActive={r => r.id === activeId}
            onRowActivate={r => {
              setActiveId(r.id);
              onOpenDrawer(r);
            }}
          />
          <Pagination page={1} pageSize={25} total={1284} noun="calls" onPageChange={() => {}} />
        </div>
      </div>

      <div>
        <StateLabel>Loading</StateLabel>
        <div className="overflow-hidden rounded-card border border-rule">
          <DataTable
            columns={CALL_COLUMNS}
            rows={[]}
            rowKey={(_, i) => String(i)}
            loading
            loadingRows={4}
          />
        </div>
      </div>

      <div>
        <StateLabel>Empty</StateLabel>
        <div className="overflow-hidden rounded-card border border-rule">
          <DataTable
            columns={CALL_COLUMNS}
            rows={[]}
            rowKey={(r: CallRow) => r.id}
            empty={{
              headline: 'No calls in this window',
              body: 'Calls appear here within a few seconds of connecting. Widen the date range if you expected some.',
              icon: PhoneOff,
              action: { label: 'Clear filters' },
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- EmptyState -------------------------------- */

function EmptyStateGallery() {
  return (
    <div className="space-y-3">
      <p className="t-body text-ink-2">
        The headline names the space and the action is a verb. Never &ldquo;No data found&rdquo;.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-card border border-rule">
          <StateLabel>
            <span className="block px-3 pt-3">Empty</span>
          </StateLabel>
          <EmptyState
            headline="No campaigns yet"
            body="A campaign routes calls from your publishers to the buyers paying for them."
            icon={Inbox}
            action={{ label: 'Create a campaign' }}
          />
        </div>
        <div className="rounded-card border border-rule">
          <StateLabel>
            <span className="block px-3 pt-3">Filtered</span>
          </StateLabel>
          <EmptyState
            variant="filtered"
            headline="No calls match these filters"
            body="Four filters are narrowing 1,284 calls down to none."
            icon={SearchX}
            action={{ label: 'Clear filters' }}
            secondaryAction={{ label: 'Widen to 30 days' }}
          />
        </div>
        <div className="rounded-card border border-rule">
          <StateLabel>
            <span className="block px-3 pt-3">Error</span>
          </StateLabel>
          <EmptyState
            variant="error"
            headline="Could not load calls"
            body="The call service did not respond. Your data is safe."
            icon={ServerCrash}
            action={{ label: 'Try again' }}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- LiveStrip -------------------------------- */

function LiveStripGallery() {
  // Ticks so the flash-and-settle behaviour is visible on the page.
  const [earnings, setEarnings] = React.useState(184026);
  const [inFlight, setInFlight] = React.useState(7);

  React.useEffect(() => {
    const t = setInterval(() => {
      setEarnings(v => v + Math.round(Math.random() * 900));
      setInFlight(() => 4 + Math.floor(Math.random() * 8));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

  const roles: {
    role: string;
    conn: LiveConnectionState;
    metrics: React.ComponentProps<typeof LiveStrip>['metrics'];
  }[] = [
    {
      role: 'Publisher — live',
      conn: 'live',
      metrics: [
        { id: 'a', label: 'Calls live', value: String(inFlight), tone: 'live' },
        { id: 'b', label: 'Billable today', value: '42', sub: 'of 118 calls' },
        { id: 'c', label: 'Earnings today', value: money(earnings), tone: 'money' },
      ],
    },
    {
      role: 'Buyer — live',
      conn: 'live',
      metrics: [
        { id: 'a', label: 'Calls live', value: String(inFlight), tone: 'live' },
        { id: 'b', label: 'Spend today', value: '$3,412.00', sub: 'of $5,000 cap', tone: 'money' },
        { id: 'c', label: 'Billable rate', value: '38%', sub: 'target 45%', tone: 'ringing' },
      ],
    },
    {
      role: 'Admin — degraded, polling',
      conn: 'degraded',
      metrics: [
        { id: 'a', label: 'In flight', value: '31' },
        { id: 'b', label: 'Answer rate', value: '71%', sub: 'this hour' },
        { id: 'c', label: 'Abandon rate', value: '9.4%', sub: 'over 8% target', tone: 'dropped' },
        { id: 'd', label: 'Revenue run rate', value: '$1,840/hr', tone: 'money' },
      ],
    },
    {
      role: 'Offline — never show stale numbers as live',
      conn: 'offline',
      metrics: [
        { id: 'a', label: 'In flight', value: '—' },
        { id: 'b', label: 'Answer rate', value: '—' },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <p className="t-body text-ink-2">
        Values tick every three seconds here so the flash is visible. Under{' '}
        <code className="t-data">prefers-reduced-motion</code> the flash is replaced by a static dot
        beside the number.
      </p>
      {roles.map(r => (
        <div key={r.role}>
          <StateLabel>{r.role}</StateLabel>
          <div className="overflow-hidden rounded-card border border-rule">
            <LiveStrip
              metrics={r.metrics}
              connection={r.conn}
              lastUpdated={r.conn === 'live' ? null : new Date()}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ cells + misc ------------------------------- */

function CellGallery() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <StateLabel>MoneyCell</StateLabel>
        <table className="w-full">
          <tbody>
            {[
              ['Positive', <MoneyCell key="a" amount={1840} tone="auto" />],
              ['Negative', <MoneyCell key="b" amount={-2500} tone="auto" />],
              ['Zero', <MoneyCell key="c" amount={0} tone="auto" />],
              ['Null', <MoneyCell key="d" amount={null} />],
              ['Signed', <MoneyCell key="e" amount={1840} signed tone="auto" />],
              ['EUR', <MoneyCell key="f" amount={1840} currency="EUR" />],
              ['JPY — zero-decimal', <MoneyCell key="g" amount={1840} currency="JPY" />],
              ['Major units', <MoneyCell key="h" amount={18.4} unit="major" />],
              ['Large', <MoneyCell key="i" amount={184026500} />],
              ['Figure size', <MoneyCell key="j" amount={1840265} size="figure" tone="money" />],
            ].map(([label, el]) => (
              <tr key={label as string}>
                <td className="t-meta py-1 pr-3 text-ink-3">{label as string}</td>
                <td className="py-1 text-right">{el as React.ReactNode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <StateLabel>PhoneCell — click a number to copy</StateLabel>
        <div className="space-y-2">
          <PhoneCell number="+14155550142" />
          <PhoneCell
            number="+14155550142"
            status={{ value: 'ACTIVE', enumName: 'PhoneNumberStatus' }}
          />
          <PhoneCell
            number="+16025551174"
            status={{ value: 'DO_NOT_CALL', enumName: 'LeadStatus' }}
          />
          <PhoneCell number="+442071838750" />
          <PhoneCell number="+14155550142" copyable={false} />
          <PhoneCell number={null} />
        </div>
      </div>
    </div>
  );
}

/* --------------------------- filters + views ------------------------------- */

function FilterGallery() {
  const [search, setSearch] = React.useState('');
  const [selects, setSelects] = React.useState<Record<string, string | null>>({
    status: 'COMPLETED',
    buyer: null,
  });
  const [range, setRange] = React.useState<DateRangeValue>({ from: '2026-08-01', to: null });
  const [views, setViews] = React.useState<SavedView<unknown>[]>([
    { id: 'v1', name: 'Disputed this week', filters: {} },
    { id: 'v2', name: 'Under 40% billable', filters: {} },
  ]);
  const [activeView, setActiveView] = React.useState<string | null>('v1');

  return (
    <div className="overflow-hidden rounded-card border border-rule">
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search calls or numbers' }}
        selects={[
          {
            id: 'status',
            label: 'Status',
            value: selects.status,
            options: [
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'NO_ANSWER', label: 'No answer' },
              { value: 'FAILED', label: 'Failed' },
            ],
          },
          {
            id: 'buyer',
            label: 'Buyer',
            value: selects.buyer,
            options: [
              { value: 'b1', label: 'Meridian Health' },
              { value: 'b2', label: 'Coastal Senior' },
            ],
          },
        ]}
        onSelectChange={(id, v) => setSelects(s => ({ ...s, [id]: v }))}
        dateRange={{ value: range, onChange: setRange }}
        onClearAll={() => {
          setSearch('');
          setSelects({ status: null, buyer: null });
          setRange({ from: null, to: null });
        }}
      >
        <SavedViews
          views={views}
          currentFilters={{}}
          activeId={activeView}
          onApply={v => setActiveView(v.id)}
          onCreate={name => {
            const v = { id: `v${Date.now()}`, name, filters: {} };
            setViews(x => [...x, v]);
            setActiveView(v.id);
          }}
          onDelete={id => {
            setViews(x => x.filter(v => v.id !== id));
            setActiveView(c => (c === id ? null : c));
          }}
        />
      </FilterBar>
      <p className="t-meta px-3 py-3 text-ink-3">
        Table would render here. The chips above always say what is narrowing it.
      </p>
    </div>
  );
}

/* --------------------------------- gallery --------------------------------- */

export function ComponentGallery() {
  const [drawerRow, setDrawerRow] = React.useState<CallRow | null>(null);
  const [pagerPage, setPagerPage] = React.useState(3);
  const [pageSize, setPageSize] = React.useState(50);

  return (
    <div className="space-y-6">
      <Section
        title="StatusChip"
        sub="One variant per enum value in apps/api/prisma/schema.prisma — 266 values, 68 enums."
      >
        <StatusChipGallery />
      </Section>

      <Section title="StatTile" sub="The sparkline lane is reserved so figures share a baseline.">
        <StatTileGallery />
      </Section>

      <Section title="DataTable" sub="Sticky header, 40px rows, keyboard row navigation.">
        <DataTableGallery onOpenDrawer={setDrawerRow} />
      </Section>

      <Section title="Pagination" sub="Replaces the three hand-rolled versions.">
        <div className="space-y-3">
          <div className="rounded-card border border-rule">
            <Pagination
              page={pagerPage}
              pageSize={pageSize}
              total={1284}
              noun="calls"
              onPageChange={setPagerPage}
              onPageSizeChange={setPageSize}
            />
          </div>
          <div>
            <StateLabel>First page</StateLabel>
            <div className="rounded-card border border-rule">
              <Pagination
                page={1}
                pageSize={50}
                total={1284}
                noun="calls"
                onPageChange={() => {}}
              />
            </div>
          </div>
          <div>
            <StateLabel>No results</StateLabel>
            <div className="rounded-card border border-rule">
              <Pagination page={1} pageSize={50} total={0} noun="calls" onPageChange={() => {}} />
            </div>
          </div>
          <div>
            <StateLabel>Unknown total — next stays enabled</StateLabel>
            <div className="rounded-card border border-rule">
              <Pagination
                page={2}
                pageSize={50}
                total={null}
                noun="calls"
                onPageChange={() => {}}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyStateGallery />
      </Section>

      <Section title="LiveStrip" sub="Signature 2. Role scoped, with degraded and offline states.">
        <LiveStripGallery />
      </Section>

      <Section title="MoneyCell and PhoneCell">
        <CellGallery />
      </Section>

      <Section title="FilterBar and SavedViews" sub="Active filters are always named as chips.">
        <FilterGallery />
      </Section>

      <Section
        title="RecordingPlayer"
        sub="Waveform with the billable threshold marked, and the same DurationBar expanded."
      >
        <div className="space-y-4">
          <div>
            <StateLabel>With peaks — real audio, duration read from metadata</StateLabel>
            <RecordingPlayer
              src="/sample.wav"
              durationSeconds={96}
              thresholdSeconds={60}
              peaks={Array.from({ length: 120 }, (_, i) => 0.25 + Math.abs(Math.sin(i / 6)) * 0.6)}
            />
          </div>
          <div>
            <StateLabel>No peaks available — flat lane, never a fabricated wave</StateLabel>
            <RecordingPlayer src="/sample.wav" durationSeconds={41} thresholdSeconds={60} />
          </div>
          <div>
            <StateLabel>Unavailable — file gone, or a signed URL that expired</StateLabel>
            <RecordingPlayer
              src="/recording-that-does-not-exist.wav"
              durationSeconds={72}
              thresholdSeconds={60}
            />
          </div>
        </div>
      </Section>

      <Section
        title="SheetDrawer"
        sub="Detail from the right, so the list you found it in survives."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setDrawerRow(CALL_ROWS[0])}
            className="rounded-control bg-money text-white hover:bg-money/90"
          >
            Open a call
          </Button>
          <span className="t-meta text-ink-3">
            Rows in the DataTable above open it too. Esc closes.
          </span>
        </div>
      </Section>

      <Section title="Panel" sub="The only card wrapper. Hairline, never a shadow.">
        <div className="grid gap-3 md:grid-cols-2">
          <Panel>
            <PanelHeader action={<StatusChip value="ACTIVE" enumName="CampaignStatus" size="sm" />}>
              <PanelTitle>With a header action</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <p className="t-body text-ink-2">Standard padded body.</p>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>Flush body, for tables</PanelTitle>
            </PanelHeader>
            <PanelBody flush>
              <DataTable
                columns={CALL_COLUMNS.slice(0, 3)}
                rows={CALL_ROWS.slice(0, 3)}
                rowKey={r => r.id}
                stickyHeader={false}
              />
            </PanelBody>
          </Panel>
        </div>
      </Section>

      <SheetDrawer
        open={drawerRow !== null}
        onOpenChange={o => !o && setDrawerRow(null)}
        title={drawerRow ? `Call ${drawerRow.id}` : ''}
        description="2026-08-30 14:22:07 UTC"
        footer={
          <div className="flex gap-2">
            <Button className="rounded-control bg-money text-white hover:bg-money/90">
              Accept
            </Button>
            <Button variant="outline" className="rounded-control border-rule">
              Dispute
            </Button>
          </div>
        }
      >
        {drawerRow ? (
          <>
            <DrawerSection title="Call">
              <DrawerField label="From">
                <PhoneCell number={drawerRow.from} />
              </DrawerField>
              <DrawerField label="Campaign">{drawerRow.campaign}</DrawerField>
              <DrawerField label="Status">
                <StatusChip value={drawerRow.status} enumName="CallStatus" />
              </DrawerField>
            </DrawerSection>

            <DrawerSection title="Billing decision">
              <DrawerField label="Length">
                <DurationBar
                  seconds={drawerRow.seconds}
                  thresholdSeconds={drawerRow.threshold}
                  scaleSeconds={SHARED_SCALE}
                  size="detail"
                  showValue
                />
              </DrawerField>
              <DrawerField label="Payout">
                <MoneyCell amount={drawerRow.payoutCents} tone="auto" />
              </DrawerField>
            </DrawerSection>

            <DrawerSection title="Recording">
              <RecordingPlayer
                src="/sample.wav"
                durationSeconds={drawerRow.seconds}
                thresholdSeconds={drawerRow.threshold}
                peaks={Array.from({ length: 90 }, (_, i) => 0.2 + Math.abs(Math.cos(i / 5)) * 0.6)}
              />
            </DrawerSection>
          </>
        ) : null}
      </SheetDrawer>
    </div>
  );
}
