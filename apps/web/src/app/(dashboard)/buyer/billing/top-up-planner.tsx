'use client';

import * as React from 'react';

import { MoneyCell } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readSessionToken } from '@/lib/session-token';
import { cn, formatCurrency } from '@/lib/utils';

import { MISSING_TOKEN_MESSAGE } from '../_lib/token';
import { requestTopUp } from '../actions';

/**
 * Top up.
 *
 * There is no self-serve payment endpoint on this platform — credits are
 * applied by the account team — so this does not pretend to be a checkout. What
 * it does is the part the buyer actually needs help with: turning "how long
 * will this last" into an amount, at their real burn rate, and then asking for
 * it. The request goes to the agency's owners by email, with the buyer's name
 * and the amount; it used to be a sentence to copy and paste somewhere, which
 * left the buyer to work out where.
 */

const PRESETS = [250, 500, 1000, 2500];

type RequestState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; amount: number }
  | { kind: 'failed'; message: string };

export function TopUpPlanner({
  buyerId,
  balance,
  burnPerDay,
}: {
  buyerId: string;
  balance: number;
  burnPerDay: number;
}) {
  const [amount, setAmount] = React.useState<number>(PRESETS[1]);
  const [request, setRequest] = React.useState<RequestState>({ kind: 'idle' });

  const valid = Number.isFinite(amount) && amount > 0;
  const projected = balance + (Number.isFinite(amount) ? amount : 0);
  const runwayNow = burnPerDay > 0 ? Math.floor(balance / burnPerDay) : null;
  const runwayAfter = burnPerDay > 0 ? Math.floor(projected / burnPerDay) : null;

  // Changing the amount after a request makes a new one, so the confirmation
  // for the old amount does not stay on screen beside a different figure.
  function pick(next: number) {
    setAmount(next);
    if (request.kind !== 'sending') setRequest({ kind: 'idle' });
  }

  function send() {
    // The token is read here and handed to the action, which authenticates
    // from what it is passed, never from the cookie. See ../_lib/token.
    const token = readSessionToken();
    if (!token) {
      setRequest({ kind: 'failed', message: MISSING_TOKEN_MESSAGE });
      return;
    }
    const asked = amount;
    setRequest({ kind: 'sending' });
    void (async () => {
      const result = await requestTopUp(token, buyerId, asked);
      setRequest(
        result.ok
          ? { kind: 'sent', amount: asked }
          : { kind: 'failed', message: result.error ?? 'Could not send this request.' }
      );
    })();
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
              onClick={() => pick(preset)}
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
            onChange={e => pick(Number(e.target.value))}
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
          Top-ups are applied by your account team — there is no card on file to charge. Send them a
          request for {valid ? formatCurrency(amount) : 'this amount'} and they will credit your
          balance.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-control border-rule"
            disabled={!valid || request.kind === 'sending' || request.kind === 'sent'}
            onClick={send}
          >
            {request.kind === 'sending'
              ? 'Sending…'
              : request.kind === 'sent'
                ? 'Request sent'
                : 'Request a top-up'}
          </Button>
          <p className="t-meta text-ink-3" role="status" aria-live="polite">
            {request.kind === 'sent'
              ? `Your account team has been asked for ${formatCurrency(request.amount)}.`
              : request.kind === 'failed'
                ? request.message
                : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
