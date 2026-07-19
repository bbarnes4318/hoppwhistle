'use client';

import type {
  CostEstimate,
  ModeDefinition,
  ProviderAssignments,
  ResearchBriefInput,
  ResearchMode,
} from '@hopwhistle/shared';
import { AlertTriangle, ChevronDown, Loader2, Save, Telescope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

import { researchApi, type ResearchConfig } from './api';
import { CapabilityPicker } from './CapabilityPicker';

const RISK: Array<{ value: string; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
];

const emptyBrief: ResearchBriefInput = {
  industry: '',
  geography: '',
  customer: '',
  businessModel: '',
  startingCapital: '',
  timeToFirstRevenue: '',
  timeToProfit: '',
  riskTolerance: undefined,
  constraints: '',
  capabilities: [],
  mode: 'full_due_diligence',
  maxBudgetUsd: 40,
  includeSocial: true,
  includeLegal: true,
  includeTech: true,
  includeAcquisitions: false,
  includeFirstCustomerPlan: true,
  outputDetail: 'detailed',
  currency: 'USD',
  language: 'English',
};

export function ResearchConfigForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [config, setConfig] = useState<ResearchConfig | null>(null);
  const [brief, setBrief] = useState<ResearchBriefInput>(emptyBrief);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [assignments, setAssignments] = useState<ProviderAssignments | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const set = useCallback(
    <K extends keyof ResearchBriefInput>(key: K, value: ResearchBriefInput[K]) => {
      setBrief(b => ({ ...b, [key]: value }));
    },
    []
  );

  useEffect(() => {
    researchApi
      .getConfig()
      .then(setConfig)
      .catch(e =>
        toast({ title: 'Failed to load config', description: String(e), variant: 'destructive' })
      );
  }, [toast]);

  // Re-estimate when mode changes.
  useEffect(() => {
    let active = true;
    researchApi
      .estimate(brief.mode)
      .then(r => {
        if (!active) return;
        setEstimate(r.estimate);
        setAssignments(r.assignments);
        // Default the budget to the mode default the first time.
        setBrief(b => ({ ...b, maxBudgetUsd: b.maxBudgetUsd || Math.ceil(r.estimate.highUsd) }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [brief.mode]);

  const modeDef: ModeDefinition | undefined = useMemo(
    () => config?.modes.find(m => m.id === brief.mode),
    [config, brief.mode]
  );

  const assumptions = useMemo(() => {
    const out: string[] = [];
    if (!brief.geography?.trim()) out.push('Geographic market → United States');
    if (!brief.customer?.trim()) out.push('Customer → analyze multiple personas');
    if (!brief.businessModel?.trim()) out.push('Business model → open to any model');
    if (!brief.startingCapital?.trim()) out.push('Starting capital → under $25,000');
    if (!brief.timeToFirstRevenue?.trim()) out.push('Time to first revenue → 90 days');
    if (!brief.riskTolerance) out.push('Risk tolerance → moderate');
    if (brief.capabilities.length === 0)
      out.push('Capabilities → generalist software + sales team');
    return out;
  }, [brief]);

  const budgetWarning = estimate ? estimate.highUsd > brief.maxBudgetUsd : false;

  // Real preflight: which required roles for the selected mode lack a usable,
  // key-bearing provider. The Start button is disabled until these are resolved.
  const missingProviders = useMemo(() => {
    if (!config || !modeDef || !assignments) return [] as string[];
    const byId = new Map(config.providers.map(p => [p.id, p]));
    const out: string[] = [];
    for (const role of modeDef.roles) {
      const providerId = (assignments as Record<string, string>)[role];
      const p = byId.get(providerId);
      if (!p || !p.enabled || !p.hasKey) {
        const label = config.roleLabels[role as never] ?? role;
        out.push(`${label}: ${p ? p.label : providerId} not configured`);
      }
    }
    return out;
  }, [config, modeDef, assignments]);

  const submit = async () => {
    if (brief.industry.trim().length < 2) {
      toast({ title: 'Industry is required', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await researchApi.createRun(brief);
      toast({ title: 'Research started', description: 'Your run is queued.' });
      router.push(`/tools/industry-research/${res.id}`);
    } catch (e) {
      toast({ title: 'Failed to start research', description: String(e), variant: 'destructive' });
      setSubmitting(false);
    }
  };

  const saveProfile = async () => {
    if (!profileName.trim() || brief.capabilities.length === 0) return;
    setSavingProfile(true);
    try {
      await researchApi.saveProfile(profileName.trim(), brief.capabilities);
      toast({ title: 'Team profile saved' });
      setProfileName('');
    } catch (e) {
      toast({ title: 'Failed to save profile', description: String(e), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Left: form */}
      <div className="space-y-6">
        {missingProviders.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <strong>Real providers required.</strong> This mode cannot run until every required
              provider is configured with an API key:
              <ul className="mt-1 list-disc pl-5">
                {missingProviders.map(m => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Research target */}
        <Card>
          <CardHeader>
            <CardTitle>Research target</CardTitle>
            <CardDescription>
              What should we investigate? Blank fields become explicit assumptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry" required className="sm:col-span-2">
              <Input
                value={brief.industry}
                onChange={e => set('industry', e.target.value)}
                placeholder="e.g. Commercial HVAC service, Pet insurance, Restaurant POS…"
              />
            </Field>
            <Field label="Geographic market">
              <Input
                value={brief.geography}
                onChange={e => set('geography', e.target.value)}
                placeholder="United States"
              />
            </Field>
            <Field label="Potential customer">
              <Input
                value={brief.customer}
                onChange={e => set('customer', e.target.value)}
                placeholder="Owner-operators, SMBs…"
              />
            </Field>
            <Field label="Potential business model">
              <Input
                value={brief.businessModel}
                onChange={e => set('businessModel', e.target.value)}
                placeholder="Open to any model"
              />
            </Field>
            <Field label="Available starting capital">
              <Input
                value={brief.startingCapital}
                onChange={e => set('startingCapital', e.target.value)}
                placeholder="$25,000"
              />
            </Field>
            <Field label="Time to first revenue">
              <Input
                value={brief.timeToFirstRevenue}
                onChange={e => set('timeToFirstRevenue', e.target.value)}
                placeholder="90 days"
              />
            </Field>
            <Field label="Time to meaningful profit">
              <Input
                value={brief.timeToProfit}
                onChange={e => set('timeToProfit', e.target.value)}
                placeholder="12 months"
              />
            </Field>
            <Field label="Risk tolerance">
              <Select
                value={brief.riskTolerance ?? ''}
                onValueChange={v => set('riskTolerance', v as ResearchBriefInput['riskTolerance'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Moderate" />
                </SelectTrigger>
                <SelectContent>
                  {RISK.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Additional constraints or advantages" className="sm:col-span-2">
              <Textarea
                value={brief.constraints}
                onChange={e => set('constraints', e.target.value)}
                placeholder="Existing call center, carrier relationships, offshore team, licenses…"
                rows={3}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Team capabilities */}
        <Card>
          <CardHeader>
            <CardTitle>Team capabilities</CardTitle>
            <CardDescription>
              Select everything that applies; add custom capabilities freely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CapabilityPicker
              categories={config?.capabilities}
              selected={brief.capabilities}
              onChange={next => set('capabilities', next)}
            />
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Save these as a reusable team profile…"
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={saveProfile}
                disabled={savingProfile || !profileName.trim() || brief.capabilities.length === 0}
              >
                <Save className="mr-1 h-4 w-4" /> Save profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Research mode */}
        <Card>
          <CardHeader>
            <CardTitle>Research depth</CardTitle>
            <CardDescription>
              Deeper modes use more providers, take longer, and cost more.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {config?.modes.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => set('mode', m.id as ResearchMode)}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  brief.mode === m.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 ${
                    brief.mode === m.id ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                  }`}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {m.expectedRuntimeMin[0]}–{m.expectedRuntimeMin[1]} min
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Advanced controls */}
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => setAdvancedOpen(o => !o)}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Advanced controls</CardTitle>
                <CardDescription>
                  Budget, runtime, source targets, domains, and output.
                </CardDescription>
              </div>
              <ChevronDown
                className={`h-5 w-5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </CardHeader>
          {advancedOpen && (
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Maximum budget (USD)">
                <Input
                  type="number"
                  min={1}
                  value={brief.maxBudgetUsd}
                  onChange={e => set('maxBudgetUsd', Number(e.target.value))}
                />
              </Field>
              <Field label="Maximum runtime (minutes)">
                <Input
                  type="number"
                  min={1}
                  value={brief.maxRuntimeMin ?? ''}
                  onChange={e =>
                    set('maxRuntimeMin', e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder={modeDef ? String(modeDef.expectedRuntimeMin[1]) : ''}
                />
              </Field>
              <Field label="Minimum sources">
                <Input
                  type="number"
                  min={1}
                  value={brief.minSources ?? ''}
                  onChange={e =>
                    set('minSources', e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder={modeDef ? String(modeDef.sourceTargets.totalSources) : ''}
                />
              </Field>
              <Field label="Output detail">
                <Select
                  value={brief.outputDetail ?? 'detailed'}
                  onValueChange={v => set('outputDetail', v as ResearchBriefInput['outputDetail'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="detailed">Detailed</SelectItem>
                    <SelectItem value="exhaustive">Exhaustive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Preferred / required domains (comma-separated)"
                className="sm:col-span-2"
              >
                <Input
                  value={(brief.includeDomains ?? []).join(', ')}
                  onChange={e => set('includeDomains', splitCsv(e.target.value))}
                  placeholder="sec.gov, g2.com"
                />
              </Field>
              <Field label="Excluded domains (comma-separated)" className="sm:col-span-2">
                <Input
                  value={(brief.excludeDomains ?? []).join(', ')}
                  onChange={e => set('excludeDomains', splitCsv(e.target.value))}
                  placeholder="pinterest.com"
                />
              </Field>
              <div className="sm:col-span-2 grid gap-2">
                <ToggleRow
                  label="Include social / practitioner evidence"
                  value={!!brief.includeSocial}
                  onChange={v => set('includeSocial', v)}
                />
                <ToggleRow
                  label="Include legal / regulatory analysis"
                  value={!!brief.includeLegal}
                  onChange={v => set('includeLegal', v)}
                />
                <ToggleRow
                  label="Include technology / AI opportunities"
                  value={!!brief.includeTech}
                  onChange={v => set('includeTech', v)}
                />
                <ToggleRow
                  label="Include acquisition targets"
                  value={!!brief.includeAcquisitions}
                  onChange={v => set('includeAcquisitions', v)}
                />
                <ToggleRow
                  label="Include first-customer & 90-day plans"
                  value={!!brief.includeFirstCustomerPlan}
                  onChange={v => set('includeFirstCustomerPlan', v)}
                />
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Right: pre-run review (sticky) */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Telescope className="h-5 w-5 text-primary" /> Pre-run review
            </CardTitle>
            <CardDescription>Confirm scope before launching.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Review label="Industry" value={brief.industry || '—'} />
            <Review label="Market" value={brief.geography || 'United States (assumed)'} />
            <Review label="Mode" value={modeDef?.label ?? brief.mode} />

            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Estimated cost
              </div>
              {estimate ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold">
                    ${estimate.lowUsd.toFixed(2)}–${estimate.highUsd.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">{estimate.currency}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Calculating…</span>
              )}
              {budgetWarning && (
                <div className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                  <AlertTriangle className="h-3 w-3" /> High estimate exceeds your $
                  {brief.maxBudgetUsd} cap.
                </div>
              )}
            </div>

            {assignments && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Providers
                </div>
                <div className="space-y-1">
                  {(Object.entries(assignments) as Array<[string, string]>)
                    .filter(([role]) => modeDef?.roles.includes(role as never))
                    .map(([role, provider]) => {
                      const p = config?.providers.find(x => x.id === provider);
                      const configured = Boolean(p?.enabled && p?.hasKey);
                      return (
                        <div key={role} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {config?.roleLabels[role as never] ?? role}
                          </span>
                          <Badge
                            variant={configured ? 'secondary' : 'destructive'}
                            className="text-[10px]"
                            title={p?.model}
                          >
                            {provider}
                            {p?.model ? ` · ${p.model}` : ''}
                          </Badge>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {assumptions.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assumptions ({assumptions.length})
                </div>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {assumptions.map(a => (
                    <li key={a}>• {a}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              className="w-full"
              onClick={submit}
              disabled={
                submitting || brief.industry.trim().length < 2 || missingProviders.length > 0
              }
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Telescope className="mr-2 h-4 w-4" />
              )}
              Start research
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Runs as a durable background job. You can leave this page.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function splitCsv(v: string): string[] {
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
