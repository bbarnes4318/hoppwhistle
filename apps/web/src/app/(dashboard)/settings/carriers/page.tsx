'use client';

/**
 * Carrier Routing settings.
 *
 * One waterfall per call type. Each waterfall is an ordered list of carriers:
 * FreeSWITCH dials them top to bottom and stops at the first one that connects,
 * so moving a carrier up or switching one off changes where calls actually go —
 * on the next call, with no deploy and no restart.
 *
 * The "Now dialing" line under each waterfall is the authority. It is what the
 * server would return for a call placed right now, health included, so a
 * carrier that has been demoted for failing shows up there rather than only in
 * the configured order above it.
 */

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  PhoneForwarded,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CompactPageShell, CompactPageHeader } from '@/components/layout/compact-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';

interface GatewayView {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  numberFormat: string;
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureCause: string | null;
  lastSuccessAt: string | null;
  totalAttempts: number;
  totalFailures: number;
}

interface StepView {
  stepId: string | null;
  carrierId: string;
  carrierCode: string;
  carrierName: string;
  carrierStatus: string;
  position: number;
  enabled: boolean;
  callerIdStrategy: string;
  callerIdCount: number;
  callerIdUnattestable: boolean;
  gateways: GatewayView[];
}

interface RouteView {
  callType: string;
  label: string;
  enabled: boolean;
  legTimeoutSeconds: number;
  steps: StepView[];
  effectiveChain: string[];
  effectiveSource: 'db' | 'fallback';
}

interface Overview {
  routes: RouteView[];
  carriers: Array<{ id: string; code: string; name: string; status: string }>;
  callTypes: Array<{ value: string; label: string }>;
}

/** Groups the six waterfalls the way an operator thinks about them. */
const SECTIONS: Array<{ title: string; description: string; callTypes: string[] }> = [
  {
    title: 'Inbound',
    description: 'Every inbound call, including PSTN forwarding legs out to buyers.',
    callTypes: ['INBOUND'],
  },
  {
    title: 'Outbound',
    description:
      'Each outbound path carries its own waterfall, so a carrier can be pulled from the dialers without touching agent softphones.',
    callTypes: [
      'CC_MANUAL',
      'CC_POWER_DIALER',
      'SOFTPHONE_MANUAL',
      'PREDICTIVE_DIALER',
      'DOGRAH_AI',
    ],
  },
];

export default function CarrierRoutingPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<Overview>('/api/v1/carrier-routing/overview');
      if (res.error) {
        setError(res.error.message || 'Failed to load carrier routing');
      } else if (res.data) {
        setOverview(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carrier routing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Persist a waterfall. The carrier list is always sent whole and in order —
   * the server treats it as a replacement, which is what keeps two admins
   * editing during an outage from producing two carriers at position 0.
   */
  const saveRoute = async (callType: string, steps: StepView[], enabled?: boolean) => {
    setSavingType(callType);
    try {
      const res = await apiClient.put<{ effectiveChain: string[]; carrierOrder: string[] }>(
        `/api/v1/carrier-routing/routes/${callType}`,
        {
          ...(enabled === undefined ? {} : { enabled }),
          carriers: steps.map(s => ({ carrierId: s.carrierId, enabled: s.enabled })),
        }
      );
      if (res.error) {
        toast({
          variant: 'destructive',
          title: 'Not saved',
          description: res.error.message || 'Failed to update carrier order',
        });
        return;
      }
      toast({
        title: 'Carrier order updated',
        description: `Now dialing: ${res.data?.carrierOrder?.join(' → ') || 'unchanged'}`,
      });
      await load();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Not saved',
        description: err instanceof Error ? err.message : 'Failed to update carrier order',
      });
    } finally {
      setSavingType(null);
    }
  };

  const move = (route: RouteView, index: number, delta: number) => {
    const next = [...route.steps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void saveRoute(route.callType, next);
  };

  const toggleStep = (route: RouteView, index: number, enabled: boolean) => {
    const next = route.steps.map((s, i) => (i === index ? { ...s, enabled } : s));
    void saveRoute(route.callType, next);
  };

  const resetGatewayHealth = async (gatewayId: string, name: string) => {
    const res = await apiClient.post(
      `/api/v1/carrier-routing/gateways/${gatewayId}/reset-health`,
      {}
    );
    if (res.error) {
      toast({
        variant: 'destructive',
        title: 'Not reset',
        description: res.error.message || 'Failed to clear gateway health',
      });
      return;
    }
    toast({ title: `${name} restored`, description: 'Failure count cleared and rank restored.' });
    await load();
  };

  if (loading) {
    return (
      <CompactPageShell fullHeight={false}>
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading carrier routing…
        </div>
      </CompactPageShell>
    );
  }

  const routeByType = new Map((overview?.routes ?? []).map(r => [r.callType, r]));

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Carrier Routing"
        subtitle="Set the order carriers are tried for each kind of call. Changes take effect on the next call."
      >
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Refresh
        </Button>
      </CompactPageHeader>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {SECTIONS.map(section => (
        <div key={section.title} className="mb-6">
          <h2 className="text-sm font-semibold tracking-tight">{section.title}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{section.description}</p>

          <div className="space-y-3">
            {section.callTypes.map(callType => {
              const route = routeByType.get(callType);
              if (!route) return null;
              return (
                <WaterfallCard
                  key={callType}
                  route={route}
                  saving={savingType === callType}
                  onMove={(i, d) => move(route, i, d)}
                  onToggleStep={(i, v) => toggleStep(route, i, v)}
                  onResetGateway={resetGatewayHealth}
                />
              );
            })}
          </div>
        </div>
      ))}
    </CompactPageShell>
  );
}

function WaterfallCard({
  route,
  saving,
  onMove,
  onToggleStep,
  onResetGateway,
}: {
  route: RouteView;
  saving: boolean;
  onMove: (index: number, delta: number) => void;
  onToggleStep: (index: number, enabled: boolean) => void;
  onResetGateway: (gatewayId: string, name: string) => Promise<void>;
}) {
  const activeCount = route.steps.filter(s => s.enabled && s.gateways.some(g => g.enabled)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{route.label}</CardTitle>
            <CardDescription className="text-xs">
              Tried top to bottom. The first carrier that connects wins.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {activeCount === 0 ? (
              <Badge variant="destructive" className="text-[10px]">
                No carrier enabled
              </Badge>
            ) : activeCount === 1 ? (
              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-500">
                No fallback
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-emerald-500/50 text-emerald-500">
                {activeCount} carriers
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {activeCount === 1 && (
          <Alert className="border-amber-500/40 py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-xs">
              Only one carrier is enabled for this path. If it stops connecting calls, these calls
              stop. Enable a second carrier below to give it somewhere to fall.
            </AlertDescription>
          </Alert>
        )}

        {route.callType !== 'INBOUND' &&
          route.steps.some(s => s.enabled && s.callerIdUnattestable) && (
            <Alert className="border-amber-500/40 py-2">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs">
                <strong>
                  {route.steps
                    .filter(s => s.enabled && s.callerIdUnattestable)
                    .map(s => s.carrierName)
                    .join(', ')}
                </strong>{' '}
                {route.steps.filter(s => s.enabled && s.callerIdUnattestable).length === 1
                  ? 'has'
                  : 'have'}{' '}
                no DIDs of their own, so calls falling to them present a number they did not issue.
                A carrier cannot attest to someone else&apos;s number — expect low STIR/SHAKEN
                attestation and spam labeling on those legs. Port or buy numbers there to fix it.
              </AlertDescription>
            </Alert>
          )}

        <div className="divide-y divide-border/40 rounded border border-border/40">
          {route.steps.map((step, index) => {
            const enabledGateways = step.gateways.filter(g => g.enabled);
            const demoted = enabledGateways.filter(g => g.circuitOpen);
            return (
              <div key={step.carrierId} className="flex items-center gap-3 px-3 py-2">
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-5"
                    disabled={index === 0 || saving}
                    onClick={() => onMove(index, -1)}
                    aria-label={`Move ${step.carrierName} up`}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-5"
                    disabled={index === route.steps.length - 1 || saving}
                    onClick={() => onMove(index, 1)}
                    aria-label={`Move ${step.carrierName} down`}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>

                <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {index === 0 ? 'Primary' : `Backup ${index}`}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">{step.carrierName}</span>
                    {step.carrierStatus === 'INACTIVE' && (
                      <Badge variant="secondary" className="text-[10px]">
                        Carrier inactive
                      </Badge>
                    )}
                    {demoted.length > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {demoted.length} demoted
                      </Badge>
                    )}
                    {/* A carrier can only vouch for a number it issued. One that
                        presents someone else's gets low attestation, which is
                        the mechanism behind spam labeling — so it is called out
                        here rather than left to be discovered from call data. */}
                    {step.callerIdUnattestable ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/60 text-[10px] text-amber-500"
                        title={`No DIDs are registered to ${step.carrierName}, so calls on this leg present a number it did not issue and cannot attest to. Expect low STIR/SHAKEN attestation and spam labeling. Buy or port numbers to ${step.carrierName} to fix.`}
                      >
                        no caller ID of its own
                      </Badge>
                    ) : step.callerIdStrategy === 'POOL' ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/50 text-[10px] text-emerald-500"
                        title={`Presents one of ${step.callerIdCount} DIDs registered to ${step.carrierName}, so it can attest to the call.`}
                      >
                        {step.callerIdCount} own DIDs
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {step.gateways.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        No gateways configured — this carrier will be skipped
                      </span>
                    ) : (
                      step.gateways.map(g => (
                        <GatewayChip key={g.id} gateway={g} onReset={onResetGateway} />
                      ))
                    )}
                  </div>
                </div>

                <Switch
                  checked={step.enabled}
                  disabled={saving}
                  onCheckedChange={v => onToggleStep(index, v)}
                  aria-label={`Enable ${step.carrierName}`}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-start gap-2 rounded bg-muted/40 px-3 py-2">
          <PhoneForwarded className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Now dialing, in this order
            </p>
            <p className="break-all font-mono text-[11px]">
              {route.effectiveChain.join(' → ') || '(nothing)'}
            </p>
            {route.effectiveSource === 'fallback' && (
              <p className="mt-1 text-[10px] text-amber-500">
                This is the built-in emergency chain, not your configuration — no enabled carrier
                with a working gateway was found for this path.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GatewayChip({
  gateway,
  onReset,
}: {
  gateway: GatewayView;
  onReset: (gatewayId: string, name: string) => Promise<void>;
}) {
  const failureRate =
    gateway.totalAttempts > 0
      ? Math.round((gateway.totalFailures / gateway.totalAttempts) * 100)
      : null;

  const title = [
    `${gateway.name} (${gateway.numberFormat})`,
    gateway.circuitOpen
      ? `Demoted until ${new Date(gateway.circuitOpenUntil ?? '').toLocaleTimeString()}`
      : null,
    gateway.consecutiveFailures > 0
      ? `${gateway.consecutiveFailures} consecutive carrier faults`
      : null,
    gateway.lastFailureCause ? `Last fault: ${gateway.lastFailureCause}` : null,
    failureRate !== null ? `${failureRate}% of ${gateway.totalAttempts} attempts failed` : null,
    gateway.lastSuccessAt
      ? `Last success: ${new Date(gateway.lastSuccessAt).toLocaleString()}`
      : 'No successful call recorded',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span
      title={title}
      className={[
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
        !gateway.enabled
          ? 'border-border/40 text-muted-foreground line-through'
          : gateway.circuitOpen
            ? 'border-red-500/50 text-red-400'
            : 'border-border/60',
      ].join(' ')}
    >
      {gateway.circuitOpen ? (
        <AlertTriangle className="h-2.5 w-2.5" />
      ) : gateway.lastSuccessAt ? (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
      ) : null}
      {gateway.name}
      {gateway.circuitOpen && (
        <button
          type="button"
          className="ml-0.5 underline decoration-dotted"
          onClick={() => void onReset(gateway.id, gateway.name)}
        >
          restore
        </button>
      )}
    </span>
  );
}
