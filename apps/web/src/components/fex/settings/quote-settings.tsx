'use client';

/**
 * The agency's quoter: which carriers it is appointed with, the face and
 * payment mode a new quote starts from, whether price-only plans are shown,
 * and whether the quoter opens by itself when a call connects. Agency
 * principals only (the API answers 403 to an agent).
 */

import { FACE_PRESETS, PAYMENT_MODES } from '@hopwhistle/fex-engine/catalog';
import type { PaymentMode } from '@hopwhistle/fex-engine/types';
import * as React from 'react';

import {
  CarrierLogo,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { useFexCatalog, useFexSettings } from '@/hooks/use-fex-quote';
import { fexApi, wholeDollars, type FexAgencySettings } from '@/lib/fex/api';

import { CheckRow, Field, NativeSelect } from '../parts';

export function QuoteSettings(): JSX.Element {
  const { catalog } = useFexCatalog();
  const { settings, loading, setSettings } = useFexSettings();
  const [form, setForm] = React.useState<FexAgencySettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (settings && !form) setForm(settings.agency);
  }, [settings, form]);

  const quotable = (catalog?.products ?? []).filter(p => p.quotable);
  const families = React.useMemo(() => {
    const map = new Map<string, typeof quotable>();
    for (const p of quotable) map.set(p.family, [...(map.get(p.family) ?? []), p]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [quotable]);

  if (loading || !form) {
    return <p className="t-meta text-ink-3">Loading settings…</p>;
  }

  const all = !form.appointedOnly;
  const appointed = new Set(form.appointedProductIds);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(appointed);
    if (on) next.add(id);
    else next.delete(id);
    setForm({ ...form, appointedProductIds: [...next] });
  };

  const save = async () => {
    setSaving(true);
    const result = await fexApi.saveSettings(form);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setForm(result.data.agency);
    if (settings) setSettings({ ...settings, agency: result.data.agency });
    toast({ title: 'Quoter settings saved' });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel>
        <PanelHeader
          action={
            <label className="flex items-center gap-2 text-sm text-ink">
              <Switch
                checked={all}
                onCheckedChange={on => setForm({ ...form, appointedOnly: !on })}
                aria-label="All carriers"
              />
              All carriers
            </label>
          }
        >
          <PanelTitle>Appointed carriers</PanelTitle>
          <p className="t-meta mt-1 text-ink-3">
            Plans you are not appointed with are hidden from your agents&apos; results unless they
            ask to see them.
          </p>
        </PanelHeader>
        <PanelBody className={all ? 'opacity-60' : undefined}>
          {all ? (
            <p className="mb-3 text-sm text-ink-2">Every quoted plan is treated as appointed.</p>
          ) : null}
          <fieldset disabled={all} className="space-y-4">
            <legend className="sr-only">Appointed plans</legend>
            {families.map(([family, products]) => (
              <div key={family}>
                <p className="t-label mb-1.5 flex items-center gap-2 text-ink-2">
                  <CarrierLogo names={[family]} size="xs" />
                  {family}
                </p>
                <div className="space-y-1.5">
                  {products.map(p => (
                    <CheckRow
                      key={p.id}
                      id={`appointed-${p.id}`}
                      checked={all || appointed.has(p.id)}
                      onChange={on => toggle(p.id, on)}
                    >
                      {p.product}
                    </CheckRow>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        </PanelBody>
      </Panel>

      <div className="space-y-4">
        <Panel>
          <PanelHeader>
            <PanelTitle>New quotes start with</PanelTitle>
          </PanelHeader>
          <PanelBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Face amount" htmlFor="settings-face">
              <NativeSelect
                id="settings-face"
                value={String(form.defaultFace)}
                onChange={e => setForm({ ...form, defaultFace: Number(e.target.value) })}
              >
                {[...new Set([...FACE_PRESETS, form.defaultFace])]
                  .sort((a, b) => a - b)
                  .map(face => (
                    <option key={face} value={face}>
                      {wholeDollars(face)}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Payment" htmlFor="settings-mode">
              <NativeSelect
                id="settings-mode"
                value={form.defaultMode}
                onChange={e => setForm({ ...form, defaultMode: e.target.value as PaymentMode })}
              >
                {PAYMENT_MODES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>Your agents&apos; quoter</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <CheckRow
              id="settings-price-only"
              checked={form.showPriceOnly}
              onChange={showPriceOnly => setForm({ ...form, showPriceOnly })}
            >
              Show price-only plans
              <span className="t-meta block text-ink-3">
                Plans whose health questions are not loaded yet, priced at their best class.
              </span>
            </CheckRow>
            <CheckRow
              id="settings-auto-open"
              checked={form.autoOpenOnCall}
              onChange={autoOpenOnCall => setForm({ ...form, autoOpenOnCall })}
            >
              Open the quoter automatically when a call connects
              <span className="t-meta block text-ink-3">
                Each agent can turn this off for themselves.
              </span>
            </CheckRow>
          </PanelBody>
        </Panel>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}
