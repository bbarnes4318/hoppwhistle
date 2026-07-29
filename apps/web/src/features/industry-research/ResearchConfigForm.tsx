'use client';

import {
  CAPABILITY_CATEGORIES,
  type CostEstimate,
  type ModeDefinition,
  type ProviderAssignments,
  type ResearchBriefInput,
  type ResearchMode,
  type TeamProfileSummary,
} from '@hopwhistle/shared';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Gauge,
  Loader2,
  Save,
  Sparkles,
  Telescope,
  Wand2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { researchApi, type ResearchConfig } from './api';
import { CapabilityPicker } from './CapabilityPicker';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

// Human labels for each research depth — provider/model names deliberately hidden.
const MODE_COPY: Record<ResearchMode, { tagline: string; body: string; recommended?: boolean }> = {
  rapid_scan: {
    tagline: 'Fast initial assessment',
    body: 'Best for quickly deciding whether a market deserves deeper investigation.',
  },
  full_due_diligence: {
    tagline: 'The complete decision',
    body: 'Independent market research, operator intelligence, economics, risks, opportunities, and cross-checked verification — everything you need to decide.',
    recommended: true,
  },
  forensic_max: {
    tagline: 'Maximum investigation',
    body: 'For major commitments, investments, or highly regulated markets. The deepest possible research with mandatory adjudication.',
  },
};

const INDUSTRY_EXAMPLES = [
  'Commercial HVAC service',
  'Mobile car detailing',
  'Pet insurance',
  'Restaurant POS software',
  'Residential solar installation',
];
const GEO_SUGGESTIONS = [
  'United States',
  'Austin, Texas, USA',
  'Southern California, USA',
  'United Kingdom',
  'Canada',
  'Australia',
];

// Best-effort natural-language → capability detection (bidirectional word match).
// The user always edits the result, so this only needs to be helpful, not perfect.
function detectCapabilities(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const textWords = new Set(t.split(/[^a-z0-9]+/).filter(w => w.length >= 4));
  const hits = new Set<string>();
  for (const cat of CAPABILITY_CATEGORIES) {
    for (const item of cat.items) {
      const label = item.label.toLowerCase();
      if (t.includes(` ${label} `)) {
        hits.add(item.id);
        continue;
      }
      const labelWords = label.split(/[^a-z0-9]+/).filter(w => w.length >= 4);
      const overlap = labelWords.some(
        lw => textWords.has(lw) || [...textWords].some(tw => lw.includes(tw) || tw.includes(lw))
      );
      if (overlap) hits.add(item.id);
    }
  }
  return [...hits];
}

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
  maxBudgetUsd: 7,
  includeSocial: true,
  includeLegal: true,
  includeTech: true,
  includeAcquisitions: false,
  includeFirstCustomerPlan: true,
  outputDetail: 'detailed',
  currency: 'USD',
  language: 'English',
};

const STEPS = ['The opportunity', 'Your advantages', 'Research depth', 'Review & launch'];

export function ResearchConfigForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [config, setConfig] = useState<ResearchConfig | null>(null);
  const [brief, setBrief] = useState<ResearchBriefInput>(emptyBrief);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [assignments, setAssignments] = useState<ProviderAssignments | null>(null);
  const [step, setStep] = useState(0);
  const [nlText, setNlText] = useState('');
  const [profiles, setProfiles] = useState<TeamProfileSummary[]>([]);
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    researchApi
      .listProfiles()
      .then(setProfiles)
      .catch(() => undefined);
  }, [toast]);

  // Re-estimate when the depth changes; keep a mode-appropriate default budget
  // unless the user has explicitly set one.
  useEffect(() => {
    let active = true;
    researchApi
      .estimate(brief.mode)
      .then(r => {
        if (!active) return;
        setEstimate(r.estimate);
        setAssignments(r.assignments);
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

  // Mode-specific default caps: Rapid $1.50, Full DD $7, Forensic requires explicit.
  const setMode = (mode: ResearchMode) => {
    setBrief(b => {
      const next = { ...b, mode };
      if (!budgetTouched) {
        next.maxBudgetUsd = mode === 'rapid_scan' ? 1.5 : mode === 'full_due_diligence' ? 7 : 0;
      }
      return next;
    });
  };

  const forensicNeedsBudget = brief.mode === 'forensic_max' && !(brief.maxBudgetUsd > 0);

  // Expected (mid-weighted) range vs the hard authorized maximum.
  const expected = useMemo(() => {
    if (!estimate) return null;
    const lo = estimate.lowUsd;
    const hi = estimate.highUsd;
    const mid = (lo + hi) / 2;
    return { low: Math.max(lo, mid * 0.75), high: Math.min(hi, mid * 1.15) };
  }, [estimate]);

  const missingProviders = useMemo(() => {
    if (!config || !modeDef || !assignments) return [] as string[];
    const byId = new Map(config.providers.map(p => [p.id, p]));
    const out: string[] = [];
    for (const role of modeDef.roles) {
      const providerId = (assignments as Record<string, string>)[role];
      const p = byId.get(providerId);
      if (!p || !p.enabled || !p.hasKey) out.push(role);
    }
    return out;
  }, [config, modeDef, assignments]);

  const applyNl = () => {
    const detected = detectCapabilities(nlText);
    if (detected.length === 0) {
      toast({
        title: 'Nothing detected yet',
        description: 'Try naming skills, assets, or industries you know. You can also pick below.',
      });
      return;
    }
    const merged = Array.from(new Set([...brief.capabilities, ...detected]));
    set('capabilities', merged);
    toast({ title: `Added ${detected.length} capabilities`, description: 'Edit them below.' });
  };

  const loadProfile = (p: TeamProfileSummary) => {
    set('capabilities', Array.from(new Set([...brief.capabilities, ...p.capabilities])));
    toast({ title: `Loaded "${p.name}"` });
  };

  const saveProfile = async () => {
    if (!profileName.trim() || brief.capabilities.length === 0) return;
    setSavingProfile(true);
    try {
      const p = await researchApi.saveProfile(profileName.trim(), brief.capabilities);
      setProfiles(prev => [p, ...prev]);
      toast({ title: 'Team profile saved' });
      setProfileName('');
    } catch (e) {
      toast({ title: 'Failed to save profile', description: String(e), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const submit = async () => {
    if (brief.industry.trim().length < 2) {
      setStep(0);
      toast({ title: 'Tell us the market first', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await researchApi.createRun(brief);
      toast({ title: 'Investigation started', description: 'Building your evidence now.' });
      router.push(`/tools/industry-research/${res.id}`);
    } catch (e) {
      toast({
        title: 'Could not start',
        description: String(e),
        variant: 'destructive',
      });
      setSubmitting(false);
    }
  };

  const canNext =
    step === 0 ? brief.industry.trim().length >= 2 : step === 2 ? !forensicNeedsBudget : true;

  return (
    <div className="ir-form-workspace mx-auto max-w-3xl">
      <Stepper step={step} onJump={setStep} industryDone={brief.industry.trim().length >= 2} />

      {missingProviders.length > 0 && step >= 2 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive flex-shrink-0">
          This depth can’t run yet — the research engines aren’t fully configured. An administrator
          needs to finish setup before you launch.
        </div>
      )}

      {/* STEP 1 — The opportunity */}
      {step === 0 && (
        <StepCard
          title="What market are you considering?"
          subtitle="Name the industry or business you’re thinking about entering."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-sm font-medium">Market or Industry</Label>
              <Input
                autoFocus
                value={brief.industry}
                onChange={e => set('industry', e.target.value)}
                placeholder="e.g. Mobile car detailing"
                className="h-10 text-sm"
                aria-label="Market or industry"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {INDUSTRY_EXAMPLES.map(ex => (
                  <Chip key={ex} onClick={() => set('industry', ex)}>
                    {ex}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-sm font-medium">
                Where do you want to operate?
              </Label>
              <Input
                value={brief.geography}
                onChange={e => set('geography', e.target.value)}
                placeholder="United States"
                className="h-10 text-sm"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {GEO_SUGGESTIONS.slice(0, 3).map(g => (
                  <Chip key={g} onClick={() => set('geography', g)}>
                    {g}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="sm:col-span-3">
              <FieldBlock
                label="Who is your target customer?"
                hint="Optional — leave blank and we’ll identify likely customer segments."
              >
                <Input
                  value={brief.customer}
                  onChange={e => set('customer', e.target.value)}
                  placeholder="e.g. Busy suburban homeowners"
                  className="h-10 text-sm"
                />
              </FieldBlock>
            </div>
          </div>
        </StepCard>
      )}

      {/* STEP 2 — Your advantages */}
      {step === 1 && (
        <StepCard
          title="What can you bring to this market?"
          subtitle="Your skills, experience, assets, or relationships. This shapes the entry strategy."
        >
          <FieldBlock
            label="Describe it in your own words"
            hint="We’ll turn this into capabilities you can edit."
          >
            <Textarea
              value={nlText}
              onChange={e => setNlText(e.target.value)}
              rows={3}
              placeholder="e.g. We’re full-stack developers, strong with AI, own a call center, and have insurance and telephony experience."
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={applyNl}
              disabled={!nlText.trim()}
            >
              <Wand2 className="mr-1.5 h-4 w-4" /> Detect capabilities
            </Button>
          </FieldBlock>

          {profiles.length > 0 && (
            <FieldBlock label="Reuse a saved team profile">
              <div className="flex flex-wrap gap-1.5">
                {profiles.slice(0, 6).map(p => (
                  <Chip key={p.id} onClick={() => loadProfile(p)}>
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    {p.name}
                  </Chip>
                ))}
              </div>
            </FieldBlock>
          )}

          <div className="ir-capability-picker-wrapper">
            <CapabilityPicker
              categories={config?.capabilities}
              selected={brief.capabilities}
              onChange={next => set('capabilities', next)}
            />
          </div>

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
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          </div>
        </StepCard>
      )}

      {/* STEP 3 — Research depth */}
      {step === 2 && (
        <StepCard
          title="How deep should we investigate?"
          subtitle="Deeper research takes longer and costs more. You can start with a quick scan and go deeper later."
        >
          <div role="radiogroup" aria-label="Research depth" className="grid gap-3 sm:grid-cols-3">
            {config?.modes.map(m => {
              const copy = MODE_COPY[m.id as ResearchMode];
              const active = brief.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(m.id as ResearchMode)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex flex-col h-full justify-between',
                    active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 flex-shrink-0',
                          active ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                        )}
                      >
                        {active && <Check className="h-2 w-2 text-primary-foreground" />}
                      </span>
                      <span className="text-sm font-semibold leading-tight">{m.label}</span>
                      {copy?.recommended && (
                        <Badge className="text-[8px] px-1 py-0 uppercase tracking-wide">Rec</Badge>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <div className="text-xs font-semibold leading-tight text-foreground">
                        {copy?.tagline}
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {copy?.body}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                    Est. runtime: {m.expectedRuntimeMin[0]}–{m.expectedRuntimeMin[1]} min
                  </div>
                </button>
              );
            })}
          </div>

          {forensicNeedsBudget && (
            <FieldBlock
              label="Set a maximum budget for Forensic depth"
              hint="Forensic has no default cap — choose the most you want to authorize."
            >
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  min={1}
                  value={brief.maxBudgetUsd || ''}
                  onChange={e => {
                    setBudgetTouched(true);
                    set('maxBudgetUsd', Number(e.target.value));
                  }}
                  className="max-w-[140px]"
                  placeholder="15"
                />
              </div>
            </FieldBlock>
          )}
        </StepCard>
      )}

      {/* STEP 4 — Review & launch */}
      {step === 3 && (
        <StepCard
          title="Review and launch"
          subtitle="Confirm the scope. You can leave this page — the investigation runs in the background."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="rounded-xl border border-border">
                <ReviewRow label="Market" value={brief.industry || '—'} onEdit={() => setStep(0)} />
                <ReviewRow
                  label="Where"
                  value={brief.geography || 'United States (assumed)'}
                  onEdit={() => setStep(0)}
                />
                <ReviewRow
                  label="Your advantages"
                  value={
                    brief.capabilities.length
                      ? `${brief.capabilities.length} selected`
                      : 'Generalist (assumed)'
                  }
                  onEdit={() => setStep(1)}
                />
                <ReviewRow
                  label="Depth"
                  value={modeDef?.label ?? brief.mode}
                  onEdit={() => setStep(2)}
                />
              </div>

              {/* Customize (advanced) — hidden by default */}
              <div className="rounded-xl border border-border">
                <button
                  type="button"
                  aria-expanded={customizeOpen}
                  onClick={() => setCustomizeOpen(o => !o)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Customize research
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      customizeOpen && 'rotate-180'
                    )}
                  />
                </button>
                {customizeOpen && <Advanced brief={brief} set={set} modeDef={modeDef} />}
              </div>
            </div>

            <div className="space-y-3">
              {/* Cost — expected vs authorized, never one number for both */}
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Gauge className="h-3.5 w-3.5 text-primary" /> Cost
                </div>
                <div className="mt-2 grid gap-2 grid-cols-2">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Expected
                    </div>
                    <div className="text-sm font-semibold">
                      {expected ? `$${expected.low.toFixed(2)}–$${expected.high.toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Maximum authorized
                    </div>
                    <div className="flex items-center gap-1 text-sm font-semibold">
                      <span className="text-muted-foreground">$</span>
                      <input
                        type="number"
                        min={1}
                        value={brief.maxBudgetUsd || ''}
                        onChange={e => {
                          setBudgetTouched(true);
                          set('maxBudgetUsd', Number(e.target.value));
                        }}
                        className="w-16 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs"
                        aria-label="Maximum authorized budget"
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] leading-normal text-muted-foreground">
                  We stop before exceeding your maximum. If the report needs a repair pass, we pause
                  to ask.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
                <div className="mb-1 font-semibold">Your report will include</div>
                <p className="text-muted-foreground leading-normal">
                  A clear GO/NO ENTER verdict, the best entry opportunity, real economics, key
                  arguments, competitors, risks, first-customer plan, and a 90-day roadmap.
                </p>
              </div>
            </div>
          </div>
        </StepCard>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        {step < 3 ? (
          <Button type="button" onClick={() => setStep(s => s + 1)} disabled={!canNext}>
            Continue <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            onClick={submit}
            disabled={submitting || missingProviders.length > 0 || forensicNeedsBudget}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Telescope className="mr-2 h-4 w-4" />
            )}
            Start investigation
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({
  step,
  onJump,
  industryDone,
}: {
  step: number;
  onJump: (s: number) => void;
  industryDone: boolean;
}) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        const reachable = i === 0 || industryDone;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => reachable && onJump(i)}
              disabled={!reachable}
              className={cn(
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <span
              className={cn(
                'hidden text-xs font-medium sm:inline',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{value}</span>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-primary hover:underline"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function Advanced({
  brief,
  set,
  modeDef,
}: {
  brief: ResearchBriefInput;
  set: <K extends keyof ResearchBriefInput>(k: K, v: ResearchBriefInput[K]) => void;
  modeDef?: ModeDefinition;
}) {
  return (
    <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
      <FieldBlock label="Maximum runtime (minutes)">
        <Input
          type="number"
          min={1}
          value={brief.maxRuntimeMin ?? ''}
          onChange={e => set('maxRuntimeMin', e.target.value ? Number(e.target.value) : undefined)}
          placeholder={modeDef ? String(modeDef.expectedRuntimeMin[1]) : ''}
        />
      </FieldBlock>
      <FieldBlock label="Minimum sources">
        <Input
          type="number"
          min={1}
          value={brief.minSources ?? ''}
          onChange={e => set('minSources', e.target.value ? Number(e.target.value) : undefined)}
          placeholder={modeDef ? String(modeDef.sourceTargets.totalSources) : ''}
        />
      </FieldBlock>
      <FieldBlock label="Business model (optional)">
        <Input
          value={brief.businessModel}
          onChange={e => set('businessModel', e.target.value)}
          placeholder="Open to any model"
        />
      </FieldBlock>
      <FieldBlock label="Starting capital (optional)">
        <Input
          value={brief.startingCapital}
          onChange={e => set('startingCapital', e.target.value)}
          placeholder="$25,000"
        />
      </FieldBlock>
      <FieldBlock label="Risk tolerance">
        <Select
          value={brief.riskTolerance ?? ''}
          onValueChange={v => set('riskTolerance', v as ResearchBriefInput['riskTolerance'])}
        >
          <SelectTrigger>
            <SelectValue placeholder="Moderate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </FieldBlock>
      <FieldBlock label="Output detail">
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
      </FieldBlock>
      <FieldBlock label="Preferred domains (comma-separated)">
        <Input
          value={(brief.includeDomains ?? []).join(', ')}
          onChange={e => set('includeDomains', splitCsv(e.target.value))}
          placeholder="sec.gov, g2.com"
        />
      </FieldBlock>
      <FieldBlock label="Excluded domains (comma-separated)">
        <Input
          value={(brief.excludeDomains ?? []).join(', ')}
          onChange={e => set('excludeDomains', splitCsv(e.target.value))}
          placeholder="pinterest.com"
        />
      </FieldBlock>
      <div className="sm:col-span-2 grid gap-2">
        <ToggleRow
          label="Operator & customer intelligence (web + social)"
          value={!!brief.includeSocial}
          onChange={v => set('includeSocial', v)}
        />
        <ToggleRow
          label="Legal / regulatory analysis"
          value={!!brief.includeLegal}
          onChange={v => set('includeLegal', v)}
        />
        <ToggleRow
          label="Technology / AI opportunities"
          value={!!brief.includeTech}
          onChange={v => set('includeTech', v)}
        />
        <ToggleRow
          label="First-customer & 90-day plans"
          value={!!brief.includeFirstCustomerPlan}
          onChange={v => set('includeFirstCustomerPlan', v)}
        />
      </div>
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
      <Switch checked={value} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function splitCsv(v: string): string[] {
  return v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
