'use client';

import { CheckCircle, Loader2, Phone, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Notice } from '@/components/domain';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api';
import { cn, formatPhoneNumber } from '@/lib/utils';

/**
 * Buying phone numbers: one dialog, local or toll-free.
 *
 * ── Who buys, and from whom ──────────────────────────────────────────────────
 *
 * Any agency's OWNER or ADMIN buys its own numbers, within the limit and at
 * the price its platform (or, for a downline, its parent) has set. WHICH
 * carrier a number comes from is the platform's decision, made by a NetEnroll
 * platform admin on Settings -> Number carriers -- never the agency's. So the
 * tabs name what a number IS, and the search behind them is carrier-neutral:
 *
 *   search   GET  /api/v1/numbers/available?type=local|tollfree&areaCode=
 *                 every carrier the platform has enabled, its default first;
 *                 each result names the carrier it is for sale at
 *   buy      POST /api/v1/numbers/buy { provider, number }
 *                 refused if the platform has since switched that carrier off
 *
 * The Toll-free tab is offered only while an enabled carrier sells toll-free
 * (`tollFreeAvailable` on the pricing answer). NetEnroll staff see the carrier
 * beside each result, because they are the ones who answer when one of them
 * misbehaves; an agency owner never does.
 *
 * ── The price is shown before anybody confirms ───────────────────────────────
 *
 * `/api/v1/numbers/pricing` answers the setup fee, the monthly fee and what
 * the rest of this month costs, and how many of the agency's numbers are used.
 * The confirm step shows all of it. When the quota is spent the API answers
 * 403 QUOTA_EXCEEDED with a sentence that says so, and that sentence is shown.
 */

export type InventoryKind = 'local' | 'tollfree';

interface AvailableNumber {
  /** Unique across carriers. */
  id: string;
  /** What the carrier calls the number; sent back to it to buy it. */
  carrierId: string;
  number: string;
  /** The carrier it is for sale at, as the search answered. */
  provider: string;
  metadata?: {
    npa?: string;
    rateCenter?: string;
    state?: string;
    tier?: string;
  };
}

export interface NumberPricing {
  setup: number;
  monthly: number;
  firstMonth: number;
  currency: string;
  numbersUsed: number;
  numbersLimit: number | null;
  /** An enabled carrier sells toll-free. Absent from an older API: offered. */
  tollFreeAvailable?: boolean;
}

interface Campaign {
  id: string;
  name: string;
}

interface PurchaseAnswer {
  success?: boolean;
  data?: { phoneNumber: { id: string; number: string; status: string } };
}

const KINDS: Array<{ key: InventoryKind; label: string }> = [
  { key: 'local', label: 'Local' },
  { key: 'tollfree', label: 'Toll-free' },
];

const CARRIER_NAMES: Record<string, string> = {
  fractel: 'FracTEL',
  bulkvs: 'BulkVS',
  vonage: 'Vonage',
};

/** Where to search, for this kind of number and this area code or prefix. */
export function availablePath(kind: InventoryKind, areaCode: string): string {
  const params = new URLSearchParams({ type: kind });
  if (areaCode) params.set('areaCode', areaCode);
  return `/api/v1/numbers/available?${params.toString()}`;
}

/** Where to buy it: one route, whichever carrier the number came from. */
export const PURCHASE_PATH = '/api/v1/numbers/buy';

export function formatPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** "3 of 10 numbers used", or "3 numbers" when there is no limit. */
export function numbersUsedLine(used: number, limit: number | null): string {
  if (limit === null) return `${used} ${used === 1 ? 'number' : 'numbers'}`;
  return `${used} of ${limit} numbers used`;
}

function location(number: AvailableNumber | null, kind: InventoryKind): string {
  if (number?.metadata?.rateCenter) {
    return `${number.metadata.rateCenter}${number.metadata.state ? `, ${number.metadata.state}` : ''}`;
  }
  return kind === 'tollfree' ? 'Toll-free' : 'Local';
}

type Step = 'search' | 'confirm' | 'success';

export function BuyNumbersDialog({
  open,
  onOpenChange,
  onSuccess,
  isStaff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** NetEnroll staff: each result names the carrier it is for sale at. */
  isStaff: boolean;
}): JSX.Element {
  const [kind, setKind] = useState<InventoryKind>('local');
  const [step, setStep] = useState<Step>('search');
  const [areaCode, setAreaCode] = useState('');
  const [searched, setSearched] = useState(false);
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<AvailableNumber | null>(null);
  const [campaignId, setCampaignId] = useState('none');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pricing, setPricing] = useState<NumberPricing | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setKind('local');
      setStep('search');
      setAreaCode('');
      setSearched(false);
      setNumbers([]);
      setSelected(null);
      setCampaignId('none');
      setError(null);
      setBought(null);
      return;
    }

    let live = true;
    void (async () => {
      const [price, list] = await Promise.all([
        apiClient.get<{ data: NumberPricing }>('/api/v1/numbers/pricing'),
        apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns'),
      ]);
      if (!live) return;
      if (price.data?.data) {
        setPricing(price.data.data);
        setPricingError(null);
      } else {
        setPricing(null);
        setPricingError(price.error?.message ?? 'The price could not be loaded.');
      }
      setCampaigns(Array.isArray(list.data?.data) ? list.data.data : []);
    })();
    return () => {
      live = false;
    };
  }, [open]);

  // Toll-free only while a carrier the platform enabled sells it.
  const kinds = KINDS.filter(
    entry => entry.key !== 'tollfree' || pricing?.tollFreeAvailable !== false
  );
  useEffect(() => {
    if (kind === 'tollfree' && pricing?.tollFreeAvailable === false) setKind('local');
  }, [kind, pricing?.tollFreeAvailable]);

  const needsAreaCode = kind !== 'tollfree';
  const canSearch = needsAreaCode ? areaCode.length === 3 : true;
  const atLimit =
    pricing !== null &&
    pricing.numbersLimit !== null &&
    pricing.numbersUsed >= pricing.numbersLimit;

  async function search(): Promise<void> {
    if (!canSearch) {
      setError('Enter a 3-digit area code.');
      return;
    }
    setLoading(true);
    setError(null);
    setNumbers([]);
    try {
      const response = await apiClient.get<{ data: AvailableNumber[] }>(
        availablePath(kind, areaCode)
      );
      if (response.error) {
        setError(response.error.message || 'The search failed.');
        return;
      }
      setNumbers(Array.isArray(response.data?.data) ? response.data.data : []);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  async function buy(): Promise<void> {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post<PurchaseAnswer>(PURCHASE_PATH, {
        provider: selected.provider,
        number: selected.carrierId,
        areaCode: selected.metadata?.npa || areaCode || undefined,
        ...(campaignId !== 'none' ? { campaignId } : {}),
      });
      if (response.error) {
        setError(response.error.message || 'The number was not bought.');
        return;
      }
      setBought(response.data?.data?.phoneNumber.number ?? selected.number);
      setStep('success');
      onSuccess?.();
    } finally {
      setLoading(false);
    }
  }

  const priceBlock = pricing ? (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 t-body" data-number-pricing>
      <dt className="text-ink-3">Setup (once)</dt>
      <dd className="t-data text-right text-ink">{formatPrice(pricing.setup, pricing.currency)}</dd>
      <dt className="text-ink-3">Monthly</dt>
      <dd className="t-data text-right text-ink">
        {formatPrice(pricing.monthly, pricing.currency)}
      </dd>
      <dt className="text-ink-3">This month (prorated)</dt>
      <dd className="t-data text-right text-ink">
        {formatPrice(pricing.firstMonth, pricing.currency)}
      </dd>
      <dt className="border-t border-rule pt-1.5 font-medium text-ink">Due now</dt>
      <dd className="t-data border-t border-rule pt-1.5 text-right font-medium text-ink">
        {formatPrice(pricing.setup + pricing.firstMonth, pricing.currency)}
      </dd>
    </dl>
  ) : pricingError ? (
    <Notice tone="warning" title={pricingError} />
  ) : (
    <div className="flex items-center gap-2 t-meta text-ink-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading the price
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{step === 'success' ? 'Number bought' : 'Buy numbers'}</DialogTitle>
          <DialogDescription>
            {pricing
              ? numbersUsedLine(pricing.numbersUsed, pricing.numbersLimit)
              : 'Search by area code, pick a number, and confirm the price.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-4">
          {step === 'search' ? (
            <>
              <Tabs
                value={kind}
                onValueChange={value => {
                  setKind(value as InventoryKind);
                  setNumbers([]);
                  setSearched(false);
                  setError(null);
                }}
              >
                <TabsList
                  className={cn('grid w-full', kinds.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}
                >
                  {kinds.map(entry => (
                    <TabsTrigger key={entry.key} value={entry.key}>
                      {entry.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {atLimit ? (
                <Notice
                  tone="warning"
                  title="Your agency is at its number limit."
                  data-number-limit-reached
                >
                  Release a number you no longer use, or ask for a higher limit.
                </Notice>
              ) : null}

              <p className="t-meta text-ink-3">
                {kind === 'tollfree'
                  ? 'Search toll-free numbers. A prefix (800, 888, 877…) is optional.'
                  : 'Enter a 3-digit area code to search local numbers.'}
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                  <Input
                    aria-label={kind === 'tollfree' ? 'Toll-free prefix' : 'Area code'}
                    placeholder={
                      kind === 'tollfree' ? 'Prefix (optional, e.g. 888)' : 'Area code (e.g. 310)'
                    }
                    value={areaCode}
                    onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    className="pl-10"
                    inputMode="numeric"
                    maxLength={3}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && canSearch) void search();
                    }}
                  />
                </div>
                <Button onClick={() => void search()} disabled={loading || !canSearch}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </Button>
              </div>

              {numbers.length > 0 ? (
                <ul className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                  {numbers.map(num => (
                    <li key={num.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(num);
                          setStep('confirm');
                          setError(null);
                        }}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-card border border-rule bg-surface p-3 text-left',
                          'transition-colors hover:border-rule-strong hover:bg-sunken',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                      >
                        <Phone className="h-4 w-4 shrink-0 text-ink-3" />
                        <span className="t-data font-semibold text-ink">
                          {formatPhoneNumber(num.number)}
                        </span>
                        <span className="ml-auto t-meta text-ink-3">{location(num, kind)}</span>
                        {isStaff ? (
                          <span
                            className="shrink-0 rounded-full border border-rule px-2 py-0.5 t-meta text-ink-2"
                            data-carrier={num.provider}
                          >
                            {CARRIER_NAMES[num.provider] ?? num.provider}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : searched && !loading && !error ? (
                <p className="py-6 text-center t-meta text-ink-3">No numbers available.</p>
              ) : null}
            </>
          ) : step === 'confirm' ? (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 t-body">
                <span className="text-ink-3">Number</span>
                <span className="t-data text-right font-semibold text-ink">
                  {selected ? formatPhoneNumber(selected.number) : ''}
                </span>
                <span className="text-ink-3">Location</span>
                <span className="text-right text-ink">{location(selected, kind)}</span>
              </div>

              <div className="rounded-card border border-rule bg-sunken p-3">{priceBlock}</div>

              <div className="grid gap-1.5">
                <Label htmlFor="buy-number-campaign">Campaign (optional)</Label>
                <Select value={campaignId} onValueChange={setCampaignId} disabled={loading}>
                  <SelectTrigger id="buy-number-campaign">
                    <SelectValue placeholder="Choose later" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose later</SelectItem>
                    {campaigns.map(campaign => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="t-meta text-ink-3">Calls to the number go to this campaign.</p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-live-tint">
                <CheckCircle className="h-8 w-8 text-live-ink" />
              </span>
              <p className="t-data text-lg font-semibold text-ink">
                {bought ? formatPhoneNumber(bought) : ''}
              </p>
              <p className="t-meta text-ink-3">The number is yours and ready to take calls.</p>
            </div>
          )}

          {error ? <Notice tone="error" title={error} /> : null}
        </div>

        <DialogFooter>
          {step === 'confirm' ? (
            <>
              <Button variant="outline" onClick={() => setStep('search')} disabled={loading}>
                Back
              </Button>
              <Button onClick={() => void buy()} disabled={loading || !pricing}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {pricing
                  ? `Buy for ${formatPrice(pricing.setup + pricing.firstMonth, pricing.currency)}`
                  : 'Buy number'}
              </Button>
            </>
          ) : step === 'success' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
