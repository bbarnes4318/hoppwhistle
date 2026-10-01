'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusChip,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/** One carrier, as `GET /api/v1/platform/number-carriers` answers it. */
export interface NumberCarrier {
  provider: string;
  label: string;
  purchasable: boolean;
  configured: boolean;
  enabled: boolean;
  isDefault: boolean;
  numberTypes: Array<'local' | 'tollfree'>;
  unavailableReason: string | null;
  updatedAt: string | null;
}

interface Draft {
  enabled: Record<string, boolean>;
  defaultProvider: string | null;
}

function draftOf(carriers: NumberCarrier[]): Draft {
  return {
    enabled: Object.fromEntries(carriers.map(c => [c.provider, c.enabled])),
    defaultProvider: carriers.find(c => c.isDefault)?.provider ?? null,
  };
}

function kinds(carrier: NumberCarrier): string {
  if (carrier.numberTypes.length === 0) return '—';
  return carrier.numberTypes.map(t => (t === 'tollfree' ? 'Toll-free' : 'Local')).join(' · ');
}

/**
 * Settings -> Number carriers: which carriers agencies buy phone numbers from.
 *
 * NetEnroll's, and nobody else's. The tab is drawn for a platform admin who is
 * not previewing an agency, and the endpoints behind it refuse anyone who is
 * not a platform admin (`requirePlatformAdmin`). An agency owner never sees a
 * carrier: their Buy numbers dialog searches every carrier switched on here,
 * the default first, and the server refuses a purchase from one switched off.
 *
 * Saved whole, with one button: a half-applied change -- a new default saved
 * before the carrier it names was switched on -- is exactly what the server's
 * validation would refuse, so the screen sends the complete choice at once and
 * shows the server's reason when it is refused.
 */
export function NumberCarriersPanel(): JSX.Element {
  const [carriers, setCarriers] = useState<NumberCarrier[] | null>(null);
  const [draft, setDraft] = useState<Draft>({ enabled: {}, defaultProvider: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<{ data: NumberCarrier[] }>(
      '/api/v1/platform/number-carriers'
    );
    if (response.error || !Array.isArray(response.data?.data)) {
      setLoadError(response.error?.message ?? 'The carriers could not be loaded.');
      return;
    }
    setLoadError(null);
    setCarriers(response.data.data);
    setDraft(draftOf(response.data.data));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = useMemo(() => (carriers ? draftOf(carriers) : null), [carriers]);
  const dirty =
    saved !== null &&
    (saved.defaultProvider !== draft.defaultProvider ||
      Object.entries(draft.enabled).some(([provider, on]) => saved.enabled[provider] !== on));
  const enabledCount = Object.values(draft.enabled).filter(Boolean).length;

  function setEnabled(provider: string, on: boolean): void {
    setSaveError(null);
    setDraft(current => {
      const enabled = { ...current.enabled, [provider]: on };
      let defaultProvider = current.defaultProvider;
      // Switching the default off moves the default to the next carrier on;
      // switching the first carrier on makes it the default.
      if (!on && defaultProvider === provider) {
        defaultProvider = Object.keys(enabled).find(p => enabled[p]) ?? null;
      }
      if (on && !defaultProvider) defaultProvider = provider;
      return { enabled, defaultProvider };
    });
  }

  async function save(): Promise<void> {
    if (!carriers) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await apiClient.put<{ data: NumberCarrier[] }>(
        '/api/v1/platform/number-carriers',
        {
          carriers: carriers
            .filter(c => c.purchasable)
            .map(c => ({ provider: c.provider, enabled: draft.enabled[c.provider] === true })),
          defaultProvider: draft.defaultProvider,
        }
      );
      if (response.error || !Array.isArray(response.data?.data)) {
        setSaveError(response.error?.message ?? 'The carriers were not saved.');
        return;
      }
      setCarriers(response.data.data);
      setDraft(draftOf(response.data.data));
      toast({
        title: 'Number carriers saved',
        description: 'Agencies buy from these from now on.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel data-number-carriers>
      <PanelHeader
        action={
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => saved && setDraft(saved)}
                disabled={saving}
              >
                Discard
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={!dirty || saving || enabledCount === 0}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        }
      >
        <PanelTitle>Number carriers</PanelTitle>
        <PanelDescription>
          Which carriers agencies buy phone numbers from. Agency owners never choose: Buy numbers
          searches the carriers switched on here, the default first.
        </PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        {loadError ? (
          <div className="p-5">
            <Notice tone="error" title={loadError} />
          </div>
        ) : !carriers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
          </div>
        ) : (
          <>
            {saveError ? (
              <div className="px-5 pt-4">
                <Notice tone="error" title={saveError} />
              </div>
            ) : null}
            {enabledCount === 0 ? (
              <div className="px-5 pt-4">
                <Notice
                  tone="warning"
                  title="Keep at least one carrier on, or no agency can buy a number."
                />
              </div>
            ) : null}
            <ul className="divide-y divide-rule" aria-label="Number carriers">
              {carriers.map(carrier => {
                const on = draft.enabled[carrier.provider] === true;
                const canSwitchOn = carrier.purchasable && (carrier.configured || carrier.enabled);
                const isDefault = draft.defaultProvider === carrier.provider;
                return (
                  <li
                    key={carrier.provider}
                    data-carrier={carrier.provider}
                    className={cn(
                      'flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 min-[1440px]:px-6',
                      !carrier.purchasable && 'opacity-70'
                    )}
                  >
                    <Switch
                      checked={on}
                      onCheckedChange={next => setEnabled(carrier.provider, next)}
                      disabled={saving || (!on && !canSwitchOn)}
                      aria-label={`Sell numbers from ${carrier.label}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="t-body font-medium text-ink">{carrier.label}</span>
                        {!carrier.purchasable ? (
                          <StatusChip
                            size="sm"
                            value="UNAVAILABLE"
                            tone="neutral"
                            label="Not available"
                          />
                        ) : !carrier.configured ? (
                          <StatusChip
                            size="sm"
                            value="NOT_CONFIGURED"
                            tone="dropped"
                            label="No credentials"
                          />
                        ) : null}
                        {isDefault && on ? (
                          <StatusChip size="sm" value="DEFAULT" tone="live" label="Default" />
                        ) : null}
                      </div>
                      <p className="t-meta text-ink-3">
                        {!carrier.purchasable
                          ? carrier.unavailableReason
                          : !carrier.configured
                            ? 'Its credentials are not set on the server, so it cannot be searched.'
                            : kinds(carrier)}
                      </p>
                    </div>
                    {carrier.purchasable ? (
                      <label
                        className={cn(
                          'flex min-h-[44px] items-center gap-2 t-meta',
                          on ? 'cursor-pointer text-ink-2' : 'cursor-not-allowed text-ink-3'
                        )}
                      >
                        <input
                          type="radio"
                          name="default-number-carrier"
                          value={carrier.provider}
                          checked={isDefault}
                          disabled={!on || saving}
                          onChange={() => {
                            setSaveError(null);
                            setDraft(current => ({
                              ...current,
                              defaultProvider: carrier.provider,
                            }));
                          }}
                          className="h-4 w-4 accent-[var(--brand)]"
                        />
                        Default
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
