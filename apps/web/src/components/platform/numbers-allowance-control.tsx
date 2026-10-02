'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

import { SettingsField, SettingsSection } from './settings-section';

interface TenantNumbers {
  tenantId: string;
  numbersLimit: number | null;
  numbersUsed: number;
  pricing: { setup: number; monthly: number };
}

/**
 * "Numbers": how many phone numbers an agency may hold, and what it pays for
 * each (a setup fee and a monthly fee).
 *
 * NetEnroll staff only, beside the Upgrades switches on Admin → Agencies.
 * `GET/PUT /api/v1/admin/tenants/:tenantId/numbers` refuses everybody else;
 * the `isPlatformAdmin` check only stops the control rendering for somebody
 * who could not use it. The agency sees the limit as "n of m numbers used" on
 * its Numbers page and the price on its purchase screen, before it confirms.
 *
 * Unlike the switches, this saves on its button: three fields that belong
 * together should not be half-saved one keystroke at a time.
 */
export function NumbersAllowanceControl({
  tenantId,
  agencyName,
}: {
  tenantId: string;
  agencyName: string;
}): JSX.Element | null {
  const { isPlatformAdmin } = useAuth();
  const [saved, setSaved] = useState<TenantNumbers | null>(null);
  const [form, setForm] = useState({ limit: '', setup: '', monthly: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function adopt(data: TenantNumbers): void {
    setSaved(data);
    setForm({
      limit: data.numbersLimit === null ? '' : String(data.numbersLimit),
      setup: String(data.pricing.setup),
      monthly: String(data.pricing.monthly),
    });
  }

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    setSaved(null);
    setError(null);
    void apiClient
      .get<Envelope<TenantNumbers>>(`/api/v1/admin/tenants/${tenantId}/numbers`)
      .then(response => {
        if (cancelled) return;
        const data = payload(response);
        if (response.error || !data) {
          setError(response.error?.message ?? 'Could not read this agency’s numbers settings.');
          return;
        }
        adopt(data);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, isPlatformAdmin]);

  if (!isPlatformAdmin) return null;

  const limit = form.limit.trim() === '' ? null : Number(form.limit);
  const setup = Number(form.setup);
  const monthly = Number(form.monthly);
  const valid =
    (limit === null || (Number.isInteger(limit) && limit >= 0)) &&
    form.setup.trim() !== '' &&
    Number.isFinite(setup) &&
    setup >= 0 &&
    form.monthly.trim() !== '' &&
    Number.isFinite(monthly) &&
    monthly >= 0;

  async function submit(): Promise<void> {
    if (!valid) return;
    setSaving(true);
    try {
      const response = await apiClient.put<Envelope<TenantNumbers>>(
        `/api/v1/admin/tenants/${tenantId}/numbers`,
        {
          ...(limit !== null ? { maxPhoneNumbers: limit } : {}),
          pricing: { setup, monthly },
        }
      );
      const data = payload(response);
      if (response.error || !data) {
        toast.error('Could not save numbers settings', response.error?.message);
        return;
      }
      adopt(data);
      toast.success('Numbers settings saved', `${agencyName} sees them on their next page load.`);
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: 'limit' | 'setup' | 'monthly',
    label: string,
    step: string,
    hint?: string
  ) => (
    <SettingsField label={label} htmlFor={`numbers-${key}`} hint={hint}>
      <Input
        id={`numbers-${key}`}
        type="number"
        min={0}
        step={step}
        value={form[key]}
        onChange={event => setForm(f => ({ ...f, [key]: event.target.value }))}
        className="h-9"
        disabled={saved === null || saving}
        data-numbers-field={key}
      />
    </SettingsField>
  );

  return (
    <SettingsSection
      title="Phone numbers"
      description="How many numbers this agency may hold, and what it pays for each."
      meta={saved ? `${saved.numbersUsed} in use` : undefined}
      data-testid="numbers-control"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {field('limit', 'Numbers limit', '1', 'Blank for no limit')}
        {field('setup', 'Setup price (USD)', '0.01')}
        {field('monthly', 'Monthly price (USD)', '0.01')}
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void submit()}
          disabled={saved === null || saving || !valid}
        >
          {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Save numbers settings
        </Button>
        {error ? <p className="t-meta text-dropped-ink">{error}</p> : null}
      </div>
    </SettingsSection>
  );
}
