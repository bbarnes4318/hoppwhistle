'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { count, dollars } from '@/components/delivery/ledger';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Buying app credits, and whether the nightly settlement refills them.
 *
 * Every figure here is the server's (`GET /api/v1/delivery/credits`): the rate,
 * the payment method, the most that can be bought. The purchase sends a
 * quantity and an idempotency key and nothing else -- the server prices it.
 */

export interface CreditsState {
  balance: number;
  currentRate: number | null;
  autoRefill: boolean;
  dailyBlockApplications: number;
  paymentMethod: {
    type: 'ACH' | 'CARD';
    last4: string | null;
    bankName: string | null;
    brand?: string | null;
  } | null;
  canSelfServe: boolean;
  selfServeBlockedReason: string | null;
  maxPurchaseQuantity: number;
}

export async function fetchCredits(): Promise<CreditsState | null> {
  const response = await apiClient.get<Envelope<CreditsState>>('/api/v1/delivery/credits');
  return payload(response) ?? null;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function methodLabel(method: CreditsState['paymentMethod']): string {
  if (!method) return '—';
  const tail = method.last4 ? ` ••${method.last4}` : '';
  if (method.type === 'CARD') {
    const brand = method.brand ? method.brand[0].toUpperCase() + method.brand.slice(1) : 'Card';
    return `${brand}${tail}`;
  }
  return `ACH${tail}${method.bankName ? ` · ${method.bankName}` : ''}`;
}

export function BuyCreditsDialog({
  open,
  onOpenChange,
  credits,
  onPurchased,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credits: CreditsState | null;
  onPurchased: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per purchase attempt: a retry of the same attempt (a double click,
  // a flaky connection) is the same purchase to the server.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const block = credits?.dailyBlockApplications ?? 0;
  const max = credits?.maxPurchaseQuantity ?? 0;

  useEffect(() => {
    if (open) {
      setError(null);
      if (!quantity) setQuantity(String(Math.min(block > 0 ? block : 10, Math.max(max, 1))));
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const picks = Array.from(new Set([10, 25, 50, block].filter(n => n > 0))).sort((a, b) => a - b);

  const parsed = Number(quantity);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= max;
  const rate = credits?.currentRate ?? null;
  const total = valid && rate !== null ? Number((parsed * rate).toFixed(2)) : null;
  const blocked = !credits || !credits.canSelfServe;

  async function confirm(): Promise<void> {
    if (!valid || blocked) return;
    setSubmitting(true);
    setError(null);
    const response = await apiClient.post<
      Envelope<{ purchase: { quantity: number; amount: number }; balance: number }>
    >('/api/v1/delivery/credits/purchase', { quantity: parsed, idempotencyKey });
    setSubmitting(false);

    const result = payload(response);
    if (response.error || !result) {
      setError(response.error?.message ?? 'The purchase could not be completed.');
      return;
    }

    setIdempotencyKey(newKey());
    setQuantity('');
    onOpenChange(false);
    toast({
      title: `${count(result.purchase.quantity)} credits added`,
      description: `${dollars(result.purchase.amount)} charged · balance ${count(result.balance)}`,
    });
    onPurchased();
  }

  return (
    <Dialog open={open} onOpenChange={next => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Buy app credits</DialogTitle>
          <DialogDescription>
            Charged to the payment method on file at your current rate.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <p className="t-body text-ink-2" data-testid="buy-credits-blocked">
            {credits?.selfServeBlockedReason ?? 'Credits cannot be bought right now.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {picks.map(n => (
                <Button
                  key={n}
                  type="button"
                  variant={parsed === n ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={n > max}
                  onClick={() => setQuantity(String(n))}
                >
                  {n === block ? `${count(n)} (daily block)` : count(n)}
                </Button>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="t-meta text-ink-3">Credits (up to {count(max)})</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                step={1}
                value={quantity}
                onChange={event => setQuantity(event.target.value)}
                aria-label="Credits to buy"
                className="h-8"
              />
            </label>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 t-body">
              <dt className="text-ink-3">Rate</dt>
              <dd className="num text-right">{dollars(rate)} / app</dd>
              <dt className="text-ink-3">Total</dt>
              <dd className="num text-right font-medium" data-testid="buy-credits-total">
                {total === null ? '—' : dollars(total)}
              </dd>
              <dt className="text-ink-3">Pay with</dt>
              <dd className="text-right">{methodLabel(credits?.paymentMethod ?? null)}</dd>
            </dl>
            {!valid && quantity !== '' && (
              <p className="t-meta text-dropped-ink">
                Enter a whole number from 1 to {count(max)}.
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="t-body text-dropped-ink">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={blocked || !valid || submitting}
            onClick={() => void confirm()}
          >
            {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {total === null ? 'Buy credits' : `Pay ${dollars(total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Auto-refill nightly to N credits". Compact: a switch and one line.
 */
export function AutoRefillToggle({
  credits,
  onChanged,
  className,
}: {
  credits: CreditsState | null;
  onChanged: (autoRefill: boolean) => void;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  if (!credits) return null;

  async function toggle(enabled: boolean): Promise<void> {
    setSaving(true);
    const response = await apiClient.put<Envelope<{ autoRefill: boolean }>>(
      '/api/v1/delivery/credits/auto-refill',
      { enabled }
    );
    setSaving(false);
    const result = payload(response);
    if (response.error || !result) {
      toast({
        title: 'Auto-refill was not changed',
        description: response.error?.message ?? 'Try again.',
        variant: 'destructive',
      });
      return;
    }
    onChanged(result.autoRefill);
  }

  return (
    <label
      className={cn('flex items-center gap-2 t-meta text-ink-2', className)}
      data-testid="auto-refill"
    >
      <Switch
        checked={credits.autoRefill}
        disabled={saving}
        onCheckedChange={checked => void toggle(checked)}
        aria-label="Auto-refill nightly"
        className="origin-left scale-75"
      />
      <span>
        Auto-refill nightly to {count(credits.dailyBlockApplications)} credits
        {!credits.autoRefill && ' · off'}
      </span>
    </label>
  );
}
