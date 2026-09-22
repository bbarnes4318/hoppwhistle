/**
 * The game layer: points, ranks, movement, streaks and badges.
 *
 * ── What is being protected ──────────────────────────────────────────────────
 *
 * A leaderboard is read by the people it ranks, daily, and every one of them
 * can check it against their own day. So the failures that matter are the ones
 * that make it unarguable rather than the ones that make it crash:
 *
 *   - A rate computed from nothing. An agent who took no calls did not convert
 *     at 0%; they were not measured. A column of fabricated zeroes sorts the
 *     people who were off sick below the people who failed.
 *   - A top spot bought with one lucky call. The conversion bonus has a volume
 *     floor precisely so that 1-for-1 does not beat 4-for-60.
 *   - An order that changes when nothing changed. Ties are broken
 *     deterministically or the board is something people screenshot and argue
 *     about.
 *   - A streak that breaks every morning. Today is not over; an empty today
 *     must not end a nine-day chain at 09:00.
 *   - A badge nobody earned. "Most applications: 0" on a quiet Sunday devalues
 *     the one that was earned on Monday, and a tie awards nobody.
 */

import { describe, expect, it } from 'vitest';

import {
  awardBadges,
  conversionPctOf,
  movementOf,
  POINTS,
  rankRows,
  scoreOf,
  STREAK_BADGE_DAYS,
  streakOf,
} from '../services/leaderboard/scoring.js';

/* ── Conversion ────────────────────────────────────────────────────────────── */

describe('the conversion rate', () => {
  it('is applications over unique callers', () => {
    expect(conversionPctOf(3, 12)).toBeCloseTo(25);
  });

  it('is null with no opportunities behind it, never 0%', () => {
    expect(conversionPctOf(0, 0)).toBeNull();
  });

  it('is 0 when there were opportunities and nothing closed', () => {
    // A real measurement, and a different fact from "not measured".
    expect(conversionPctOf(0, 40)).toBe(0);
  });
});

/* ── Points ────────────────────────────────────────────────────────────────── */

describe('the score', () => {
  it('adds up exactly as the formula served to the client says', () => {
    const breakdown = scoreOf({
      applications: 4,
      uniqueInboundCallers: 40,
      outboundConnected: 25,
      talkTimeSeconds: 7_500, // 12 whole ten-minute blocks
      conversionPct: 10,
    });

    expect(breakdown.applications).toBe(4 * POINTS.perApplication);
    expect(breakdown.uniqueCallers).toBe(40 * POINTS.perUniqueCaller);
    expect(breakdown.outboundConnects).toBe(25 * POINTS.perOutboundConnect);
    expect(breakdown.talkTime).toBe(12 * POINTS.perTenMinutesTalk);
    expect(breakdown.conversionBonus).toBe(10 * POINTS.perConversionPoint);

    expect(breakdown.total).toBe(
      breakdown.applications +
        breakdown.uniqueCallers +
        breakdown.outboundConnects +
        breakdown.talkTime +
        breakdown.conversionBonus
    );
  });

  it('counts only whole ten-minute blocks of talk time', () => {
    // Nine minutes is not a block. Rounding it up would let an agent who
    // answered and hung up repeatedly out-score one who stayed on the phone.
    expect(scoreOf(base({ talkTimeSeconds: 540 })).talkTime).toBe(0);
    expect(scoreOf(base({ talkTimeSeconds: 600 })).talkTime).toBe(POINTS.perTenMinutesTalk);
    expect(scoreOf(base({ talkTimeSeconds: 1_199 })).talkTime).toBe(POINTS.perTenMinutesTalk);
  });

  it('withholds the conversion bonus below the volume floor', () => {
    const lucky = scoreOf({
      applications: 1,
      uniqueInboundCallers: 1,
      outboundConnected: 0,
      talkTimeSeconds: 0,
      conversionPct: 100,
    });

    // One call, one close, 100% -- and no bonus, because one opportunity is
    // not a rate. Without the floor this is +500 points for ten minutes' work.
    expect(lucky.conversionBonus).toBe(0);
  });

  it('pays the bonus at the floor exactly', () => {
    const atFloor = scoreOf({
      applications: 1,
      uniqueInboundCallers: POINTS.conversionBonusMinCallers,
      outboundConnected: 0,
      talkTimeSeconds: 0,
      conversionPct: conversionPctOf(1, POINTS.conversionBonusMinCallers),
    });
    expect(atFloor.conversionBonus).toBeGreaterThan(0);
  });

  it('gives a steady closer the board over a one-call wonder', () => {
    const steady = scoreOf({
      applications: 4,
      uniqueInboundCallers: 60,
      outboundConnected: 0,
      talkTimeSeconds: 0,
      conversionPct: conversionPctOf(4, 60),
    }).total;

    const wonder = scoreOf({
      applications: 1,
      uniqueInboundCallers: 1,
      outboundConnected: 0,
      talkTimeSeconds: 0,
      conversionPct: 100,
    }).total;

    expect(steady).toBeGreaterThan(wonder);
  });

  it('scores a hard day with no closes above an empty one', () => {
    // A board that pays nothing for forty worked calls is a board the agent
    // who took them stops opening.
    const worked = scoreOf({
      applications: 0,
      uniqueInboundCallers: 40,
      outboundConnected: 30,
      talkTimeSeconds: 6_000,
      conversionPct: 0,
    }).total;

    expect(worked).toBeGreaterThan(0);
  });

  it('never pays a bonus for an unmeasured rate', () => {
    expect(scoreOf(base({ conversionPct: null, uniqueInboundCallers: 50 })).conversionBonus).toBe(
      0
    );
  });
});

function base(overrides: Partial<Parameters<typeof scoreOf>[0]> = {}) {
  return {
    applications: 0,
    uniqueInboundCallers: 0,
    outboundConnected: 0,
    talkTimeSeconds: 0,
    conversionPct: null,
    ...overrides,
  };
}

/* ── Ranking ───────────────────────────────────────────────────────────────── */

function rankable(userId: string | null, points: number, applications = 0, callers = 0) {
  return {
    userId,
    points,
    applications,
    uniqueInboundCallers: callers,
    name: userId ?? 'Unattributed',
  };
}

describe('the ranking', () => {
  it('orders by points, highest first', () => {
    const ranked = rankRows([rankable('b', 200), rankable('a', 500), rankable('c', 100)]);
    expect(ranked.map(row => row.userId)).toEqual(['a', 'b', 'c']);
    expect(ranked.map(row => row.rank)).toEqual([1, 2, 3]);
  });

  it('gives equal work equal rank, and skips the next one', () => {
    // 1, 2, 2, 4 -- two agents who did exactly the same are not first and
    // second, and the person behind them is fourth, not third.
    const ranked = rankRows([
      rankable('a', 500),
      rankable('b', 300),
      rankable('c', 300),
      rankable('d', 100),
    ]);
    expect(ranked.map(row => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it('breaks ties deterministically so the order never moves on refresh', () => {
    const rows = [rankable('zoe', 300, 2, 40), rankable('adam', 300, 2, 40)];
    const once = rankRows(rows).map(row => row.userId);
    const again = rankRows([...rows].reverse()).map(row => row.userId);
    expect(once).toEqual(again);
  });

  it('prefers applications over worked callers when points tie', () => {
    const ranked = rankRows([rankable('volume', 300, 1, 100), rankable('closer', 300, 3, 10)]);
    expect(ranked[0].userId).toBe('closer');
  });

  it('holds the unattributed row at the bottom and never ranks it', () => {
    const ranked = rankRows([rankable(null, 9_999), rankable('a', 10)]);

    // It is not a person: nobody can be coached or congratulated on it, and it
    // is on the board only so the rows reconcile with the agency total.
    expect(ranked.map(row => row.userId)).toEqual(['a', null]);
    expect(ranked[1].rank).toBeNull();
  });
});

/* ── Movement ──────────────────────────────────────────────────────────────── */

describe('movement', () => {
  it('reads positive for a climb', () => {
    expect(movementOf(2, 5)).toBe(3);
    expect(movementOf(5, 2)).toBe(-3);
    expect(movementOf(3, 3)).toBe(0);
  });

  it('is null for somebody who was not ranked last period', () => {
    // A new starter has not climbed twelve places, and telling them they have
    // teaches them the board is decorative.
    expect(movementOf(4, null)).toBeNull();
    expect(movementOf(null, 4)).toBeNull();
  });
});

/* ── Streaks ───────────────────────────────────────────────────────────────── */

/** Day arithmetic on plain keys, which is all `streakOf` needs. */
function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe('the streak', () => {
  it('counts consecutive days ending today', () => {
    const days = ['2026-09-22', '2026-09-21', '2026-09-20'];
    expect(streakOf(days, '2026-09-22', dayBefore)).toBe(3);
  });

  it('survives an empty today, because today is not over', () => {
    // An agent with a nine-day chain who opens the board at 09:00 has not
    // written anything yet. Breaking the streak here shows them a loss every
    // single morning, which is the opposite of what a streak is for.
    const days = ['2026-09-21', '2026-09-20', '2026-09-19'];
    expect(streakOf(days, '2026-09-22', dayBefore)).toBe(3);
  });

  it('breaks on a gap that is behind us', () => {
    const days = ['2026-09-21', '2026-09-19', '2026-09-18'];
    expect(streakOf(days, '2026-09-22', dayBefore)).toBe(1);
  });

  it('is zero when neither today nor yesterday has business on it', () => {
    expect(streakOf(['2026-09-01'], '2026-09-22', dayBefore)).toBe(0);
    expect(streakOf([], '2026-09-22', dayBefore)).toBe(0);
  });

  it('counts today when today already has business on it', () => {
    expect(streakOf(['2026-09-22'], '2026-09-22', dayBefore)).toBe(1);
  });
});

/* ── Badges ────────────────────────────────────────────────────────────────── */

function badgeable(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    applications: 0,
    uniqueInboundCallers: 0,
    inboundCalls: 0,
    outboundConnected: 0,
    annualizedPremium: 0,
    talkTimeSeconds: 0,
    conversionPct: null as number | null,
    movement: null as number | null,
    streakDays: 0,
    ...overrides,
  };
}

describe('the badges', () => {
  it('awards each leader badge to the one agent who leads it', () => {
    const held = awardBadges([
      badgeable('a', { applications: 6, annualizedPremium: 900 }),
      badgeable('b', { applications: 2, annualizedPremium: 4_000 }),
    ]);

    expect(held.get('a')).toContain('MOST_APPLICATIONS');
    expect(held.get('b')).toContain('TOP_PREMIUM');
    expect(held.get('b')).not.toContain('MOST_APPLICATIONS');
  });

  it('awards nobody when nobody did the thing', () => {
    // "Most applications: 0" on a quiet Sunday devalues Monday's.
    const held = awardBadges([badgeable('a'), badgeable('b')]);
    expect(held.size).toBe(0);
  });

  it('awards nobody on a tie', () => {
    // Two agents on four each are not both "most applications", and a badge
    // two people hold is one neither of them mentions.
    const held = awardBadges([
      badgeable('a', { applications: 4 }),
      badgeable('b', { applications: 4 }),
    ]);
    expect(held.get('a') ?? []).not.toContain('MOST_APPLICATIONS');
    expect(held.get('b') ?? []).not.toContain('MOST_APPLICATIONS');
  });

  it('keeps Top closer away from a one-call wonder', () => {
    const held = awardBadges([
      badgeable('lucky', { conversionPct: 100, uniqueInboundCallers: 1, applications: 1 }),
      badgeable('real', {
        conversionPct: 12,
        uniqueInboundCallers: POINTS.conversionBonusMinCallers + 40,
        applications: 6,
      }),
    ]);

    expect(held.get('real')).toContain('TOP_CLOSER');
    expect(held.get('lucky') ?? []).not.toContain('TOP_CLOSER');
  });

  it('gives On fire to everyone who qualifies, not just the leader', () => {
    const held = awardBadges([
      badgeable('a', { streakDays: STREAK_BADGE_DAYS }),
      badgeable('b', { streakDays: STREAK_BADGE_DAYS + 5 }),
      badgeable('c', { streakDays: STREAK_BADGE_DAYS - 1 }),
    ]);

    expect(held.get('a')).toContain('ON_FIRE');
    expect(held.get('b')).toContain('ON_FIRE');
    expect(held.get('c') ?? []).not.toContain('ON_FIRE');
  });

  it('awards Most improved on the biggest climb, and not on a fall', () => {
    const held = awardBadges([
      badgeable('climber', { movement: 6 }),
      badgeable('steady', { movement: 1 }),
      badgeable('faller', { movement: -9 }),
    ]);

    expect(held.get('climber')).toContain('MOST_IMPROVED');
    expect(held.get('faller') ?? []).not.toContain('MOST_IMPROVED');
  });

  it('never awards a badge to the unattributed row', () => {
    const held = awardBadges([
      { ...badgeable('x'), userId: null, applications: 50, inboundCalls: 900 },
      badgeable('a', { applications: 1 }),
    ]);
    expect(held.get('a')).toContain('MOST_APPLICATIONS');
    expect([...held.keys()]).toEqual(['a']);
  });
});
