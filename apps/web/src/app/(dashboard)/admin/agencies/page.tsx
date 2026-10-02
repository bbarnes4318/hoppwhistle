'use client';

import { Download, Loader2, MoreHorizontal, RefreshCw, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { InviteOwnerDialog } from '@/components/agencies/invite-owner-dialog';
import {
  Notice,
  Panel,
  PanelBody,
  SheetDrawer,
  StatTile,
  StatTileRow,
  StatusChip,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { BrandThemeControl } from '@/components/platform/brand-theme-control';
import { NumbersAllowanceControl } from '@/components/platform/numbers-allowance-control';
import {
  SettingsSection,
  SettingsToggleRow,
  selectClass,
} from '@/components/platform/settings-section';
import {
  UpgradePricesPanel,
  UpgradeRequestsPanel,
} from '@/components/platform/upgrade-catalog-admin';
import { UpgradesControl } from '@/components/platform/upgrades-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * NetEnroll's cross-agency view.
 *
 * Platform staff only — the endpoints behind it are gated on the platform
 * capability, and an agency OWNER is refused by the server rather than by this
 * page choosing not to render.
 *
 * Two questions it exists to answer, in this order:
 *
 *   WHAT NEEDS ACTION.  Below the minimum and paused, at the ceiling, a failed
 *                       or unpaid settlement, no valid mandate, suspended.
 *                       Flagged rows sort to the top, because the point of the
 *                       screen is the exceptions.
 *   WHERE DID THE RUN   Settled, failed, or not yet run — per agency, for the
 *   GET TO.             Delivery Day named.
 *
 * Every figure is per agency and computed per agency. There is no pooled
 * cross-tenant aggregate anywhere on it: one agency's number must never be
 * derived from another's traffic.
 *
 * Billing is opt-in per agency. An agency that has not been enrolled is shown
 * as such and carries no flags — it has no mandate and no rate by definition,
 * and badging it for those would put five red flags on every tenant that has
 * not been onboarded and bury the one that needs attention.
 *
 * The export is here because a dry-run period is invoiced by hand and this is
 * the screen somebody is looking at when they do it. It offers a date range and
 * the dry-run / charged split, and it downloads the settlement records rather
 * than what this table renders: the file is raised from the stored figures, not
 * from a page that has rounded them for display.
 */

interface AgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  /**
   * A demo, fixture or test tenant rather than a real agency. The overview only
   * returns these rows when asked with `?includeNonProduction=true`, and always
   * leaves them out of the platform totals.
   */
  isNonProduction: boolean;
  /** On the white-label tier: an agency that also sells calls. */
  whiteLabel?: boolean;
  /** The white-label agency that onboarded this one, or null. */
  parentName?: string | null;
  enrolled: boolean;
  chargesEnabled: boolean;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  rate: number | null;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  revenuePerCall: number | null;
  costPerCall: number | null;
  flags: {
    belowMinimumAndPaused: boolean;
    atCeiling: boolean;
    settlementFailedOrUnpaid: boolean;
    noValidMandate: boolean;
    suspended: boolean;
    /** Enrolled, and no settlement has ever been written for it. */
    enrolledNeverSettled: boolean;
  };
  settlement: {
    status: 'SETTLED' | 'DRY_RUN' | 'HALTED' | 'FAILED' | 'NOT_YET_RUN' | 'NOT_ENROLLED';
    paymentStatus: string | null;
    totalCharged: number | null;
    overrunQuantity: number | null;
    nextBlockQuantity: number | null;
  };
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function money(value: number | null, digits = 2): string {
  if (value === null) return '—';
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** What is standing between an agency and being enrolled. */
const BLOCKER_TEXT: Record<string, string> = {
  NO_BILLING_PROFILE: 'no recorded terms',
  NO_DAILY_BLOCK: 'no daily block',
  NO_MAX_DAILY_DEBIT: 'no maximum daily debit',
  NO_OPENING_RATE: 'no agreed opening rate',
  NO_VALID_MANDATE: 'no usable payment method',
};

interface EnrolmentStatus {
  tenantId: string;
  enrolled: boolean;
  chargesEnabled: boolean;
  blockers: string[];
  readyToEnrol: boolean;
  balance: number;
  pendingDryRunCloseout: { lots: number; credits: number };
  mandate: { status: string; valid: boolean; bankName: string | null; last4: string | null };
}

function flagCount(row: AgencyRow): number {
  return Object.values(row.flags).filter(Boolean).length;
}

export default function PlatformAgenciesPage(): JSX.Element {
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportMode, setExportMode] = useState<'ALL' | 'DRY_RUN' | 'CHARGED'>('ALL');

  /** Which agency's enrolment panel is open, and what the server says about it. */
  const [openAgency, setOpenAgency] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<EnrolmentStatus | null>(null);
  const [enrolmentBusy, setEnrolmentBusy] = useState(false);
  const [enrolmentNote, setEnrolmentNote] = useState<string | null>(null);

  /*
   * Test agencies, off by default -- the same toggle, and the same words, as
   * the live board. Without it a row marked as a test agency would vanish from
   * this table with no way to find it again and mark it back.
   */
  const [showTestAgencies, setShowTestAgencies] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);

  /** The agency whose owner is being invited. */
  const [invitingOwner, setInvitingOwner] = useState<AgencyRow | null>(null);
  /** The agency whose test/production marking is being confirmed. */
  const [marking, setMarking] = useState<AgencyRow | null>(null);
  const [markingNote, setMarkingNote] = useState('');
  const [markingBusy, setMarkingBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (day) params.set('day', day);
    if (showTestAgencies) params.set('includeNonProduction', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await apiClient.get<Envelope<{ calendarDay: string; agencies: AgencyRow[] }>>(
      `/api/v1/platform/delivery/overview${query}`
    );

    /*
     * Unwrapped by name. Read as a bare body this was `undefined`, so the table
     * rendered empty on every load and looked like a platform with no agencies
     * rather than a page that could not read its own response.
     */
    const overview = payload(response);
    setError(response.error ? response.error.message : null);
    setRows(Array.isArray(overview?.agencies) ? overview.agencies : []);
    if (!day && overview?.calendarDay) setDay(overview.calendarDay);
    setLoading(false);
  }, [day, showTestAgencies]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open one agency's management panel and read its enrolment state.
   *
   * The readiness check is a server read, always re-fetched: the blockers are
   * the same ones `POST .../enrol` will apply, and showing a cached "ready"
   * next to a button that then refuses is worse than a moment's wait.
   */
  async function openEnrolment(tenantId: string): Promise<void> {
    setOpenAgency(tenantId);
    setEnrolment(null);
    setEnrolmentNote(null);
    const response = await apiClient.get<Envelope<EnrolmentStatus>>(
      `/api/v1/platform/delivery/agencies/${tenantId}/enrolment`
    );
    setEnrolment(payload(response) ?? null);
    if (response.error) setEnrolmentNote(response.error.message);
  }

  /**
   * Enrol, un-enrol, suspend or resume one agency.
   *
   * Every one of these writes an AuditLog row on the server -- who did it, to
   * which agency, and when -- because each changes whether an agency's phones
   * ring or whether it is charged. Nothing about that is enforced here: the
   * routes are platform-gated and audited server-side, and this panel only
   * calls them.
   *
   * A refused enrolment names every missing precondition at once. The refusal
   * itself carries them, but `apiClient` narrows an error to its code and
   * message, so the list is read back from the enrolment status below -- the
   * same server check that produced the refusal, so the two cannot disagree.
   * "Not ready" is not something an operator can act on; "no agreed opening
   * rate" is.
   */
  async function act(
    tenantId: string,
    path: 'enrol' | 'unenrol' | 'suspend' | 'resume',
    body: Record<string, unknown> = {}
  ): Promise<void> {
    setEnrolmentBusy(true);
    setEnrolmentNote(null);
    try {
      const response = await apiClient.post(
        `/api/v1/platform/delivery/agencies/${tenantId}/${path}`,
        body
      );
      if (response.error) setEnrolmentNote(response.error.message);

      // Re-read both: the panel's own state, which carries the blockers, and
      // the row behind it.
      const refreshed = await apiClient.get<Envelope<EnrolmentStatus>>(
        `/api/v1/platform/delivery/agencies/${tenantId}/enrolment`
      );
      setEnrolment(payload(refreshed) ?? null);
      await load();
    } finally {
      setEnrolmentBusy(false);
    }
  }

  /**
   * Withdraw or restore an agency's Overrun ceiling.
   *
   * `null` puts it back on the schedule -- 50% below the clean-settlement
   * threshold, 100% at or beyond it. `0` withdraws overrun entirely, so the
   * agency delivers only what it has paid for.
   */
  async function setCeiling(tenantId: string, override: number | null): Promise<void> {
    setEnrolmentBusy(true);
    setEnrolmentNote(null);
    try {
      const response = await apiClient.put(
        `/api/v1/platform/delivery/agencies/${tenantId}/ceiling`,
        { ceilingPctOverride: override }
      );
      if (response.error) setEnrolmentNote(response.error.message);
      await load();
    } finally {
      setEnrolmentBusy(false);
    }
  }

  /**
   * Run the settlement for the day shown.
   *
   * Safe to press twice: one settlement exists per agency per Delivery Day,
   * enforced by a unique index, so a second run charges nobody. No amount is
   * sent — the body carries a day and nothing else.
   */
  async function runSettlement(): Promise<void> {
    setRunning(true);
    try {
      await apiClient.post('/api/v1/platform/delivery/settlement/run', { deliveryDay: day });
      await load();
    } finally {
      setRunning(false);
    }
  }

  /**
   * Download the settlement records for a date range.
   *
   * Read-only and charges nothing. `mode` splits the days that took money from
   * the days that did not, which is the split a hand-raised invoice for a dry
   * run needs. The range defaults to the single day this page is showing, so
   * pressing it without touching anything exports what is on screen.
   */
  async function exportSettlements(): Promise<void> {
    setExporting(true);
    try {
      const from = exportFrom || day;
      const to = exportTo || exportFrom || day;
      const query = new URLSearchParams({ from, to, mode: exportMode }).toString();
      const response = await apiClient.get<string>(
        `/api/v1/platform/delivery/settlements.csv?${query}`,
        { responseType: 'text' }
      );
      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing');
        return;
      }
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `settlements-${exportMode.toLowerCase()}-${from}-to-${to}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function openMarking(row: AgencyRow): void {
    setMarking(row);
    setMarkingNote('');
  }

  /**
   * Mark an agency as a test agency, or back as production.
   *
   * Deletes, suspends and un-enrols nothing: the server only changes what the
   * platform screens list and total. The same call reverses it, and it is
   * audited in both directions, note included.
   */
  async function confirmMarking(): Promise<void> {
    if (!marking) return;
    const next = !marking.isNonProduction;
    const note = markingNote.trim();
    setMarkingBusy(true);
    try {
      const response = await apiClient.put(
        `/api/v1/platform/tenants/${marking.tenantId}/non-production`,
        { isNonProduction: next, ...(note ? { note } : {}) }
      );
      if (response.error) {
        toast.error('Could not update agency', response.error.message);
        return;
      }
      toast.success(
        next ? 'Marked as test agency' : 'Marked as production',
        next
          ? `${marking.name} is now hidden unless "Show test agencies" is on.`
          : `${marking.name} is counted in platform figures again.`
      );
      setMarking(null);
      await load();
    } catch (err) {
      toast.error('Could not update agency', err instanceof Error ? err.message : undefined);
    } finally {
      setMarkingBusy(false);
    }
  }

  // Flagged first, then enrolled, then the rest. An unenrolled agency needs
  // nothing from this screen and should not sit above one that does.
  const sorted = [...rows].sort(
    (a, b) =>
      flagCount(b) - flagCount(a) ||
      Number(b.enrolled) - Number(a.enrolled) ||
      a.name.localeCompare(b.name)
  );
  // Test agencies are left out of the banner, as the server leaves them out of
  // its own flagged count: they are listed only so they can be found.
  const needingAction = sorted.filter(row => !row.isNonProduction && flagCount(row) > 0);

  if (loading) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12 text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading agencies
        </div>
      </div>
    );
  }

  const production = sorted.filter(row => !row.isNonProduction);
  const sum = (pick: (row: AgencyRow) => number | null): number | null => {
    const values = production.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  const openRow = openAgency ? (rows.find(row => row.tenantId === openAgency) ?? null) : null;

  return (
    <div className="page-canvas">
      <PageHeader
        description="Cross-agency delivery, revenue and settlement status"
        actions={
          <>
            <Input
              type="date"
              value={day}
              onChange={event => setDay(event.target.value)}
              className="h-8 w-40"
              aria-label="Delivery day"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTestAgencies(v => !v)}
              aria-pressed={showTestAgencies}
            >
              {showTestAgencies ? 'Hide test agencies' : 'Show test agencies'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-3 w-3" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-3 w-3" />
              Export
            </Button>
            <Button size="sm" onClick={() => void runSettlement()} disabled={running}>
              {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Run settlement
            </Button>
          </>
        }
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <StatTileRow className="lg:grid-cols-4">
        <StatTile label="Agencies" value={String(production.length)} sub={`On ${day}`} />
        <StatTile
          label="Needing action"
          value={String(needingAction.length)}
          sub={needingAction.length === 0 ? 'Nothing is flagged' : 'Flagged agencies sort first'}
        />
        <StatTile label="Revenue" value={money(sum(row => row.revenue))} sub="All agencies" />
        <StatTile
          label="Margin"
          value={money(sum(row => row.margin))}
          sub="Revenue less call cost"
        />
      </StatTileRow>

      {needingAction.length > 0 ? (
        <Notice
          tone="warning"
          title={`${needingAction.length} ${needingAction.length === 1 ? 'agency needs' : 'agencies need'} action`}
        >
          {needingAction.map(row => row.name).join(', ')}
        </Notice>
      ) : null}

      <Tabs defaultValue="agencies" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="agencies">Agencies</TabsTrigger>
          <TabsTrigger value="upgrades">Upgrade pricing and requests</TabsTrigger>
        </TabsList>

        <TabsContent value="agencies" className="mt-0">
          <Panel className="min-w-0 overflow-hidden">
            <PanelBody flush className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agency</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead>Settlement</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="w-[1%]">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map(row => (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => void openEnrolment(row.tenantId)}
                            className="font-medium text-brand-ink hover:underline"
                          >
                            {row.name}
                          </button>
                          {row.isNonProduction && (
                            <StatusChip value="TEST" label="Test" tone="neutral" size="sm" />
                          )}
                          {row.whiteLabel && (
                            <StatusChip
                              value="WHITE_LABEL"
                              label="White-label"
                              tone="money"
                              size="sm"
                            />
                          )}
                        </div>
                        {row.parentName ? (
                          <div className="mt-0.5 t-meta text-ink-3">{`Under ${row.parentName}`}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <BillingBadge row={row} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.deliveredCalls}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.applications}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(row.closingPct)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.revenue)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-medium tabular-nums',
                          row.margin !== null && row.margin < 0 && 'text-dropped-ink'
                        )}
                      >
                        {money(row.margin)}
                      </TableCell>
                      <TableCell>
                        <SettlementBadge row={row} />
                      </TableCell>
                      {/*
                        Each flag opens that agency's own controls, so a badge is
                        a place to act rather than only a place to look. Without
                        it an operator reads "no mandate" and then has to find the
                        row again in a table sorted by flag count.
                      */}
                      <TableCell>
                        <FlagBadges row={row} onOpen={() => void openEnrolment(row.tenantId)} />
                      </TableCell>
                      <TableCell className="text-right align-middle">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openEnrolment(row.tenantId)}
                          >
                            Manage
                          </Button>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                aria-label={`More actions for ${row.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setInvitingOwner(row)}>
                                Invite owner
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => openMarking(row)}>
                                {row.isNonProduction ? 'Mark as production' : 'Mark as test agency'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="upgrades" className="mt-0">
          <div className="grid grid-cols-1 gap-4">
            <UpgradePricesPanel />
            <UpgradeRequestsPanel />
          </div>
        </TabsContent>
      </Tabs>

      <SheetDrawer
        open={openRow !== null}
        onOpenChange={open => {
          if (!open) setOpenAgency(null);
        }}
        title={openRow?.name ?? 'Agency'}
        description={
          openRow
            ? [
                openRow.whiteLabel ? 'White-label' : null,
                openRow.parentName ? `Under ${openRow.parentName}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Billing, branding, upgrades and numbers'
            : undefined
        }
        size="xl"
      >
        {openRow ? (
          <>
            <SettingsSection title={`Figures for ${day}`}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {(
                  [
                    ['Delivered calls', String(openRow.deliveredCalls)],
                    ['Applications', String(openRow.applications)],
                    ['Closing', pct(openRow.closingPct)],
                    ['Rate', money(openRow.rate)],
                    ['Revenue', money(openRow.revenue)],
                    ['Call cost', money(openRow.callCost)],
                    ['Margin', money(openRow.margin)],
                    ['Revenue per call', money(openRow.revenuePerCall, 4)],
                    ['Cost per call', money(openRow.costPerCall, 4)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="t-meta text-ink-3">{label}</dt>
                    <dd className="t-body font-medium tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </SettingsSection>

            <SettingsSection
              title="Billing and delivery"
              description="Whether this agency is metered and settled, and whether its calls are delivering."
            >
              <EnrolmentPanel
                row={openRow}
                status={enrolment}
                busy={enrolmentBusy}
                note={enrolmentNote}
                onAct={act}
                onCeiling={setCeiling}
              />
            </SettingsSection>

            <SettingsSection
              title="Owner"
              description="The first person inside an agency can only be invited from here: nobody there can do it yet."
            >
              <SettingsToggleRow
                title="Owner invitation"
                description="Emails the owner a single-use link to create their sign-in."
              >
                <Button size="sm" onClick={() => setInvitingOwner(openRow)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Invite owner
                </Button>
              </SettingsToggleRow>
            </SettingsSection>

            <BrandThemeControl tenantId={openRow.tenantId} agencyName={openRow.name} />
            <UpgradesControl tenantId={openRow.tenantId} agencyName={openRow.name} />
            <NumbersAllowanceControl tenantId={openRow.tenantId} agencyName={openRow.name} />
          </>
        ) : null}
      </SheetDrawer>

      <InviteOwnerDialog
        open={invitingOwner !== null}
        onOpenChange={open => {
          if (!open) setInvitingOwner(null);
        }}
        scope="platform"
        agency={
          invitingOwner ? { tenantId: invitingOwner.tenantId, name: invitingOwner.name } : null
        }
      />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export settlement records</DialogTitle>
            <DialogDescription>
              Every figure from the settlement record: counts, closing percentage, rate, curve
              version, overrun, block and total. With no dates it exports the day shown on the page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="export-from">From</Label>
              <Input
                id="export-from"
                type="date"
                value={exportFrom}
                onChange={event => setExportFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-to">To</Label>
              <Input
                id="export-to"
                type="date"
                value={exportTo}
                onChange={event => setExportTo(event.target.value)}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="export-mode">Mode</Label>
              <select
                id="export-mode"
                value={exportMode}
                onChange={event =>
                  setExportMode(event.target.value as 'ALL' | 'DRY_RUN' | 'CHARGED')
                }
                className={selectClass}
              >
                <option value="ALL">All settlements</option>
                <option value="DRY_RUN">Dry run — nothing was charged</option>
                <option value="CHARGED">Charged</option>
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
              Close
            </Button>
            <Button onClick={() => void exportSettlements()} disabled={exporting}>
              {exporting ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-2 h-3 w-3" />
              )}
              Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={marking !== null}
        onOpenChange={open => {
          if (!open && !markingBusy) setMarking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {marking?.isNonProduction ? 'Mark as production' : 'Mark as test agency'}
            </DialogTitle>
            <DialogDescription>
              {marking?.isNonProduction
                ? `${marking?.name ?? ''} will be listed on the platform screens and counted in the platform totals again.`
                : `${marking?.name ?? ''} will be hidden from this page, the live board and the other platform screens unless "Show test agencies" is on, and left out of the platform totals.`}{' '}
              Nothing is deleted, and its delivery and billing are unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor="agency-marking-note" className="t-label text-ink-2">
              Note (optional)
            </label>
            <Textarea
              id="agency-marking-note"
              value={markingNote}
              onChange={event => setMarkingNote(event.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarking(null)} disabled={markingBusy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmMarking()} disabled={markingBusy}>
              {markingBusy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              {marking?.isNonProduction ? 'Mark as production' : 'Mark as test agency'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The billing state, as a badge: not enrolled, charging, or a dry run. */
function BillingBadge({ row }: { row: AgencyRow }): JSX.Element {
  if (!row.enrolled) {
    return (
      <Badge
        variant="outline"
        title="Not enrolled: not gated, not metered, not settled. Calls deliver as they always have."
      >
        not enrolled
      </Badge>
    );
  }
  return row.chargesEnabled ? (
    <Badge variant="secondary" title="Enrolled, and settlements charge">
      charging
    </Badge>
  ) : (
    <Badge
      variant="outline"
      title="Enrolled. Settlements compute and are recorded in full; no payment is taken."
    >
      dry run
    </Badge>
  );
}

/**
 * Where the day's settlement run got to.
 *
 * A halt is not a decline: the run worked and withheld the debit on purpose. It
 * still needs somebody, so it is not quiet -- but calling it "failed" sends an
 * operator to retry a card instead of to explain the day.
 */
function SettlementBadge({ row }: { row: AgencyRow }): JSX.Element {
  const { status, paymentStatus } = row.settlement;
  return (
    <Badge
      variant={
        status === 'SETTLED'
          ? 'secondary'
          : status === 'FAILED' || status === 'HALTED'
            ? 'destructive'
            : 'outline'
      }
      title={
        status === 'HALTED'
          ? 'The run completed and deliberately placed no debit. Explain the day rather than retrying the payment.'
          : undefined
      }
    >
      {status === 'NOT_ENROLLED'
        ? '—'
        : status === 'NOT_YET_RUN'
          ? 'not yet run'
          : (paymentStatus ?? status).replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

/** Every flag raised on an agency; each opens that agency's controls. */
function FlagBadges({ row, onOpen }: { row: AgencyRow; onOpen: () => void }): JSX.Element {
  const flags: Array<[boolean, string, string]> = [
    [
      row.flags.belowMinimumAndPaused,
      'below 5%',
      'Below the curve minimum. Only a platform admin can clear the review.',
    ],
    [
      row.flags.atCeiling,
      'at ceiling',
      'The Overrun ceiling has been reached for this Delivery Day, so delivery has stopped until tomorrow.',
    ],
    [row.flags.settlementFailedOrUnpaid, 'unpaid', 'A settlement is failed, halted or unpaid.'],
    [row.flags.noValidMandate, 'no mandate', 'No usable payment method, so nothing will deliver.'],
    [
      row.flags.suspended,
      'suspended',
      'Suspended by a platform admin. Paid applications survive a suspension.',
    ],
    [
      row.flags.enrolledNeverSettled,
      'never settled',
      'Enrolled, and no settlement has ever been written for this agency. The nightly run is not reaching it — every other column here reads a settlement that does not exist and shows an em dash that looks like a quiet day.',
    ],
  ];
  const raised = flags.filter(([on]) => on);
  if (raised.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {raised.map(([, label, title]) => (
        <FlagBadge key={label} label={label} title={title} onClick={onOpen} />
      ))}
    </div>
  );
}

/**
 * A flag that is also a way to act on it.
 *
 * The table sorts flagged agencies to the top, so an operator reads the badge
 * and then has to find that row again to do anything about it. Clicking the
 * badge opens the same controls the chevron does.
 */
function FlagBadge({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" onClick={onClick} title={title} className="cursor-pointer">
      <Badge variant="destructive">{label}</Badge>
    </button>
  );
}

/**
 * Enrolment, suspension and the Overrun ceiling for one agency.
 *
 * ── Why these live here ──────────────────────────────────────────────────────
 *
 * This is the screen an operator is already on when they notice an agency needs
 * something. Sending them elsewhere to act on it means the noticing and the
 * doing happen in different places, which is how an agency ends up flagged for
 * a week.
 *
 * ── Every one of these is audited, server-side ───────────────────────────────
 *
 * Enrol, un-enrol, suspend, resume and the ceiling override each write an
 * AuditLog row naming the operator, the agency and the change. That is enforced
 * by the routes, not by this panel: these buttons only call them, and the
 * platform capability is checked on the server for each.
 *
 * ── A refusal names what is missing ──────────────────────────────────────────
 *
 * Enrolment is refused unless the agency has recorded terms, a daily block, a
 * maximum daily debit, an agreed opening rate and a valid mandate. The server
 * returns every missing one at once and they are listed here. "Not ready" is
 * not something an operator can act on; "no agreed opening rate" is.
 *
 * ── Nothing here computes money ──────────────────────────────────────────────
 *
 * The balance and the dry-run closeout figures are read from the server. The
 * ceiling override sends a percentage the operator chose and reads the
 * resulting application count back; it does not work one out.
 */
function EnrolmentPanel({
  row,
  status,
  busy,
  note,
  onAct,
  onCeiling,
}: {
  row: AgencyRow;
  status: EnrolmentStatus | null;
  busy: boolean;
  note: string | null;
  onAct: (
    tenantId: string,
    path: 'enrol' | 'unenrol' | 'suspend' | 'resume',
    body?: Record<string, unknown>
  ) => Promise<void>;
  onCeiling: (tenantId: string, override: number | null) => Promise<void>;
}): JSX.Element {
  if (!status) {
    return (
      <p className="flex items-center t-meta text-ink-3">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Reading this agency&rsquo;s enrolment
      </p>
    );
  }

  const facts: Array<[string, string]> = [
    ['Balance', `${status.balance} paid applications`],
    [
      'Payment method',
      status.mandate.valid
        ? status.mandate.last4
          ? `${status.mandate.bankName ?? 'Bank'} ····${status.mandate.last4}`
          : 'Valid'
        : status.mandate.status.toLowerCase(),
    ],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="t-meta text-ink-3">{label}</dt>
            <dd className="t-body font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {note ? <Notice tone="warning" title={note} /> : null}

      {!status.enrolled && status.blockers.length > 0 ? (
        <Notice tone="info" title="Not ready to enrol">
          Still needed: {status.blockers.map(code => BLOCKER_TEXT[code] ?? code).join(', ')}.
        </Notice>
      ) : null}

      {status.enrolled && status.pendingDryRunCloseout.credits > 0 ? (
        <p className="t-meta text-ink-3">
          Turning charging on will retire {status.pendingDryRunCloseout.credits} credits from{' '}
          {status.pendingDryRunCloseout.lots}{' '}
          {status.pendingDryRunCloseout.lots === 1 ? 'dry-run block' : 'dry-run blocks'}, so the
          first charged settlement sells a full block. Charging is switched on from the go-live
          runbook, not from here.
        </p>
      ) : null}

      <div className="space-y-2">
        <SettingsToggleRow
          title="Billing"
          description={
            status.enrolled
              ? 'Enrolled: calls are gated, metered and settled.'
              : 'Not enrolled: calls deliver as they always have.'
          }
        >
          {status.enrolled ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void onAct(row.tenantId, 'unenrol', { reason: 'From the agency view' })
              }
            >
              Un-enrol
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !status.readyToEnrol}
              title={
                status.readyToEnrol
                  ? 'Enrolment takes effect on the next call offered.'
                  : 'Every precondition has to be in place first.'
              }
              onClick={() => void onAct(row.tenantId, 'enrol', { note: 'From the agency view' })}
            >
              Enrol
            </Button>
          )}
        </SettingsToggleRow>

        <SettingsToggleRow
          title="Delivery"
          description={
            row.flags.suspended
              ? 'Suspended: no calls are being sent to this agency.'
              : 'Active. Suspending stops delivery immediately; paid applications are untouched.'
          }
        >
          {row.flags.suspended ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void onAct(row.tenantId, 'resume')}
            >
              Resume delivery
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void onAct(row.tenantId, 'suspend', { reason: 'Suspended from the agency view' })
              }
            >
              Suspend delivery
            </Button>
          )}
        </SettingsToggleRow>

        <SettingsToggleRow
          title="Overrun ceiling"
          description="Withdraw it and the agency delivers only what it has paid for."
        >
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            title="Withdraw overrun entirely. The agency then delivers only what it has paid for."
            onClick={() => void onCeiling(row.tenantId, 0)}
          >
            Withdraw
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            title="Put the ceiling back on the standard schedule."
            onClick={() => void onCeiling(row.tenantId, null)}
          >
            Back to schedule
          </Button>
        </SettingsToggleRow>
      </div>

      {busy ? (
        <p className="flex items-center t-meta text-ink-3">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          Saving
        </p>
      ) : null}

      <p className="t-meta text-ink-3">
        Each of these is recorded in the audit log against your account. Un-enrolling stops gating,
        metering and settling immediately, and leaves the ledger and every settlement already
        written exactly as they are.
      </p>
    </div>
  );
}
