'use client';

import { Award, Flame, Medal, Minus, Trophy, TrendingDown, TrendingUp } from 'lucide-react';
import * as React from 'react';

import { count, dollars, pct } from '@/components/delivery/ledger';
import { cn } from '@/lib/utils';

import type { LeaderboardRow } from './types';

/**
 * The top of the board.
 *
 * ── Rank is shown with size and shape, not with invented colour ──────────────
 *
 * The obvious thing to build here is gold, silver and bronze. This does not,
 * because the design system's colours all MEAN something already -- `--live` is
 * a connected call, `--ringing` is a ringing one, `--dropped` is a failure --
 * and spending them on decoration is how a palette stops being readable. A
 * bronze that is actually the colour of a dropped call would put the third-best
 * closer on the floor in the same ink as an error.
 *
 * So first place is larger, carries the brand accent (which is an emphasis
 * colour, not a state one) and gets a trophy; second and third step down
 * through the ink hierarchy with their own icons. The ranking reads instantly
 * and nothing here has to borrow a meaning from somewhere else.
 */

const PLACES = [
  { icon: Trophy, label: 'First' },
  { icon: Medal, label: 'Second' },
  { icon: Award, label: 'Third' },
] as const;

export function Movement({ movement }: { movement: number | null }): JSX.Element {
  if (movement === null) {
    /*
     * Not ranked in the previous period: a new starter, or somebody who was
     * away. An invented "up 12 places!" is the kind of fabricated
     * encouragement that teaches people the board is decorative.
     */
    return <span className="t-meta text-ink-3">new</span>;
  }
  if (movement === 0) {
    return (
      <span className="flex items-center gap-0.5 t-meta text-ink-3">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const up = movement > 0;
  return (
    <span
      className={cn('flex items-center gap-0.5 t-meta', up ? 'text-live-ink' : 'text-dropped-ink')}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(movement)} place${
        Math.abs(movement) === 1 ? '' : 's'
      } since the previous period`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(movement)}
    </span>
  );
}

export function Streak({ days }: { days: number }): JSX.Element | null {
  if (days <= 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-control bg-ringing-tint px-1.5 py-0.5 t-meta text-ringing-ink"
      title={`Business written on ${days} consecutive day${days === 1 ? '' : 's'}, as of today`}
    >
      <Flame className="h-3 w-3" />
      {days}
    </span>
  );
}

export function Podium({ rows }: { rows: LeaderboardRow[] }): JSX.Element | null {
  // Only people. The unattributed row is not somebody who can stand on a
  // podium, and it is held out of the ranking upstream for the same reason.
  const top = rows.filter(row => row.userId !== null && row.rank !== null).slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {top.map((row, index) => {
        const place = PLACES[index] ?? PLACES[2];
        const Icon = place.icon;
        const first = index === 0;

        return (
          <div
            key={row.userId ?? index}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-card border p-3',
              first ? 'border-brand bg-brand-tint sm:-mt-1 sm:pb-4' : 'border-rule bg-surface'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon
                  className={cn('h-4 w-4 shrink-0', first ? 'text-brand-ink' : 'text-ink-3')}
                  aria-hidden
                />
                <span className={cn('t-label', first ? 'text-brand-ink' : 'text-ink-3')}>
                  {place.label}
                </span>
              </div>
              <Movement movement={row.movement} />
            </div>

            <div
              className={cn(
                'min-w-0 truncate font-medium text-ink',
                first ? 't-section' : 't-body'
              )}
              title={row.name}
            >
              {row.name}
            </div>

            <div className={cn('tabular-nums text-ink', first ? 't-hero' : 't-figure')}>
              {count(row.points)}
              <span className="ml-1 t-meta text-ink-3">pts</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-meta text-ink-3">
              <span>
                <span className="text-ink-2">{count(row.applications)}</span> apps
              </span>
              <span>
                <span className="text-ink-2">{pct(row.conversionPct, 1)}</span> conv
              </span>
              <span className="text-money-ink">{dollars(row.annualizedPremium)}</span>
              <Streak days={row.streakDays} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
