import { Suspense } from 'react';

import {
  MoneyCell,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
  StatusChip,
} from '@/components/domain';
import { StatementsPanel } from '@/components/statements/statements-panel';
import { settle } from '@/lib/server/api';
import { fetchBuyerProfile, fetchBuyerTransactions, fetchCostReport } from '@/lib/server/buyer';
import { requireBuyerScope } from '@/lib/server/session';

import { PageHeader } from '../_components/page-header';
import { PanelSkeleton, StatTileRowSkeleton, TableSkeleton } from '../_components/skeletons';
import { NoBuyerScope, PanelError } from '../_components/states';
import { newYorkMonthToDate, resolveRange } from '../_lib/range';
import { chargedSpend } from '../_lib/spend';

import { LedgerTable, type LedgerRow } from './ledger-table';
import { TopUpPlanner } from './top-up-planner';

/**
 * Billing — balance, burn rate, runway, top up.
 *
 * And, in plain sentences on the page itself, the rule that produces all four:
 * what triggers a charge, what does not, and what the threshold is. A buyer who
 * has to infer the billing rule from a ledger will infer it wrong, and the
 * first they hear about it is a dispute.
 */

export const dynamic = 'force-dynamic';

export default async function BuyerBillingPage() {
  const scope = await requireBuyerScope();
  const range = resolveRange({ range: '30d' });

  const header = (
    <PageHeader purpose="What you have, what you are spending it at, how long it lasts — and the rule that decides when you get charged." />
  );

  if (!scope.buyerId) {
    return (
      <>
        {header}
        <NoBuyerScope />
      </>
    );
  }

  const args = {
    token: scope.token,
    buyerId: scope.buyerId,
    startISO: range.startISO,
    endISO: range.endISO,
  };

  return (
    <>
      {header}

      <Suspense fallback={<StatTileRowSkeleton />}>
        <BalanceSummary {...args} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton title="How you are billed" lines={6} />}>
        <BillingRule token={scope.token} buyerId={scope.buyerId} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton title="Top up" lines={4} />}>
        <TopUpPanel {...args} />
      </Suspense>

      <Suspense fallback={<TableSkeleton title="Transactions" columns={4} rows={8} />}>
        <Ledger token={scope.token} buyerId={scope.buyerId} />
      </Suspense>

      <StatementsPanel
        partyType="BUYER"
        partyId={scope.buyerId}
        description="Every closed month's calls, charges and returns, and this month so far."
      />
    </>
  );
}

interface Args {
  token: string;
  buyerId: string;
  startISO: string;
  endISO: string;
}

/**
 * Balance, burn and runway are one calculation, so they load as one panel.
 *
 * A buyer on terms has no balance; its headline is what it has been billed
 * this calendar month (New York), from a second read of the report over that
 * window. Spend and burn count charged calls only -- see ../_lib/spend.
 */
async function BalanceSummary({ token, buyerId, startISO, endISO }: Args) {
  const month = newYorkMonthToDate();
  const [profileResult, reportResult, monthResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO })),
    settle(fetchCostReport(token, { buyerId, startDate: month.startISO, endDate: month.endISO })),
  ]);

  if (profileResult.error || !profileResult.data) {
    return <PanelError title="Balance" message={profileResult.error ?? 'No profile returned.'} />;
  }

  const profile = profileResult.data;
  const spend = reportResult.data ? chargedSpend(reportResult.data.totals) : 0;
  const burnPerDay = spend / 30;
  const upfront = profile.billingType === 'UPFRONT';
  const runway = upfront && burnPerDay > 0 ? Math.floor(profile.walletBalance / burnPerDay) : null;
  const billedThisMonth = monthResult.data ? chargedSpend(monthResult.data.totals) : null;

  return (
    <StatTileRow>
      <StatTile
        label={upfront ? 'Balance' : 'Billed this month'}
        figure={
          <MoneyCell
            amount={upfront ? profile.walletBalance : billedThisMonth}
            unit="major"
            size="figure"
            tone="auto"
          />
        }
        sub={upfront ? 'Prepaid funds on hand' : 'Charged since the 1st'}
        emphasis
        className="col-span-2 lg:col-span-1"
      />
      <StatTile
        label="Burn rate"
        figure={`$${burnPerDay.toFixed(2)}`}
        sub="Average per day over 30 days"
      />
      <StatTile
        label="Runway"
        figure={upfront ? (runway != null ? `${runway}d` : '—') : 'n/a'}
        sub={
          upfront
            ? runway != null
              ? 'At the current burn rate'
              : 'No spend in the window to project from'
            : 'You are invoiced, not prepaid'
        }
      />
      <StatTile label="Spent" figure={`$${spend.toFixed(2)}`} sub="Last 30 days" />
    </StatTileRow>
  );
}

/**
 * The billing rule, in sentences.
 *
 * Every number here is read from the account rather than written into the copy,
 * so the page cannot drift from the rule the platform actually applies.
 */
async function BillingRule({ token, buyerId }: { token: string; buyerId: string }) {
  const { data: profile, error } = await settle(fetchBuyerProfile(token, buyerId));

  if (error || !profile) {
    return <PanelError title="How you are billed" message={error ?? 'No profile returned.'} />;
  }

  const upfront = profile.billingType === 'UPFRONT';

  return (
    <Panel>
      <PanelHeader
        action={
          <StatusChip
            value={profile.billingType}
            tone="neutral"
            label={upfront ? 'Prepaid balance' : 'Invoiced on terms'}
            size="sm"
          />
        }
      >
        <PanelTitle>How you are billed</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-4">
        <section>
          <h3 className="t-label text-ink-3">The threshold</h3>
          <p className="t-body mt-1 max-w-2xl text-ink">
            A call becomes billable once it has been{' '}
            <strong className="font-medium">
              connected for {profile.billableDuration} seconds
            </strong>
            . Connected time is measured from the moment your target answers, not from when the
            phone starts ringing. A campaign can be set to its own threshold, and every call is
            judged against the threshold that was in force when it ran — the call detail panel shows
            you which one that was.
          </p>
        </section>

        <section>
          <h3 className="t-label text-ink-3">What triggers a charge</h3>
          <p className="t-body mt-1 max-w-2xl text-ink">
            Crossing that threshold, and nothing else. When a call passes it you are charged the
            agreed price for that campaign, once.{' '}
            {upfront
              ? 'The charge comes straight off your balance and appears in the ledger below as a debit against that call.'
              : 'The charge accrues against your account and appears on your next invoice.'}
          </p>
        </section>

        <section>
          <h3 className="t-label text-ink-3">What does not</h3>
          <ul className="t-body mt-1 max-w-2xl list-disc space-y-1 pl-5 text-ink">
            <li>A call that rings and is never answered.</li>
            <li>
              A call that connects but ends before {profile.billableDuration} seconds — however
              close it got.
            </li>
            <li>A call stopped by a compliance check before it ever reached your target.</li>
            <li>A call that has already been charged. The same call is never billed twice.</li>
          </ul>
        </section>

        <section>
          <h3 className="t-label text-ink-3">
            {upfront ? 'When the balance runs out' : 'When you are invoiced'}
          </h3>
          <p className="t-body mt-1 max-w-2xl text-ink">
            {upfront
              ? 'If a charge would take your balance below zero, the platform pauses your account rather than letting it go negative. Calls stop being routed to you until the balance is topped up. Watch the runway figure above — that is the number that tells you it is coming.'
              : 'Charges accrue through the billing period and are invoiced at the end of it. The billed-this-month figure above is what you have been charged since the 1st.'}
          </p>
        </section>

        <section>
          <h3 className="t-label text-ink-3">Disputes</h3>
          <p className="t-body mt-1 max-w-2xl text-ink">
            Filing a dispute does not reverse the charge on its own. It marks the call, holds the
            publisher&apos;s payout while it is reviewed, and the outcome decides whether the charge
            stands. You can see every dispute you have filed, and where it got to, on the disputes
            page.
          </p>
        </section>
      </PanelBody>
    </Panel>
  );
}

async function TopUpPanel({ token, buyerId, startISO, endISO }: Args) {
  const [profileResult, reportResult] = await Promise.all([
    settle(fetchBuyerProfile(token, buyerId)),
    settle(fetchCostReport(token, { buyerId, startDate: startISO, endDate: endISO })),
  ]);

  if (profileResult.error || !profileResult.data) {
    return <PanelError title="Top up" message={profileResult.error ?? 'No profile returned.'} />;
  }

  const profile = profileResult.data;
  if (profile.billingType !== 'UPFRONT') return null;

  const burnPerDay = (reportResult.data ? chargedSpend(reportResult.data.totals) : 0) / 30;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Top up</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <TopUpPlanner buyerId={buyerId} balance={profile.walletBalance} burnPerDay={burnPerDay} />
      </PanelBody>
    </Panel>
  );
}

async function Ledger({ token, buyerId }: { token: string; buyerId: string }) {
  const { data, error } = await settle(fetchBuyerTransactions(token, buyerId, 25));

  if (error || !data) {
    return <PanelError title="Transactions" message={error ?? 'No transactions returned.'} />;
  }

  const rows: LedgerRow[] = data.map(tx => ({
    id: tx.id,
    createdAt: tx.createdAt,
    type: tx.type,
    description: tx.description,
    amount: tx.amount,
  }));

  return (
    <Panel>
      <PanelHeader action={<span className="t-meta text-ink-3">Most recent 25</span>}>
        <PanelTitle>Transactions</PanelTitle>
      </PanelHeader>
      <PanelBody flush>
        <LedgerTable rows={rows} />
      </PanelBody>
    </Panel>
  );
}
