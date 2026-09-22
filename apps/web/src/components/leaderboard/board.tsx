'use client';

import { CalendarCheck2, Flame, Info, Trophy } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Ledger, count, dollars, duration, pct } from '@/components/delivery/ledger';
import { cn } from '@/lib/utils';

import { Movement, Streak } from './podium';
import type { BadgeDefinition, Leaderboard, LeaderboardRow } from './types';

/**
 * The board itself: every agent, ranked, with what the rank was earned on.
 *
 * ── Em dashes, never zeroes ──────────────────────────────────────────────────
 *
 * A conversion rate with no opportunities behind it, an agent whose payroll
 * hours were never recorded: em dashes. The server sends nulls for exactly
 * these and this renders them as absences. A fabricated 0% is worse than a
 * blank here, because sorting on it puts the people who were off sick below the
 * people who failed.
 *
 * ── The agency line is the thing rows are read against ───────────────────────
 *
 * Each conversion cell carries a bar drawn against the AGENCY's own rate for
 * the same period, not against the best agent's. "Above or below the floor
 * average" is the coaching question; "how far behind the best closer" is a
 * different one, and answering the second in the space reserved for the first
 * makes a good agent on a strong team look like a problem.
 */

function badgeById(badges: BadgeDefinition[]): Map<string, BadgeDefinition> {
  return new Map(badges.map(badge => [badge.id, badge]));
}

function Badges({
  ids,
  definitions,
}: {
  ids: string[];
  definitions: Map<string, BadgeDefinition>;
}): JSX.Element | null {
  if (ids.length === 0) return null;
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {ids
        .filter(id => id !== 'ON_FIRE') // shown as the flame, next to the streak
        .map(id => {
          const badge = definitions.get(id);
          if (!badge) return null;
          return (
            <span
              key={id}
              title={badge.rule}
              className="rounded-control border border-rule bg-surface px-1.5 py-0.5 t-meta text-ink-2"
            >
              {badge.label}
            </span>
          );
        })}
    </span>
  );
}

/**
 * A conversion rate with the agency's own rate marked on it.
 *
 * The bar is scaled against the agency rate rather than against 100%, because
 * at the rates this business actually runs at -- single digits to low twenties
 * -- a bar out of 100 is a sliver for everybody and distinguishes nobody.
 */
function ConversionCell({
  value,
  agency,
}: {
  value: number | null;
  agency: number | null;
}): JSX.Element {
  if (value === null) return <span className="text-ink-3">—</span>;

  const reference = agency && agency > 0 ? agency : null;
  // Full width at twice the agency rate, so the agency line sits at the middle
  // and "ahead" and "behind" are legible at a glance.
  const width = reference ? Math.min(100, (value / (reference * 2)) * 100) : Math.min(100, value);
  const ahead = reference !== null && value >= reference;

  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1 w-12 shrink-0 overflow-hidden rounded-full bg-rule md:block">
        <span
          className={cn('block h-full rounded-full', ahead ? 'bg-live' : 'bg-ringing')}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={cn(ahead ? 'text-live-ink' : 'text-ink')}>{pct(value, 1)}</span>
    </span>
  );
}

export interface BoardProps {
  data: Leaderboard;
  /** The signed-in agent, so their own row stands out in forty. */
  viewerId: string | null;
}

export function Board({ data, viewerId }: BoardProps): JSX.Element {
  const definitions = React.useMemo(() => badgeById(data.scoring.badges), [data.scoring.badges]);
  const agencyConversion = data.agency.conversionPct;

  if (data.rows.length === 0) {
    return (
      <div className="py-12 text-center t-body text-ink-3">
        No calls, dials or applications in this period.
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-auto">
      <Ledger>
        <thead>
          <tr>
            <th className="w-12">#</th>
            <th>Agent</th>
            <th
              className="num"
              title="Points earned this period. Hover a row's total to see it broken down."
            >
              Points
            </th>
            <th className="num" title="Inbound calls this agent answered">
              In
            </th>
            <th
              className="num"
              title="Distinct callers behind those calls — the conversion denominator"
            >
              Unique
            </th>
            <th className="num" title="Outbound calls this agent placed">
              Out
            </th>
            <th className="num" title="Outbound calls that connected">
              Conn
            </th>
            <th className="num" title="Applications submitted this period">
              Apps
            </th>
            <th className="num" title="Applications as a share of UNIQUE inbound callers">
              Conversion
            </th>
            <th
              className="num"
              title="Applications as a share of every delivered call. This is the figure the agency is priced on."
            >
              Closing
            </th>
            <th className="num" title="Annualized premium written this period">
              Premium
            </th>
            <th className="num" title="Connected talk time on inbound calls">
              Talk
            </th>
            <th className="num" title="Consecutive days with business written, as of today">
              Streak
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const you = row.userId !== null && row.userId === viewerId;
            return (
              <tr
                key={row.userId ?? 'unattributed'}
                className={cn(
                  you && 'bg-brand-tint',
                  /*
                   * Delivered calls with no agent recorded. Not a person,
                   * nobody can be coached or congratulated on it, and it is
                   * here only so the rows reconcile with the agency totals
                   * above — so it reads quieter than the people.
                   */
                  row.userId === null && 'text-ink-3'
                )}
              >
                <td className="align-middle">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono tabular text-ink-2">{row.rank ?? '—'}</span>
                    {row.userId ? <Movement movement={row.movement} /> : null}
                  </span>
                </td>

                <td className="max-w-[22rem]">
                  <span className="flex min-w-0 items-center">
                    {row.userId ? (
                      /*
                       * The drill-down. A board that shows a conversion rate
                       * with no way to reach the calls behind it raises "why
                       * is this agent at 4%" and cannot answer it. The window
                       * travels with the link, so the two screens cannot
                       * disagree about the number the click started from.
                       */
                      <Link
                        href={`/calls?agentId=${encodeURIComponent(row.userId)}&from=${
                          data.period.from
                        }&to=${data.period.to}`}
                        className="truncate font-medium text-ink underline decoration-dotted underline-offset-4 hover:decoration-solid"
                        title={`Every call ${row.name} took in this window`}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium">{row.name}</span>
                    )}
                    {you ? <span className="ml-1.5 t-meta text-brand-ink">you</span> : null}
                    <Badges ids={row.badges} definitions={definitions} />
                  </span>
                </td>

                <td
                  className="num"
                  title={
                    row.userId
                      ? [
                          `${count(row.pointsBreakdown.applications)} from applications`,
                          `${count(row.pointsBreakdown.uniqueCallers)} from callers worked`,
                          `${count(row.pointsBreakdown.outboundConnects)} from outbound connects`,
                          `${count(row.pointsBreakdown.talkTime)} from talk time`,
                          `${count(row.pointsBreakdown.conversionBonus)} conversion bonus`,
                        ].join('\n')
                      : undefined
                  }
                >
                  {count(row.points)}
                </td>

                <td className="num">{count(row.inboundCalls)}</td>
                <td className="num">{count(row.uniqueInboundCallers)}</td>
                <td className="num">{count(row.outboundCalls)}</td>
                <td
                  className="num"
                  title={
                    row.outboundConnectPct === null
                      ? undefined
                      : `${pct(row.outboundConnectPct, 1)} of dials connected`
                  }
                >
                  {count(row.outboundConnected)}
                </td>
                <td className="num font-medium">{count(row.applications)}</td>
                <td className="num">
                  <ConversionCell value={row.conversionPct} agency={agencyConversion} />
                </td>
                <td className="num text-ink-2">{pct(row.closingPct, 1)}</td>
                <td className="num text-money-ink">{dollars(row.annualizedPremium)}</td>
                <td className="num text-ink-2">{duration(row.talkTimeSeconds)}</td>
                <td className="num">
                  {row.streakDays > 0 ? (
                    <Streak days={row.streakDays} />
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Ledger>
    </div>
  );
}

/**
 * The records strip: the two things on the board anybody can still beat.
 *
 * Bounded to the server's lookback rather than all time, deliberately. A record
 * set two years ago by somebody who has left is not something the current floor
 * can chase, and a scoreboard nobody can move has stopped being a game.
 */
export function Records({ data }: { data: Leaderboard }): JSX.Element | null {
  const { bestDay, longestStreak } = data.records;
  if (!bestDay && !longestStreak) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {bestDay ? (
        <span className="flex items-center gap-1.5 t-body text-ink-2">
          <Trophy className="h-3.5 w-3.5 text-ink-3" aria-hidden />
          <span className="t-label text-ink-3">Best day</span>
          <span className="font-medium text-ink">{bestDay.name}</span>
          <span className="font-mono tabular text-ink">{count(bestDay.applications)}</span>
          <span className="t-meta text-ink-3">applications on {bestDay.day}</span>
        </span>
      ) : null}

      {longestStreak ? (
        <span className="flex items-center gap-1.5 t-body text-ink-2">
          <Flame className="h-3.5 w-3.5 text-ringing-ink" aria-hidden />
          <span className="t-label text-ink-3">Longest streak</span>
          <span className="font-medium text-ink">{longestStreak.name}</span>
          <span className="font-mono tabular text-ink">{longestStreak.days}</span>
          <span className="t-meta text-ink-3">days running</span>
        </span>
      ) : null}

      <span className="t-meta text-ink-3">last {data.scoring.lookbackDays} days</span>
    </div>
  );
}

/**
 * How the score is arrived at, rendered from the server's own constants.
 *
 * Not hard-coded here on purpose. A board people are ranked on with an
 * unexplained number is a board they stop believing, and a formula the screen
 * restates from memory is one that goes stale the first time the weights are
 * tuned. These are the values the server actually scored with, for this
 * response.
 */
export function ScoringNote({ data }: { data: Leaderboard }): JSX.Element {
  const { points, badges, streakBadgeDays } = data.scoring;

  return (
    <details className="group rounded-card border border-rule bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 t-label text-ink-3 hover:text-ink">
        <Info className="h-3.5 w-3.5" aria-hidden />
        How points and badges work
      </summary>

      <div className="border-t border-rule px-3 py-3 t-body text-ink-2">
        <p className="mb-2 t-meta text-ink-3">
          Points rank the board. They price nothing: no rate, invoice or payment anywhere in this
          product is computed from them.
        </p>

        <ul className="mb-3 space-y-0.5">
          <li>
            <span className="font-mono tabular text-ink">+{points.perApplication}</span> per
            application submitted
          </li>
          <li>
            <span className="font-mono tabular text-ink">+{points.perUniqueCaller}</span> per unique
            inbound caller worked
          </li>
          <li>
            <span className="font-mono tabular text-ink">+{points.perOutboundConnect}</span> per
            outbound call connected
          </li>
          <li>
            <span className="font-mono tabular text-ink">+{points.perTenMinutesTalk}</span> per ten
            minutes of connected talk time
          </li>
          <li>
            <span className="font-mono tabular text-ink">+{points.perConversionPoint}</span> per
            point of conversion rate — only once you have worked {points.conversionBonusMinCallers}{' '}
            unique callers, so one lucky call does not take the top spot
          </li>
        </ul>

        <p className="mb-1 t-label text-ink-3">Badges</p>
        <ul className="space-y-0.5">
          {badges.map(badge => (
            <li key={badge.id}>
              <span className="font-medium text-ink">{badge.label}</span>
              <span className="text-ink-3"> — {badge.rule}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-start gap-1.5 t-meta text-ink-3">
          <CalendarCheck2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />A streak counts
          consecutive days with at least one application, as of today. Today being empty does not
          break it — the day is not over. {streakBadgeDays} days or more lights the flame.
        </p>
      </div>
    </details>
  );
}

/** The agent's own standing, pulled out of forty rows. */
export function YourStanding({
  data,
  rows,
}: {
  data: Leaderboard;
  rows: LeaderboardRow[];
}): JSX.Element | null {
  const you = data.you;
  if (!you) return null;

  if (!you.row) {
    return (
      <div className="rounded-card border border-rule bg-surface px-3 py-2 t-body text-ink-3">
        You have no calls, dials or applications in this period.
      </div>
    );
  }

  /*
   * The gap to the rank above, which is the only number on this strip that
   * asks the reader to do something. Null at the top of the board, where the
   * honest thing to say is "first" and nothing else.
   */
  const above = rows.find(
    row => row.rank !== null && you.rank !== null && row.rank === you.rank - 1
  );
  const gap = above ? above.points - you.row.points : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-brand bg-brand-tint px-3 py-2">
      <span className="flex items-baseline gap-1.5">
        <span className="t-label text-brand-ink">Your rank</span>
        <span className="font-mono tabular t-figure text-ink">{you.rank ?? '—'}</span>
        <span className="t-meta text-ink-3">of {rows.filter(row => row.rank !== null).length}</span>
      </span>

      <span className="flex items-baseline gap-1.5">
        <span className="t-label text-ink-3">Points</span>
        <span className="font-mono tabular t-figure text-ink">{count(you.row.points)}</span>
      </span>

      <span className="flex items-center gap-1.5">
        <span className="t-label text-ink-3">Since {data.previousPeriod.label.toLowerCase()}</span>
        <Movement movement={you.row.movement} />
      </span>

      {you.row.streakDays > 0 ? (
        <span className="flex items-center gap-1.5">
          <span className="t-label text-ink-3">Streak</span>
          <Streak days={you.row.streakDays} />
        </span>
      ) : null}

      {you.row.personalBest ? (
        <span className="flex items-baseline gap-1.5">
          <span className="t-label text-ink-3">Your best day</span>
          <span className="font-mono tabular text-ink">
            {count(you.row.personalBest.applications)}
          </span>
          <span className="t-meta text-ink-3">on {you.row.personalBest.day}</span>
        </span>
      ) : null}

      {gap !== null && gap > 0 ? (
        <span className="t-meta text-ink-2">
          <span className="font-mono tabular text-ink">{count(gap)}</span> points behind{' '}
          {above?.name}
        </span>
      ) : you.rank === 1 ? (
        <span className="t-meta text-brand-ink">Top of the board.</span>
      ) : null}
    </div>
  );
}
