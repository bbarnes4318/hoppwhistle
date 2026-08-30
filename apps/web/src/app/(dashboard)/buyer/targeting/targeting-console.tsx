'use client';

import { Loader2, RotateCcw, Save, Target as TargetIcon } from 'lucide-react';
import * as React from 'react';

import {
  EmptyState,
  MoneyCell,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatusChip,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { updateTarget } from '../actions';

/**
 * Targeting — change what you receive, and watch the price and the volume move.
 *
 * The two figures at the top are recomputed in the browser on every toggle, off
 * a histogram the server sent with the page. That is what makes the cause and
 * the effect visible at the same time: you do not save, wait, and then find out
 * what a cap did.
 *
 * The volume figure is OBSERVED HISTORY — the last thirty days of calls,
 * re-counted under the settings currently on screen. It is not a forecast and
 * it is not a promise of future volume, and the page says so in those words
 * every time it shows the number.
 */

export interface TargetView {
  id: string;
  name: string;
  type: string;
  destination: string;
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  priority: number;
  maxCap: number;
  capPeriod: 'HOUR' | 'DAY' | 'MONTH';
  maxConcurrency: number;
  basePrice: number;
  acceptedStates: string[];
  isNational: boolean;
  pricingRuleCount: number;
  /**
   * Billable calls per cap period across the trailing thirty days, bucketed to
   * this target's own capPeriod. `Σ min(count, cap)` is what the cap would have
   * let through, which is why the cap input moves the volume figure.
   */
  periodCounts: number[];
  observedCalls: number;
  observedSpend: number;
}

interface Draft {
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  maxCap: number;
  maxConcurrency: number;
}

function volumeUnderCap(counts: number[], cap: number): number {
  if (cap <= 0) return counts.reduce((sum, n) => sum + n, 0);
  return counts.reduce((sum, n) => sum + Math.min(n, cap), 0);
}

const CAP_NOUN: Record<TargetView['capPeriod'], string> = {
  HOUR: 'per hour',
  DAY: 'per day',
  MONTH: 'per month',
};

export function TargetingConsole({
  buyerId,
  targets,
  canPause,
  canSetCaps,
  unattributedCalls,
  coverage,
}: {
  buyerId: string;
  targets: TargetView[];
  canPause: boolean;
  canSetCaps: boolean;
  unattributedCalls: number;
  coverage: string;
}) {
  const initial = React.useMemo(() => {
    const map: Record<string, Draft> = {};
    for (const t of targets) {
      map[t.id] = { status: t.status, maxCap: t.maxCap, maxConcurrency: t.maxConcurrency };
    }
    return map;
  }, [targets]);

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>(initial);
  const [saving, setSaving] = React.useState<string | null>(null);

  // A save revalidates the page, which arrives as new props; the drafts have to
  // follow the server rather than keep showing what was typed before the save.
  React.useEffect(() => setDrafts(initial), [initial]);

  const patch = (id: string, next: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...next } }));

  const enabled = targets.filter(t => drafts[t.id]?.status === 'ACTIVE');

  const perTargetVolume = enabled.map(t => ({
    target: t,
    volume: volumeUnderCap(t.periodCounts, drafts[t.id]?.maxCap ?? t.maxCap),
  }));

  const totalVolume = perTargetVolume.reduce((sum, v) => sum + v.volume, 0);
  const weightedPrice =
    totalVolume > 0
      ? perTargetVolume.reduce((sum, v) => sum + v.target.basePrice * v.volume, 0) / totalVolume
      : enabled.length > 0
        ? enabled.reduce((sum, t) => sum + t.basePrice, 0) / enabled.length
        : 0;

  const baselineVolume = targets
    .filter(t => t.status === 'ACTIVE')
    .reduce((sum, t) => sum + volumeUnderCap(t.periodCounts, t.maxCap), 0);
  const delta = totalVolume - baselineVolume;

  async function save(target: TargetView) {
    const draft = drafts[target.id];
    if (!draft) return;
    setSaving(target.id);
    const result = await updateTarget(buyerId, target.id, {
      status: draft.status === 'FAILED' ? 'INACTIVE' : draft.status,
      maxCap: draft.maxCap,
      maxConcurrency: draft.maxConcurrency,
    });
    setSaving(null);
    if (result.ok) toast.success(`Saved ${target.name}`);
    else toast.error('Could not save this target', result.error);
  }

  if (targets.length === 0) {
    return (
      <Panel>
        <PanelBody>
          <EmptyState
            size="page"
            icon={TargetIcon}
            headline="No targets configured"
            body="Targets are the destinations calls are routed to. Ask your account manager to add one and it will show up here."
          />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <PanelTitle>What these settings would have cost you</PanelTitle>
        </PanelHeader>
        <PanelBody className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <p className="t-label text-ink-3">Per-call price</p>
            <p className="t-figure mt-1.5 text-ink">
              <MoneyCell amount={weightedPrice} unit="major" size="figure" tone="money" />
            </p>
            <p className="t-meta mt-1 text-ink-3">
              {enabled.length === 0
                ? 'Every target is switched off.'
                : `Across ${enabled.length} live target${enabled.length === 1 ? '' : 's'}, weighted by observed volume.`}
            </p>
          </div>

          <div>
            <p className="t-label text-ink-3">Observed volume</p>
            <p className="t-figure mt-1.5 text-ink">{totalVolume.toLocaleString()}</p>
            <p className="t-meta mt-1 text-ink-3">
              Billable calls in the last 30 days that these settings would have let through
              {delta !== 0 ? (
                <>
                  {' — '}
                  <span className={cn(delta > 0 ? 'text-live-ink' : 'text-dropped-ink')}>
                    {delta > 0 ? '+' : ''}
                    {delta.toLocaleString()} against what is saved
                  </span>
                </>
              ) : null}
              .
            </p>
          </div>

          <div>
            <p className="t-label text-ink-3">At that price</p>
            <p className="t-figure mt-1.5 text-ink">
              <MoneyCell
                amount={weightedPrice * totalVolume}
                unit="major"
                size="figure"
                tone="money"
              />
            </p>
            <p className="t-meta mt-1 text-ink-3">
              What the same thirty days would have billed under these settings.
            </p>
          </div>
        </PanelBody>

        <div className="border-t border-rule px-4 py-3">
          <p className="t-meta text-ink-2">
            <strong className="font-medium text-ink">Observed history, not a forecast.</strong>{' '}
            These are calls that already happened, re-counted under the settings on screen. Nothing
            here predicts or guarantees the volume you will receive next month. {coverage}
            {unattributedCalls > 0
              ? ` ${unattributedCalls.toLocaleString()} call${unattributedCalls === 1 ? '' : 's'} in the window are not attributed to a target and are excluded.`
              : ''}
          </p>
        </div>
      </Panel>

      <div className="space-y-3">
        {targets.map(target => {
          const draft = drafts[target.id] ?? initial[target.id];
          const statusChanged = draft.status !== target.status;
          const limitsChanged =
            draft.maxCap !== target.maxCap || draft.maxConcurrency !== target.maxConcurrency;
          const dirty = statusChanged || limitsChanged;
          // Every control stays usable even without the permission to save,
          // because seeing what a cap would do is the reason to come here. What
          // the permission gates is the write, and the button says so.
          const blocked = (statusChanged && !canPause) || (limitsChanged && !canSetCaps);
          const volume = volumeUnderCap(target.periodCounts, draft.maxCap);
          const uncapped = volumeUnderCap(target.periodCounts, 0);

          return (
            <Panel key={target.id}>
              <PanelHeader
                action={
                  <div className="flex items-center gap-2">
                    <StatusChip
                      value={draft.status}
                      enumName="BuyerEndpointStatus"
                      size="sm"
                      label={draft.status === 'ACTIVE' ? 'Taking calls' : 'Paused'}
                    />
                    <Switch
                      checked={draft.status === 'ACTIVE'}
                      aria-label={`Take calls on ${target.name}`}
                      onCheckedChange={checked =>
                        patch(target.id, { status: checked ? 'ACTIVE' : 'INACTIVE' })
                      }
                    />
                  </div>
                }
              >
                <PanelTitle>{target.name}</PanelTitle>
                <p className="t-meta mt-0.5 truncate text-ink-3">
                  {target.type} · {target.destination} · priority {target.priority}
                </p>
              </PanelHeader>

              <PanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="t-label text-ink-3">Price per call</p>
                  <p className="t-data mt-1.5 text-ink">
                    <MoneyCell amount={target.basePrice} unit="major" />
                  </p>
                  <p className="t-meta mt-1 text-ink-3">
                    {target.pricingRuleCount > 0
                      ? `${target.pricingRuleCount} pricing rule${target.pricingRuleCount === 1 ? '' : 's'} can adjust it per call`
                      : 'Flat, no per-call adjustments'}
                  </p>
                </div>

                <div>
                  <label htmlFor={`cap-${target.id}`} className="t-label block text-ink-3">
                    Cap {CAP_NOUN[target.capPeriod]}
                  </label>
                  <Input
                    id={`cap-${target.id}`}
                    type="number"
                    min={0}
                    value={draft.maxCap}
                    onChange={e =>
                      patch(target.id, { maxCap: Math.max(0, Number(e.target.value)) })
                    }
                    className="mt-1.5 h-8 rounded-control border-rule bg-surface t-data text-ink"
                  />
                  <p className="t-meta mt-1 text-ink-3">0 means no cap</p>
                </div>

                <div>
                  <label htmlFor={`conc-${target.id}`} className="t-label block text-ink-3">
                    Concurrent calls
                  </label>
                  <Input
                    id={`conc-${target.id}`}
                    type="number"
                    min={0}
                    value={draft.maxConcurrency}
                    onChange={e =>
                      patch(target.id, { maxConcurrency: Math.max(0, Number(e.target.value)) })
                    }
                    className="mt-1.5 h-8 rounded-control border-rule bg-surface t-data text-ink"
                  />
                  <p className="t-meta mt-1 text-ink-3">
                    {target.isNational
                      ? 'Accepting every state'
                      : `${target.acceptedStates.length} state${target.acceptedStates.length === 1 ? '' : 's'} accepted`}
                  </p>
                </div>

                <div>
                  <p className="t-label text-ink-3">Observed, last 30 days</p>
                  <p className="t-data mt-1.5 text-ink">
                    {volume.toLocaleString()} billable
                    {volume < uncapped ? (
                      <span className="text-ink-3"> of {uncapped.toLocaleString()} taken</span>
                    ) : null}
                  </p>
                  <p className="t-meta mt-1 text-ink-3">
                    {target.observedCalls.toLocaleString()} call
                    {target.observedCalls === 1 ? '' : 's'} routed here, billing{' '}
                    <MoneyCell amount={target.observedSpend} unit="major" className="text-ink-3" />
                    {volume < uncapped ? ' — this cap would have turned some away' : ''}
                  </p>
                </div>
              </PanelBody>

              {dirty ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-4 py-2.5">
                  <span className="t-meta text-ink-2">
                    {blocked
                      ? 'Your account cannot save this change — the figures above still show what it would do.'
                      : 'Unsaved changes on this target.'}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDrafts(prev => ({ ...prev, [target.id]: initial[target.id] }))
                      }
                      className="gap-1.5"
                    >
                      <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                      Revert
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={blocked || saving === target.id}
                      title={blocked ? 'Ask your account manager to make this change.' : undefined}
                      onClick={() => void save(target)}
                      className="gap-1.5"
                    >
                      {saving === target.id ? (
                        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save aria-hidden className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              ) : null}
            </Panel>
          );
        })}
      </div>

      {!canPause || !canSetCaps ? (
        <p className="t-meta text-ink-3">
          {!canPause && !canSetCaps
            ? 'Your account cannot save changes to targets or caps. Every control still works, so you can see what a change would do before asking your account manager to make it.'
            : !canPause
              ? 'Your account cannot save a pause. Caps are yours to change.'
              : 'Your account cannot save a cap change. Pausing a target is yours to change.'}
        </p>
      ) : null}
    </div>
  );
}
