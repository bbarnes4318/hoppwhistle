'use client';

import * as React from 'react';

import { MoneyCell } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Top up.
 *
 * There is no self-serve payment endpoint on this platform — credits are
 * applied by the account team — so this does not pretend to be a checkout. What
 * it does is the part the buyer actually needs help with: turning "how long
 * will this last" into an amount, at their real burn rate, before they ask for
 * it.
 */

const PRESETS = [250, 500, 1000, 2500];

export function TopUpPlanner({ balance, burnPerDay }: { balance: number; burnPerDay: number }) {
  const [amount, setAmount] = React.useState<number>(PRESETS[1]);
  const [copied, setCopied] = React.useState(false);

  const projected = balance + (Number.isFinite(amount) ? amount : 0);
  const runwayNow = burnPerDay > 0 ? Math.floor(balance / burnPerDay) : null;
  const runwayAfter = burnPerDay > 0 ? Math.floor(projected / burnPerDay) : null;

  const request = `Please add $${(Number.isFinite(amount) ? amount : 0).toFixed(2)} to our balance. Current balance $${balance.toFixed(2)}, burning about $${burnPerDay.toFixed(2)} a day.`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="t-label text-ink-3">Amount</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PRESETS.map(preset => (
            <Button
              key={preset}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAmount(preset)}
              className={cn(
                'rounded-control border-rule',
                amount === preset && 'border-money bg-money-tint text-money-ink'
              )}
            >
              ${preset.toLocaleString()}
            </Button>
          ))}
          <Input
            type="number"
            min={0}
            step={50}
            aria-label="Custom top-up amount"
            value={Number.isFinite(amount) ? amount : ''}
            onChange={e => setAmount(Number(e.target.value))}
            className="h-8 w-28 rounded-control border-rule bg-surface t-data text-ink"
          />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <dt className="t-label text-ink-3">Balance after</dt>
          <dd className="t-figure mt-1.5 text-ink">
            <MoneyCell amount={projected} unit="major" size="figure" tone="money" />
          </dd>
        </div>
        <div>
          <dt className="t-label text-ink-3">Runway now</dt>
          <dd className="t-figure mt-1.5 text-ink">{runwayNow != null ? `${runwayNow}d` : '—'}</dd>
        </div>
        <div>
          <dt className="t-label text-ink-3">Runway after</dt>
          <dd className="t-figure mt-1.5 text-ink">
            {runwayAfter != null ? `${runwayAfter}d` : '—'}
          </dd>
        </div>
      </dl>

      <div className="rounded-control border border-rule bg-sunken p-3">
        <p className="t-meta text-ink-2">
          Top-ups are applied by your account team — there is no card on file to charge. Send them
          this and they will credit the balance:
        </p>
        <p className="t-body mt-2 text-ink">{request}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2.5 rounded-control border-rule"
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy request'}
        </Button>
      </div>
    </div>
  );
}
