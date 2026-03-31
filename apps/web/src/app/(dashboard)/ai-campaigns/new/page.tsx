'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  HeartPulse,
  Loader2,
  Megaphone,
  Phone,
  Radio,
  Shield,
  Sparkles,
  Wifi,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ============================================================================
// Types
// ============================================================================

interface PhoneNumber {
  id: string;
  number: string;
  displayName: string | null;
}

type Vertical = 'ACA' | 'FINAL_EXPENSE';
type VoipCarrier = 'bulkvs' | 'signalwire';
type WizardStep = 'vertical' | 'config' | 'filters';

interface FilterConfig {
  [key: string]: boolean;
}

interface VerticalFilter {
  key: string;
  label: string;
  description: string;
  locked: boolean;
  defaultValue: boolean;
}

const VERTICAL_FILTERS: Record<Vertical, VerticalFilter[]> = {
  ACA: [
    {
      key: 'under_65',
      label: 'Under 65 Years Old',
      description: 'Automatically disqualify prospects over 64 (Medicare eligible)',
      locked: true,
      defaultValue: true,
    },
    {
      key: 'no_medicare_medicaid',
      label: 'No Medicare / Medicaid / Tricare',
      description: 'Disqualify prospects with existing government coverage',
      locked: true,
      defaultValue: true,
    },
    {
      key: 'no_marketplace',
      label: 'No Existing Marketplace Plan',
      description: 'Ask if they have an active Marketplace plan — disqualify if yes',
      locked: false,
      defaultValue: false,
    },
    {
      key: 'active_bank',
      label: 'Active Bank Account Required',
      description: 'Verify the prospect has an active checking or savings account',
      locked: false,
      defaultValue: false,
    },
  ],
  FINAL_EXPENSE: [
    {
      key: 'under_80',
      label: 'Under 80 Years Old',
      description: 'Automatically disqualify prospects over 79',
      locked: true,
      defaultValue: true,
    },
    {
      key: 'no_alzheimers',
      label: 'No Alzheimer&apos;s / Dementia',
      description: 'Disqualify prospects diagnosed with Alzheimer&apos;s or dementia',
      locked: false,
      defaultValue: false,
    },
    {
      key: 'not_nursing_home',
      label: 'Not in Nursing Home',
      description: 'Disqualify prospects residing in a nursing home or care facility',
      locked: false,
      defaultValue: false,
    },
    {
      key: 'active_bank',
      label: 'Active Bank Account Required',
      description: 'Verify the prospect has an active checking or savings account',
      locked: false,
      defaultValue: false,
    },
  ],
};

const VERTICAL_INFO: Record<
  Vertical,
  { name: string; description: string; icon: typeof HeartPulse; color: string }
> = {
  ACA: {
    name: 'ACA Health',
    description: 'Marketplace health plan verification & enrollment transfers',
    icon: HeartPulse,
    color: 'from-emerald-500 to-teal-600',
  },
  FINAL_EXPENSE: {
    name: 'Final Expense',
    description: 'Burial & final expense insurance qualification transfers',
    icon: Shield,
    color: 'from-violet-500 to-purple-600',
  },
};

const CARRIER_INFO: Record<
  VoipCarrier,
  { name: string; description: string; badge: string }
> = {
  bulkvs: {
    name: 'BulkVS / FreeSWITCH',
    description: 'Routes through FreeSWITCH with BulkVS STIR/SHAKEN signing → DIDCentral/FracTEL',
    badge: 'Current Default',
  },
  signalwire: {
    name: 'SignalWire',
    description: 'Direct SIP trunk via SignalWire — no external signing needed',
    badge: 'New',
  },
};

// ============================================================================
// Wizard Component
// ============================================================================

export default function NewCampaignPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('vertical');
  const [loading, setLoading] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);

  // Campaign data
  const [vertical, setVertical] = useState<Vertical | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [transferNumber, setTransferNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [carrier, setCarrier] = useState<VoipCarrier>('bulkvs');
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [callsPerMinute, setCallsPerMinute] = useState(10);
  const [filters, setFilters] = useState<FilterConfig>({});

  // Fetch phone numbers
  useEffect(() => {
    const fetchPhoneNumbers = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/phone-numbers`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setPhoneNumbers(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch phone numbers:', err);
      }
    };
    void fetchPhoneNumbers();
  }, []);

  // Initialize filters when vertical is selected
  useEffect(() => {
    if (!vertical) return;
    const verticalFilters = VERTICAL_FILTERS[vertical];
    const defaultFilters: FilterConfig = {};
    for (const f of verticalFilters) {
      defaultFilters[f.key] = f.defaultValue;
    }
    setFilters(defaultFilters);
  }, [vertical]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleVerticalSelect = (v: Vertical) => {
    setVertical(v);
    setStep('config');
  };

  const handleConfigNext = () => {
    if (!campaignName.trim()) {
      toast({ title: 'Campaign name is required', variant: 'destructive' });
      return;
    }
    if (!agencyName.trim()) {
      toast({ title: 'Agency name is required', variant: 'destructive' });
      return;
    }
    if (!transferNumber.trim()) {
      toast({ title: 'Transfer number is required', variant: 'destructive' });
      return;
    }
    if (!phoneNumberId) {
      toast({ title: 'Please select a caller ID number', variant: 'destructive' });
      return;
    }
    setStep('filters');
  };

  const handleFilterToggle = (key: string) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const formatTransferNumber = (value: string) => {
    // Strip non-digits
    const digits = value.replace(/\D/g, '');
    // Format as E.164
    if (digits.length <= 1) return digits ? `+${digits}` : '';
    if (digits.length <= 4) return `+${digits}`;
    if (digits.length <= 7)
      return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  };

  const getE164 = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  };

  const handleSubmit = async () => {
    if (!vertical) return;

    setLoading(true);
    try {
      const payload = {
        name: campaignName,
        vertical,
        direction: 'OUTBOUND',
        carrier,
        agencyName,
        transferNumber: getE164(transferNumber),
        filters,
        phoneNumberId,
        maxConcurrent,
        callsPerMinute,
      };

      const res = await fetch(`${API_URL}/api/v1/ai-campaigns`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create campaign');
      }

      const { data } = await res.json();

      toast({
        title: 'Campaign Created',
        description: 'Your AI campaign has been provisioned and is ready for contacts.',
      });

      router.push(`/ai-campaigns/${data.id}`);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to create campaign',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // ========================================================================
  // Step Indicator
  // ========================================================================

  const steps: { key: WizardStep; label: string }[] = [
    { key: 'vertical', label: 'Vertical' },
    { key: 'config', label: 'Configuration' },
    { key: 'filters', label: 'Filters' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (step === 'config') setStep('vertical');
            else if (step === 'filters') setStep('config');
            else router.push('/ai-campaigns');
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New AI Campaign</h1>
          <p className="text-sm text-muted-foreground">Template-based campaign wizard</p>
        </div>
      </div>

      {/* Step Progress */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                i < currentStepIndex
                  ? 'bg-primary text-primary-foreground'
                  : i === currentStepIndex
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < currentStepIndex ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={`text-sm font-medium hidden sm:inline ${
                i === currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px ${i < currentStepIndex ? 'bg-primary' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ================================================================ */}
      {/* Step 1: Vertical Selection */}
      {/* ================================================================ */}
      {step === 'vertical' && (
        <div className="space-y-4">
          <div className="text-center mb-6">
            <Sparkles className="h-10 w-10 mx-auto text-primary mb-3" />
            <h2 className="text-xl font-semibold">Choose Your Vertical</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Select the type of campaign. Each vertical has a pre-built script optimized for
              conversions.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(Object.entries(VERTICAL_INFO) as [Vertical, typeof VERTICAL_INFO.ACA][]).map(
              ([key, info]) => {
                const Icon = info.icon;
                return (
                  <Card
                    key={key}
                    className={`cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg border-2 ${
                      vertical === key
                        ? 'border-primary shadow-lg'
                        : 'border-transparent hover:border-primary/30'
                    }`}
                    onClick={() => handleVerticalSelect(key)}
                  >
                    <CardHeader className="pb-3">
                      <div
                        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${info.color} flex items-center justify-center mb-3`}
                      >
                        <Icon className="h-6 w-6 text-white" />
                      </div>
                      <CardTitle className="text-lg">{info.name}</CardTitle>
                      <CardDescription>{info.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-xs text-muted-foreground">
                        {VERTICAL_FILTERS[key].filter(f => f.locked).length} mandatory filters
                        {' · '}
                        {VERTICAL_FILTERS[key].filter(f => !f.locked).length} optional filters
                      </div>
                    </CardContent>
                  </Card>
                );
              }
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Step 2: Configuration */}
      {/* ================================================================ */}
      {step === 'config' && vertical && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                Campaign Configuration
              </CardTitle>
              <CardDescription>
                Configure the key details for your {VERTICAL_INFO[vertical].name} campaign
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Campaign Name */}
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Campaign Name *</Label>
                <Input
                  id="campaign-name"
                  placeholder="e.g., ACA Spring 2026 Push"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Agency Name */}
              <div className="space-y-2">
                <Label htmlFor="agency-name">Agency Name *</Label>
                <Input
                  id="agency-name"
                  placeholder="e.g., National Health Advisors"
                  value={agencyName}
                  onChange={e => setAgencyName(e.target.value)}
                  maxLength={100}
                />
                <p className="text-xs text-muted-foreground">
                  This name will be used by the AI during the call.
                </p>
              </div>

              {/* Transfer Number */}
              <div className="space-y-2">
                <Label htmlFor="transfer-number">Transfer Number *</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="transfer-number"
                    className="pl-9"
                    placeholder="+1 (555) 123-4567"
                    value={transferNumber}
                    onChange={e => setTransferNumber(formatTransferNumber(e.target.value))}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Qualified leads will be live-transferred to this number.
                </p>
              </div>

              {/* Phone Number (Caller ID) */}
              <div className="space-y-2">
                <Label htmlFor="phone-number">Caller ID Number *</Label>
                <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
                  <SelectTrigger id="phone-number">
                    <SelectValue placeholder="Select a phone number" />
                  </SelectTrigger>
                  <SelectContent>
                    {phoneNumbers.map(pn => (
                      <SelectItem key={pn.id} value={pn.id}>
                        {pn.number}
                        {pn.displayName ? ` - ${pn.displayName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The number that will appear on the recipient&apos;s caller ID.
                </p>
              </div>

              {/* Concurrency & Rate */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label>Max Concurrent Calls: {maxConcurrent}</Label>
                  <Slider
                    value={[maxConcurrent]}
                    onValueChange={([v]) => setMaxConcurrent(v)}
                    min={1}
                    max={10}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">Simultaneous calls at any time</p>
                </div>
                <div className="space-y-3">
                  <Label>Rate Limit: {callsPerMinute}/min</Label>
                  <Slider
                    value={[callsPerMinute]}
                    onValueChange={([v]) => setCallsPerMinute(v)}
                    min={1}
                    max={60}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">Maximum new calls per minute</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* VOIP Carrier Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wifi className="h-5 w-5" />
                VOIP Carrier
              </CardTitle>
              <CardDescription>
                Select which carrier will handle the outbound SIP traffic for this campaign
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(Object.entries(CARRIER_INFO) as [VoipCarrier, typeof CARRIER_INFO.bulkvs][]).map(
                  ([key, info]) => (
                    <div
                      key={key}
                      className={`relative cursor-pointer p-4 rounded-lg border-2 transition-all ${
                        carrier === key
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border hover:border-primary/30'
                      }`}
                      onClick={() => setCarrier(key)}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            carrier === key
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground/40'
                          }`}
                        >
                          {carrier === key && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{info.name}</span>
                            <span
                              className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                key === 'signalwire'
                                  ? 'bg-emerald-500/10 text-emerald-600'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {info.badge}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleConfigNext} size="lg">
              Continue to Filters
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Step 3: Filters */}
      {/* ================================================================ */}
      {step === 'filters' && vertical && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Qualification Filters
              </CardTitle>
              <CardDescription>
                These filters are built into the AI script. Locked filters are mandatory compliance
                requirements and cannot be disabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {VERTICAL_FILTERS[vertical].map(filter => (
                <div
                  key={filter.key}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                    filter.locked
                      ? 'bg-primary/5 border-primary/20'
                      : filters[filter.key]
                        ? 'bg-muted/50 border-border'
                        : 'border-border'
                  }`}
                >
                  <div className="space-y-0.5 flex-1 mr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{filter.label}</span>
                      {filter.locked && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{filter.description}</p>
                  </div>
                  <Switch
                    checked={filter.locked ? true : !!filters[filter.key]}
                    disabled={filter.locked}
                    onCheckedChange={() => {
                      if (!filter.locked) handleFilterToggle(filter.key);
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaign Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-muted-foreground">Vertical</div>
                <div className="font-medium">{VERTICAL_INFO[vertical].name}</div>

                <div className="text-muted-foreground">Campaign</div>
                <div className="font-medium">{campaignName}</div>

                <div className="text-muted-foreground">Agency</div>
                <div className="font-medium">{agencyName}</div>

                <div className="text-muted-foreground">Transfer To</div>
                <div className="font-medium">{transferNumber}</div>

                <div className="text-muted-foreground">Active Filters</div>
                <div className="font-medium">
                  {Object.values(filters).filter(Boolean).length} enabled
                </div>

                <div className="text-muted-foreground">VOIP Carrier</div>
                <div className="font-medium flex items-center gap-1.5">
                  {carrier === 'signalwire' ? (
                    <Radio className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Radio className="h-3.5 w-3.5" />
                  )}
                  {CARRIER_INFO[carrier].name}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('config')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Provisioning…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Create Campaign
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
