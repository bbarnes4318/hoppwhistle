'use client';

import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** What is standing between an agency and being enrolled. */
const BLOCKER_TEXT: Record<string, string> = {
  NO_BILLING_PROFILE: 'no recorded terms',
  NO_DAILY_BLOCK: 'no daily block',
  NO_MAX_DAILY_DEBIT: 'no maximum daily debit',
  NO_OPENING_RATE: 'no agreed opening rate',
  NO_VALID_MANDATE: 'no valid ACH mandate',
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

  const load = useCallback(async () => {
    const query = day ? `?day=${encodeURIComponent(day)}` : '';
    const response = await apiClient.get<
      Envelope<{ calendarDay: string; agencies: AgencyRow[] }>
    >(`/api/v1/platform/delivery/overview${query}`);

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
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open one agency's enrolment panel.
   *
   * The readiness check is a server read, always re-fetched: the blockers are
   * the same ones `POST .../enrol` will apply, and showing a cached "ready"
   * next to a button that then refuses is worse than a moment's wait.
   */
  async function openEnrolment(tenantId: string): Promise<void> {
    if (openAgency === tenantId) {
      setOpenAgency(null);
      return;
    }
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

  // Flagged first, then enrolled, then the rest. An unenrolled agency needs
  // nothing from this screen and should not sit above one that does.
  const sorted = [...rows].sort(
    (a, b) =>
      flagCount(b) - flagCount(a) ||
      Number(b.enrolled) - Number(a.enrolled) ||
      a.name.localeCompare(b.name)
  );
  const needingAction = sorted.filter(row => flagCount(row) > 0);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading agencies
        </div>
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Agencies"
        subtitle="Cross-agency delivery, revenue and settlement status"
        icon={Building2}
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={day}
            onChange={event => setDay(event.target.value)}
            className="h-8 w-40"
          />
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void runSettlement()} disabled={running}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Run settlement
          </Button>
        </div>
      </CompactPageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Export settlement records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">
              From
              <Input
                type="date"
                value={exportFrom}
                onChange={event => setExportFrom(event.target.value)}
                className="mt-1 h-8 w-40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <Input
                type="date"
                value={exportTo}
                onChange={event => setExportTo(event.target.value)}
                className="mt-1 h-8 w-40"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Mode
              <select
                value={exportMode}
                onChange={event =>
                  setExportMode(event.target.value as 'ALL' | 'DRY_RUN' | 'CHARGED')
                }
                className="mt-1 block h-8 rounded border bg-background px-2 text-sm"
              >
                <option value="ALL">All settlements</option>
                <option value="DRY_RUN">Dry run — nothing was charged</option>
                <option value="CHARGED">Charged</option>
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportSettlements()}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-2 h-3 w-3" />
              )}
              Download CSV
            </Button>
            <p className="text-xs text-muted-foreground">
              Every figure from the settlement record — counts, closing percentage, rate, curve
              version, overrun, block and total. Defaults to the day shown above.
            </p>
          </div>
        </CardContent>
      </Card>

      {needingAction.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-ringing bg-ringing-tint p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ringing-ink" />
          <div>
            <p className="font-medium">
              {needingAction.length} agenc{needingAction.length === 1 ? 'y needs' : 'ies need'}{' '}
              action
            </p>
            <p className="text-muted-foreground">
              {needingAction.map(row => row.name).join(', ')}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per agency — {day}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Agency</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Call cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Rev / call</TableHead>
                  <TableHead className="text-right">Cost / call</TableHead>
                  <TableHead>Settlement</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(row => (
                  <Fragment key={row.tenantId}>
                  <TableRow>
                    <TableCell className="align-middle">
                      <button
                        type="button"
                        aria-expanded={openAgency === row.tenantId}
                        aria-label={`Enrolment controls for ${row.name}`}
                        className="text-muted-foreground"
                        onClick={() => void openEnrolment(row.tenantId)}
                      >
                        {openAgency === row.tenantId ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {!row.enrolled ? (
                        <Badge
                          variant="outline"
                          title="Not enrolled: not gated, not metered, not settled. Calls deliver as they always have."
                        >
                          not enrolled
                        </Badge>
                      ) : row.chargesEnabled ? (
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
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.deliveredCalls}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.applications}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(row.closingPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.callCost)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        row.margin !== null && row.margin < 0 && 'text-destructive'
                      )}
                    >
                      {money(row.margin)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(row.revenuePerCall, 4)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(row.costPerCall, 4)}
                    </TableCell>
                    <TableCell>
                      {/*
                        A halt is not a decline: the run worked and withheld the
                        debit on purpose. It still needs somebody, so it is not
                        quiet -- but calling it "failed" sends an operator to
                        retry a card instead of to explain the day.
                      */}
                      <Badge
                        variant={
                          row.settlement.status === 'SETTLED'
                            ? 'secondary'
                            : row.settlement.status === 'FAILED' ||
                                row.settlement.status === 'HALTED'
                              ? 'destructive'
                              : 'outline'
                        }
                        title={
                          row.settlement.status === 'HALTED'
                            ? 'The run completed and deliberately placed no debit. Explain the day rather than retrying the payment.'
                            : undefined
                        }
                      >
                        {row.settlement.status === 'NOT_ENROLLED'
                          ? '—'
                          : row.settlement.status === 'NOT_YET_RUN'
                            ? 'not yet run'
                            : (row.settlement.paymentStatus ?? row.settlement.status)
                                .replace(/_/g, ' ')
                                .toLowerCase()}
                      </Badge>
                    </TableCell>
                    {/*
                      Each flag opens that agency's own controls, so a badge is
                      a place to act rather than only a place to look. Without
                      it an operator reads "no mandate" and then has to find the
                      row again in a table sorted by flag count.
                    */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.flags.belowMinimumAndPaused && (
                          <FlagBadge
                            label="below 5%"
                            title="Below the curve minimum. Only a platform admin can clear the review."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                        {row.flags.atCeiling && (
                          <FlagBadge
                            label="at ceiling"
                            title="The Overrun ceiling has been reached for this Delivery Day, so delivery has stopped until tomorrow."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                        {row.flags.settlementFailedOrUnpaid && (
                          <FlagBadge
                            label="unpaid"
                            title="A settlement is failed, halted or unpaid."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                        {row.flags.noValidMandate && (
                          <FlagBadge
                            label="no mandate"
                            title="No valid ACH mandate, so nothing will deliver."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                        {row.flags.suspended && (
                          <FlagBadge
                            label="suspended"
                            title="Suspended by a platform admin. Paid applications survive a suspension."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                        {row.flags.enrolledNeverSettled && (
                          <FlagBadge
                            label="never settled"
                            title="Enrolled, and no settlement has ever been written for this agency. The nightly run is not reaching it — every other column here reads a settlement that does not exist and shows an em dash that looks like a quiet day."
                            onClick={() => void openEnrolment(row.tenantId)}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {openAgency === row.tenantId && (
                    <TableRow className="bg-sunken hover:bg-sunken">
                      <TableCell colSpan={14} className="p-4">
                        <EnrolmentPanel
                          row={row}
                          status={enrolment}
                          busy={enrolmentBusy}
                          note={enrolmentNote}
                          onAct={act}
                          onCeiling={setCeiling}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </CompactPageShell>
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
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Reading this agency&rsquo;s enrolment
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="font-medium">{row.name}</span>
        <span className="text-muted-foreground">
          {status.enrolled ? 'Enrolled in billing' : 'Not enrolled in billing'}
          {status.enrolled && (status.chargesEnabled ? ' · charging' : ' · not charging')}
        </span>
        <span className="text-muted-foreground">
          Balance <span className="tabular-nums">{status.balance}</span> paid applications
        </span>
        <span className="text-muted-foreground">
          Mandate {status.mandate.valid ? 'valid' : status.mandate.status.toLowerCase()}
          {status.mandate.last4 ? ` · ${status.mandate.bankName ?? 'bank'} ····${status.mandate.last4}` : ''}
        </span>
      </div>

      {note && (
        <p className="rounded border border-ringing bg-ringing-tint p-2 text-[13px]">{note}</p>
      )}

      {!status.enrolled && status.blockers.length > 0 && (
        <p className="text-muted-foreground">
          Not ready to enrol. Still needed:{' '}
          <span className="font-medium">
            {status.blockers.map(code => BLOCKER_TEXT[code] ?? code).join(', ')}
          </span>
          .
        </p>
      )}

      {status.enrolled && status.pendingDryRunCloseout.credits > 0 && (
        <p className="text-muted-foreground">
          Turning charging on will retire {status.pendingDryRunCloseout.credits} credits from{' '}
          {status.pendingDryRunCloseout.lots}{' '}
          {status.pendingDryRunCloseout.lots === 1 ? 'dry-run block' : 'dry-run blocks'}, so the
          first charged settlement sells a full block. Charging is switched on from the go-live
          runbook, not from here.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status.enrolled ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onAct(row.tenantId, 'unenrol', { reason: 'From the agency view' })}
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
            title="Stops delivery immediately. Paid applications are untouched and are there when you resume."
            onClick={() =>
              void onAct(row.tenantId, 'suspend', { reason: 'Suspended from the agency view' })
            }
          >
            Suspend delivery
          </Button>
        )}

        <span className="ml-2 text-xs text-muted-foreground">Overrun ceiling:</span>
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

        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each of these is recorded in the audit log against your account. Un-enrolling stops
        gating, metering and settling immediately, and leaves the ledger and every settlement
        already written exactly as they are.
      </p>
    </div>
  );
}
