'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { dollars } from '@/components/delivery/ledger';
import { StatementsPanel } from '@/components/statements/statements-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import {
  payoutSummaryPath,
  type PublisherDeduction,
  type PublisherPayments,
  type PublisherPayoutSummary,
} from '@/lib/publisher-portal';

/**
 * Payouts: what the agency has paid this publisher, and what it owes.
 *
 * ── The owner's numbers ──────────────────────────────────────────────────────
 *
 * The cards are this publisher's row of the agency's own Payouts screen for the
 * chosen period (`/payouts/summary`), and the history is the payments the
 * agency recorded there (`/payouts`). The page used to read a payouts table
 * nothing writes, so the history was always empty, and labelled its cards
 * "All-time" over figures that were not. Nothing here adds anything up.
 */

function dateOnly(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** A deduction as it reads on a statement: "−$5.00", never "$-5.00". */
function deducted(amount: number): string {
  return `−${dollars(Math.abs(amount))}`;
}

function DeductionLabel({ deduction }: { deduction: PublisherDeduction }) {
  return (
    <>
      Returned call
      {deduction.callDate ? ` from ${dateOnly(deduction.callDate)}` : ' (call since removed)'}
    </>
  );
}

function PublisherPayoutsPage() {
  const { publisherId } = useAuth();
  const period = usePeriod('THIS_MONTH');
  const { sendable, query } = period;

  const [summary, setSummary] = useState<PublisherPayoutSummary | null>(null);
  const [history, setHistory] = useState<PublisherPayments | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!publisherId || !sendable) return;
    setLoading(true);
    try {
      const [summaryRes, historyRes] = await Promise.all([
        apiClient.get<Envelope<PublisherPayoutSummary>>(payoutSummaryPath(publisherId, query)),
        apiClient.get<Envelope<PublisherPayments>>(`/api/v1/publishers/${publisherId}/payouts`),
      ]);
      if (summaryRes.error || historyRes.error) {
        toast.error(
          'Failed to load payout details',
          summaryRes.error?.message ?? historyRes.error?.message
        );
      }
      setSummary(payload(summaryRes) ?? null);
      setHistory(payload(historyRes) ?? null);
    } catch (err) {
      console.error('Failed to load publisher payouts data:', err);
      toast.error('Failed to load payout details');
    } finally {
      setLoading(false);
    }
  }, [publisherId, sendable, query]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const label = summary?.period.label ?? 'This month';
  const payments = history?.payments ?? [];
  const waiting = history?.waiting ?? [];
  const figure = (value: number | undefined) =>
    loading || value === undefined ? '...' : dollars(value);

  return (
    <div className="page-canvas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <p className="mt-1 text-sm text-ink-2">
            What you are owed for the period, and every payment your agency has recorded.
          </p>
        </div>
        <Button onClick={() => void loadData()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <PeriodToolbar state={period} resolved={summary?.period ?? null} label="Payouts period" />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="t-caption text-ink-2">
              Payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-ink">{figure(summary?.payable)}</div>
            <p className="text-xs text-ink-3 mt-1">
              {label}
              {summary ? ` · ${summary.payableCalls.toLocaleString()} calls not yet paid` : ''}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="t-caption text-ink-2">
              Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-live-ink">
              {figure(summary?.paid)}
            </div>
            <p className="text-xs text-ink-3 mt-1">{label} · calls already paid for</p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="t-caption text-ink-2">
              Held or disputed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-dropped-ink">
              {figure(summary?.held)}
            </div>
            <p className="text-xs text-ink-3 mt-1">{label} · on hold or under dispute</p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="t-caption text-ink-2">
              Net payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-ringing-ink">
              {figure(summary?.netPayable)}
            </div>
            <p className="text-xs text-ink-3 mt-1">
              Payable less {summary ? dollars(summary.returnsPending) : '...'} in returns waiting
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payment History */}
      <Card className="bg-surface border-rule">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            Every payment your agency has recorded to you, with any returned calls deducted from it.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-rule bg-sunken">
                  <th className="p-4 text-left t-caption text-ink-2">
                    Date
                  </th>
                  <th className="p-4 text-left t-caption text-ink-2">
                    Method
                  </th>
                  <th className="p-4 text-left t-caption text-ink-2">
                    Reference
                  </th>
                  <th className="p-4 text-right t-caption text-ink-2">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {loading && !history ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-sm text-ink-2">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-brand-ink" />
                        <span>Loading payments...</span>
                      </div>
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-sm text-ink-2">
                      No payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  payments.map(payment => (
                    <Fragment key={payment.id}>
                      <tr className="hover:bg-sunken transition-colors duration-150">
                        <td className="p-4 font-mono text-xs text-ink-2">
                          {dateOnly(payment.paidAt)}
                        </td>
                        <td className="p-4 text-xs text-ink-2">{payment.method}</td>
                        <td className="p-4 font-mono text-xs text-ink-2">
                          {payment.reference || '—'}
                        </td>
                        <td className="p-4 text-right font-mono text-xs text-ink font-semibold">
                          {dollars(payment.amount)}
                        </td>
                      </tr>
                      {payment.deductions.map(deduction => (
                        <tr key={deduction.id} className="bg-sunken/50">
                          <td
                            colSpan={3}
                            className="py-2 pl-10 pr-4 text-xs text-ink-3"
                            aria-label="Deducted from this payment"
                          >
                            <DeductionLabel deduction={deduction} />
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-xs text-dropped-ink">
                            {deducted(deduction.amount)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Returns not yet deducted */}
      {waiting.length > 0 ? (
        <Card className="bg-surface border-rule">
          <CardHeader>
            <CardTitle>Waiting for next payment</CardTitle>
            <CardDescription>
              Returned calls accepted after you were paid for them. They come off your next payment.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full">
              <tbody className="divide-y divide-rule">
                {waiting.map(deduction => (
                  <tr key={deduction.id}>
                    <td className="p-4 text-xs text-ink-2">
                      <DeductionLabel deduction={deduction} />
                    </td>
                    <td className="p-4 text-right font-mono text-xs text-dropped-ink">
                      {deducted(deduction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {publisherId ? <StatementsPanel partyType="PUBLISHER" partyId={publisherId} /> : null}
    </div>
  );
}

export default function GuardedPublisherPayoutsPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherPayoutsPage />
    </RoleGuard>
  );
}
