'use client';

/**
 * Quotas & Budgets — this agency's ceilings, its spend, and who may move them.
 *
 * ── The tenant, and where it is allowed to come from ─────────────────────────
 *
 * This page used to open with:
 *
 *     useEffect(() => {
 *       // Load tenant ID from context or URL
 *       // For now, using a placeholder
 *       setTenantId('00000000-0000-0000-0000-000000000000');
 *     }, []);
 *
 * Every request it built named that id, so every request 404'd: three of them
 * per load, and not one figure on the screen was ever real. The comment's other
 * half is the more important half to have refused — a tenant is NEVER read from
 * a URL, a path, a query parameter or a header on this platform. There is one
 * source, the session, and `apps/api/src/lib/tenant-context.ts` is where the
 * server derives it from the authenticated principal.
 *
 * So the reading is now `GET /api/v1/quota/summary`, which names no tenant at
 * all: the server answers for whoever is asking. Nothing on this page passes an
 * id to be told whose numbers these are.
 *
 * ── Reading and writing are different questions ──────────────────────────────
 *
 * An agency reads its own ceilings. It does not set them — `quotas.ts` has said
 * so since the gate was fixed, and it is the whole reason a quota means
 * anything. The write routes are `/admin/api/v1/tenants/:id/...` and stay
 * gated on the platform capability, so:
 *
 *   - an agency user gets the numbers, read-only;
 *   - NetEnroll staff INSIDE an agency get the same numbers plus the controls,
 *     addressed to `platform.actingTenant.id` — the agency they entered through
 *     the switcher, which is session state read back from
 *     `/api/v1/platform/context`, not something in the address bar. The id in
 *     that path names the object being administered; the authority to
 *     administer it comes from the capability.
 *
 * ── And staff with no agency entered ─────────────────────────────────────────
 *
 * `/settings` is in `PLATFORM_WIDE_PREFIXES`, so an operator can open this page
 * having entered no agency. There is no cross-agency reading of one agency's
 * quota, so the page asks for nothing in that state and says which switcher
 * fixes it — the same shape as `settings/users` and `settings`.
 */

import { AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { StatTile } from '@/components/domain/stat-tile';
import { CompactPageShell, CompactPageHeader } from '@/components/layout/compact-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

interface QuotaLimits {
  maxConcurrentCalls: number | null;
  maxMinutesPerDay: number | null;
  maxRecordingRetentionDays: number | null;
  maxPhoneNumbers: number | null;
  maxStorageGB: number | null;
  enabled: boolean;
}

interface BudgetSettings {
  monthlyBudget: number | null;
  dailyBudget: number | null;
  alertThreshold: number;
  alertEmails: string[];
  /**
   * Whether a webhook is set, never the URL. It is a posting credential and the
   * screen only ever needs to say whether one exists — see the route.
   */
  alertSlackWebhookConfigured: boolean;
  hardStopEnabled: boolean;
  enabled: boolean;
}

interface Meter {
  current: number;
  limit: number | null;
  remaining: number | null;
}

interface QuotaStatus {
  concurrentCalls: Meter;
  dailyMinutes: Meter;
  phoneNumbers: Meter;
  budget: {
    daily: { current: number; limit: number | null; percentage: number | null };
    monthly: { current: number; limit: number | null; percentage: number | null };
  } | null;
}

interface QuotaSummary {
  quota: QuotaLimits | null;
  budget: BudgetSettings | null;
  status: QuotaStatus | null;
}

const money = (value: number) => `$${value.toFixed(2)}`;
const count = (value: number | null) => (value === null ? 'Unlimited' : value.toLocaleString());

export default function QuotasPage() {
  const platform = usePlatformContext();

  /** NetEnroll staff, in no agency: nothing here has a cross-agency reading. */
  const withoutAgency = platform.needsAgency;

  /**
   * The agency whose quota the write controls address, or null for everyone
   * who may not write one. Read from the session context; there is deliberately
   * no other way for it to be set.
   */
  const administering = platform.isPlatformAdmin ? platform.actingTenant : null;

  const [summary, setSummary] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Quota form state (staff only; prefilled from the reading above)
  const [quota, setQuota] = useState({
    maxConcurrentCalls: '',
    maxMinutesPerDay: '',
    maxRecordingRetentionDays: '',
    maxPhoneNumbers: '',
    maxStorageGB: '',
    enabled: true,
  });

  // Budget form state
  const [budget, setBudget] = useState({
    monthlyBudget: '',
    dailyBudget: '',
    alertThreshold: '80',
    alertEmails: '',
    alertSlackWebhook: '',
    hardStopEnabled: true,
    enabled: true,
  });

  // Override token
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);

    const response = await apiClient.get<Envelope<QuotaSummary>>('/api/v1/quota/summary');
    const data = payload(response);

    if (!data) {
      setError(response.error?.message ?? 'Failed to load quotas');
      setLoading(false);
      return;
    }

    setError(null);
    setSummary(data);

    setQuota({
      maxConcurrentCalls: data.quota?.maxConcurrentCalls?.toString() ?? '',
      maxMinutesPerDay: data.quota?.maxMinutesPerDay?.toString() ?? '',
      maxRecordingRetentionDays: data.quota?.maxRecordingRetentionDays?.toString() ?? '',
      maxPhoneNumbers: data.quota?.maxPhoneNumbers?.toString() ?? '',
      maxStorageGB: data.quota?.maxStorageGB?.toString() ?? '',
      enabled: data.quota?.enabled ?? true,
    });

    setBudget({
      monthlyBudget: data.budget?.monthlyBudget?.toString() ?? '',
      dailyBudget: data.budget?.dailyBudget?.toString() ?? '',
      alertThreshold: data.budget?.alertThreshold?.toString() ?? '80',
      alertEmails: data.budget?.alertEmails.join(', ') ?? '',
      // Never prefilled: the reading does not carry the URL. Blank leaves it
      // as it is, which is what the API does with an absent field.
      alertSlackWebhook: '',
      hardStopEnabled: data.budget?.hardStopEnabled ?? true,
      enabled: data.budget?.enabled ?? true,
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    // Until the context has settled we do not know which of the three states
    // this is, and guessing means a request that cannot succeed.
    if (platform.loading) return;

    if (withoutAgency) {
      setSummary(null);
      setLoading(false);
      return;
    }

    void loadSummary();
  }, [platform.loading, withoutAgency, loadSummary]);

  /**
   * A number the operator typed, or null to clear the ceiling.
   *
   * Anything unparseable is null too, deliberately: `NaN` serialises to null
   * over the wire anyway, so guarding here is what makes that visible rather
   * than a surprise the server absorbs.
   */
  const asNumber = (value: string, parse: (raw: string) => number) => {
    if (value.trim() === '') return null;
    const parsed = parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const asInt = (value: string) => asNumber(value, raw => parseInt(raw, 10));
  const asFloat = (value: string) => asNumber(value, parseFloat);

  const announce = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  const saveQuota = async () => {
    if (!administering) return;

    setSaving(true);
    setError(null);

    const response = await apiClient.patch(`/admin/api/v1/tenants/${administering.id}/quota`, {
      maxConcurrentCalls: asInt(quota.maxConcurrentCalls),
      maxMinutesPerDay: asInt(quota.maxMinutesPerDay),
      maxRecordingRetentionDays: asInt(quota.maxRecordingRetentionDays),
      maxPhoneNumbers: asInt(quota.maxPhoneNumbers),
      maxStorageGB: asFloat(quota.maxStorageGB),
      enabled: quota.enabled,
    });

    setSaving(false);

    if (response.error) {
      setError(response.error.message || 'Failed to save quota settings');
      return;
    }

    announce('Quota settings saved');
    await loadSummary();
  };

  const saveBudget = async () => {
    if (!administering) return;

    setSaving(true);
    setError(null);

    const response = await apiClient.patch(`/admin/api/v1/tenants/${administering.id}/budget`, {
      monthlyBudget: asFloat(budget.monthlyBudget),
      dailyBudget: asFloat(budget.dailyBudget),
      alertThreshold: parseFloat(budget.alertThreshold),
      alertEmails: budget.alertEmails
        .split(',')
        .map(e => e.trim())
        .filter(Boolean),
      // Absent rather than null when blank: an untouched field must not wipe
      // a webhook the page was never shown.
      ...(budget.alertSlackWebhook.trim()
        ? { alertSlackWebhook: budget.alertSlackWebhook.trim() }
        : {}),
      hardStopEnabled: budget.hardStopEnabled,
      enabled: budget.enabled,
    });

    setSaving(false);

    if (response.error) {
      setError(response.error.message || 'Failed to save budget settings');
      return;
    }

    announce('Budget settings saved');
    await loadSummary();
  };

  const generateOverrideToken = async () => {
    if (!administering) return;

    setSaving(true);
    setError(null);

    const response = await apiClient.post<{ token: string; expiresAt: string }>(
      `/admin/api/v1/tenants/${administering.id}/budget/override-token`,
      { expiresInHours: 24 }
    );

    setSaving(false);

    if (response.error || !response.data) {
      setError(response.error?.message || 'Failed to generate override token');
      return;
    }

    setOverrideToken(response.data.token);
    setTokenExpiresAt(response.data.expiresAt);
    announce('Override token generated');
  };

  const revokeOverrideToken = async () => {
    if (!administering) return;

    setSaving(true);
    setError(null);

    const response = await apiClient.delete(
      `/admin/api/v1/tenants/${administering.id}/budget/override-token`
    );

    setSaving(false);

    if (response.error) {
      setError(response.error.message || 'Failed to revoke override token');
      return;
    }

    setOverrideToken(null);
    setTokenExpiresAt(null);
    announce('Override token revoked');
  };

  // ── The cross-agency state: no request, and a way out ──────────────────────
  if (withoutAgency) {
    return (
      <CompactPageShell fullHeight={false}>
        <CompactPageHeader
          title="Quotas & Budgets"
          subtitle="Call ceilings and spend caps, per agency"
        />
        <Card className="border-rule">
          <CardContent className="flex items-start gap-3 p-4">
            <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-3" />
            <div>
              <div className="t-section text-ink">A quota belongs to one agency</div>
              <p className="t-body mt-1 text-ink-3">
                Concurrent calls, daily minutes, phone numbers and spend are counted per agency, so
                there is nothing to show across all of them. Enter an agency in the switcher above
                to see and set its limits.
              </p>
            </div>
          </CardContent>
        </Card>
      </CompactPageShell>
    );
  }

  const status = summary?.status ?? null;
  /** Null when there is no cap to be a percentage of. */
  const monthlyUsedPct = status?.budget?.monthly.percentage ?? null;
  const limits = summary?.quota ?? null;
  const spend = summary?.budget ?? null;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Quotas & Budgets"
        subtitle={
          administering
            ? `Limits and spend caps for ${administering.name ?? 'this agency'}`
            : 'Your agency’s limits and spend, set by NetEnroll'
        }
      />

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <AlertDescription className="t-body">{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="py-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <AlertDescription className="t-body">{success}</AlertDescription>
        </Alert>
      )}

      {/* ── Current usage ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Concurrent calls"
          loading={loading}
          figure={
            status ? `${status.concurrentCalls.current}${meterLimit(status.concurrentCalls)}` : '—'
          }
          sub={status ? meterSub(status.concurrentCalls, 'remaining') : 'No reading'}
        />
        <StatTile
          label="Minutes today"
          loading={loading}
          figure={status ? `${status.dailyMinutes.current}${meterLimit(status.dailyMinutes)}` : '—'}
          sub={status ? meterSub(status.dailyMinutes, 'remaining') : 'No reading'}
        />
        <StatTile
          label="Phone numbers"
          loading={loading}
          figure={status ? `${status.phoneNumbers.current}${meterLimit(status.phoneNumbers)}` : '—'}
          sub={status ? meterSub(status.phoneNumbers, 'remaining') : 'No reading'}
        />
        <StatTile
          label="Spend this month"
          loading={loading}
          figure={
            status?.budget
              ? `${money(status.budget.monthly.current)}${
                  status.budget.monthly.limit === null
                    ? ''
                    : ` / ${money(status.budget.monthly.limit)}`
                }`
              : '—'
          }
          sub={
            monthlyUsedPct === null ? 'No budget set' : `${monthlyUsedPct.toFixed(1)}% of the cap`
          }
        />
      </div>

      <Tabs defaultValue="quotas" className="flex flex-col">
        <TabsList className="h-9 w-full justify-start gap-6 border-b border-rule bg-transparent p-0">
          <TabsTrigger
            value="quotas"
            className="h-9 rounded-none border-b-2 border-transparent px-1 text-xs font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Quotas
          </TabsTrigger>
          <TabsTrigger
            value="budget"
            className="h-9 rounded-none border-b-2 border-transparent px-1 text-xs font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Budget
          </TabsTrigger>
          <TabsTrigger
            value="overrides"
            className="h-9 rounded-none border-b-2 border-transparent px-1 text-xs font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Overrides
          </TabsTrigger>
        </TabsList>

        {/* ── Quotas ─────────────────────────────────────────────────────── */}
        <TabsContent value="quotas" className="mt-3">
          <Card className="border-rule">
            <CardHeader className="border-b border-rule/60 p-3 pb-2">
              <CardTitle className="t-label text-ink-3">Quota settings</CardTitle>
              <CardDescription className="t-meta text-ink-3">
                {administering
                  ? 'Ceilings enforced on every call this agency places.'
                  : 'Ceilings enforced on every call you place. NetEnroll sets these.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3 p-3">
              {administering ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="t-body">Enforce quotas</Label>
                    <Switch
                      checked={quota.enabled}
                      onCheckedChange={checked => setQuota({ ...quota, enabled: checked })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <NumberField
                      id="maxConcurrentCalls"
                      label="Max concurrent calls"
                      value={quota.maxConcurrentCalls}
                      onChange={value => setQuota({ ...quota, maxConcurrentCalls: value })}
                    />
                    <NumberField
                      id="maxMinutesPerDay"
                      label="Max minutes per day"
                      value={quota.maxMinutesPerDay}
                      onChange={value => setQuota({ ...quota, maxMinutesPerDay: value })}
                    />
                    <NumberField
                      id="maxPhoneNumbers"
                      label="Max phone numbers"
                      value={quota.maxPhoneNumbers}
                      onChange={value => setQuota({ ...quota, maxPhoneNumbers: value })}
                    />
                    <NumberField
                      id="maxRecordingRetentionDays"
                      label="Max recording retention (days)"
                      value={quota.maxRecordingRetentionDays}
                      onChange={value => setQuota({ ...quota, maxRecordingRetentionDays: value })}
                    />
                    <NumberField
                      id="maxStorageGB"
                      label="Max storage (GB)"
                      step="0.01"
                      value={quota.maxStorageGB}
                      onChange={value => setQuota({ ...quota, maxStorageGB: value })}
                    />
                  </div>

                  <p className="t-meta text-ink-3">
                    An empty field is no ceiling at all. Saving one blank removes the limit.
                  </p>

                  <Button onClick={() => void saveQuota()} disabled={saving || loading} size="sm">
                    Save quota settings
                  </Button>
                </>
              ) : (
                <Readings
                  loading={loading}
                  rows={[
                    ['Quotas enforced', limits ? (limits.enabled ? 'Yes' : 'No') : 'No limits set'],
                    ['Max concurrent calls', count(limits?.maxConcurrentCalls ?? null)],
                    ['Max minutes per day', count(limits?.maxMinutesPerDay ?? null)],
                    ['Max phone numbers', count(limits?.maxPhoneNumbers ?? null)],
                    [
                      'Max recording retention',
                      limits?.maxRecordingRetentionDays == null
                        ? 'Unlimited'
                        : `${limits.maxRecordingRetentionDays} days`,
                    ],
                    [
                      'Max storage',
                      limits?.maxStorageGB == null ? 'Unlimited' : `${limits.maxStorageGB} GB`,
                    ],
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Budget ─────────────────────────────────────────────────────── */}
        <TabsContent value="budget" className="mt-3 space-y-3">
          <Card className="border-rule">
            <CardHeader className="border-b border-rule/60 p-3 pb-2">
              <CardTitle className="t-label text-ink-3">Budget settings</CardTitle>
              <CardDescription className="t-meta text-ink-3">
                Spend caps, the threshold alerts fire at, and whether the cap stops calls.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3 p-3">
              {administering ? (
                <>
                  <div className="flex items-center justify-between">
                    <Label className="t-body">Enforce budget</Label>
                    <Switch
                      checked={budget.enabled}
                      onCheckedChange={checked => setBudget({ ...budget, enabled: checked })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <NumberField
                      id="monthlyBudget"
                      label="Monthly budget ($)"
                      step="0.01"
                      value={budget.monthlyBudget}
                      onChange={value => setBudget({ ...budget, monthlyBudget: value })}
                    />
                    <NumberField
                      id="dailyBudget"
                      label="Daily budget ($)"
                      step="0.01"
                      value={budget.dailyBudget}
                      onChange={value => setBudget({ ...budget, dailyBudget: value })}
                    />
                    <NumberField
                      id="alertThreshold"
                      label="Alert threshold (%)"
                      placeholder="80"
                      value={budget.alertThreshold}
                      onChange={value => setBudget({ ...budget, alertThreshold: value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="alertEmails" className="t-body">
                      Alert email addresses
                    </Label>
                    <Input
                      id="alertEmails"
                      className="h-8"
                      value={budget.alertEmails}
                      onChange={e => setBudget({ ...budget, alertEmails: e.target.value })}
                      placeholder="admin@example.com, finance@example.com"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="alertSlackWebhook" className="t-body">
                      Slack webhook URL
                    </Label>
                    <Input
                      id="alertSlackWebhook"
                      className="h-8"
                      value={budget.alertSlackWebhook}
                      onChange={e => setBudget({ ...budget, alertSlackWebhook: e.target.value })}
                      placeholder={
                        spend?.alertSlackWebhookConfigured
                          ? 'A webhook is configured — type a new one to replace it'
                          : 'https://hooks.slack.com/services/...'
                      }
                    />
                    <p className="t-meta text-ink-3">
                      Never displayed back: it is a posting credential. Blank leaves the current one
                      in place.
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="t-body">Hard stop at the cap</Label>
                    <Switch
                      checked={budget.hardStopEnabled}
                      onCheckedChange={checked =>
                        setBudget({ ...budget, hardStopEnabled: checked })
                      }
                    />
                  </div>

                  <Button onClick={() => void saveBudget()} disabled={saving || loading} size="sm">
                    Save budget settings
                  </Button>
                </>
              ) : (
                <Readings
                  loading={loading}
                  rows={[
                    ['Budget enforced', spend ? (spend.enabled ? 'Yes' : 'No') : 'No budget set'],
                    [
                      'Monthly budget',
                      spend?.monthlyBudget == null ? 'Uncapped' : money(spend.monthlyBudget),
                    ],
                    [
                      'Daily budget',
                      spend?.dailyBudget == null ? 'Uncapped' : money(spend.dailyBudget),
                    ],
                    [
                      'Spend today',
                      status?.budget ? money(status.budget.daily.current) : 'No reading',
                    ],
                    ['Alert threshold', spend ? `${spend.alertThreshold}%` : '—'],
                    [
                      'Alerts sent to',
                      spend && spend.alertEmails.length > 0
                        ? spend.alertEmails.join(', ')
                        : 'Nobody',
                    ],
                    [
                      'Slack alerts',
                      spend?.alertSlackWebhookConfigured ? 'Configured' : 'Not configured',
                    ],
                    ['Calls stop at the cap', spend ? (spend.hardStopEnabled ? 'Yes' : 'No') : '—'],
                  ]}
                />
              )}
            </CardContent>
          </Card>

          {/* The token bypasses the hard stop, so only staff may mint one. */}
          {administering && (
            <Card className="border-rule">
              <CardHeader className="border-b border-rule/60 p-3 pb-2">
                <CardTitle className="t-label text-ink-3">Override token</CardTitle>
                <CardDescription className="t-meta text-ink-3">
                  Lets this agency keep dialling past its hard stop for 24 hours.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {overrideToken ? (
                  <>
                    <Alert className="py-2">
                      <AlertDescription>
                        <div className="t-data break-all">{overrideToken}</div>
                        {tokenExpiresAt && (
                          <div className="t-meta mt-1 text-ink-3">
                            Expires {new Date(tokenExpiresAt).toLocaleString()}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                    <p className="t-meta text-ink-3">
                      Shown once. Send it in the <code className="t-data">X-Quota-Override</code>{' '}
                      header.
                    </p>
                    <Button
                      variant="destructive"
                      onClick={() => void revokeOverrideToken()}
                      disabled={saving}
                      size="sm"
                    >
                      Revoke token
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => void generateOverrideToken()}
                    disabled={saving || loading}
                    size="sm"
                  >
                    Generate override token
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Overrides ──────────────────────────────────────────────────── */}
        <TabsContent value="overrides" className="mt-3">
          <Card className="border-rule">
            <CardHeader className="border-b border-rule/60 p-3 pb-2">
              <CardTitle className="t-label text-ink-3">Quota overrides</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <p className="t-body text-ink-3">
                {administering
                  ? 'A quota override raises one limit temporarily, with a reason and an expiry. They are created through the platform API.'
                  : 'A quota override raises one of your limits temporarily. NetEnroll grants them; ask your account contact if you need one.'}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </CompactPageShell>
  );
}

/** ` / 40` when there is a ceiling, and nothing at all when there is not. */
function meterLimit(meter: Meter): string {
  return meter.limit === null ? '' : ` / ${meter.limit}`;
}

function meterSub(meter: Meter, noun: string): string {
  return meter.remaining === null ? 'No limit set' : `${meter.remaining} ${noun}`;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  step,
  placeholder = 'Unlimited',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="t-body">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        className="h-8"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

/** The read-only face of the same settings, for an agency that cannot set them. */
function Readings({ rows, loading }: { rows: Array<[string, string]>; loading: boolean }) {
  if (loading) {
    return <p className="t-body text-ink-3">Loading…</p>;
  }

  return (
    <dl className="divide-y divide-rule/60">
      {rows.map(([term, value]) => (
        <div key={term} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="t-body text-ink-3">{term}</dt>
          <dd className="t-body text-right text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
