/**
 * The game layer: points, ranks, movement, streaks and badges.
 *
 * ── The score prices nothing ─────────────────────────────────────────────────
 *
 * Said first because this file sits one import away from the modules that set
 * an agency's rate, and the resemblance is the danger. `services/rating/` and
 * `services/billing/` measure what an agency is CHARGED. Nothing in this file
 * is read by either of them, no figure here reaches the rate curve, the credit
 * ledger or a settlement, and the points below are a RANKING DEVICE -- a way to
 * put forty agents in an order on a screen -- not a measurement of anything.
 *
 * The closing percentage is the measurement, it is defined once in
 * `services/rating/measurement.ts`, and this file does not redefine it. The
 * board carries it verbatim beside the conversion rate precisely so the two are
 * never mistaken for each other.
 *
 * ── Why the formula is in the response ───────────────────────────────────────
 *
 * `POINTS` is served to the client and rendered in the open, because a board
 * people are ranked on with an unexplained score is a board people stop
 * believing. Every weight below has a reason written next to it, and an agent
 * who wants to know why they are fourth can add it up themselves.
 *
 * ── Conversion rate is not the closing percentage ────────────────────────────
 *
 * Two different fractions, both here, deliberately named apart:
 *
 *   closing percentage   applications / delivered calls
 *                        The priced figure. Every answered inbound call is in
 *                        the denominator, including the third call from the
 *                        same person.
 *
 *   conversion rate      applications / UNIQUE inbound callers
 *                        The coaching figure, and the one the floor asked for.
 *                        A caller who rings back four times before buying was
 *                        one opportunity, not four, and an agent who works a
 *                        callback-heavy queue is not worse at their job than
 *                        one who does not.
 *
 * Conversion is always the higher of the two, by construction. They are shown
 * side by side and never derived from one another.
 */

/* ── The formula ───────────────────────────────────────────────────────────── */

/**
 * What each thing an agent does is worth.
 *
 * Weighted so that WRITING BUSINESS dominates -- one application outweighs
 * fifty worked callers -- while effort still scores, because a board that only
 * counts closes tells an agent who took forty calls and closed none that their
 * day was worth nothing, and that agent stops looking at the board.
 */
export const POINTS = {
  /** A submitted application. The thing the business is for. */
  perApplication: 100,
  /** An inbound opportunity worked. Unique callers, so a callback is not double paid. */
  perUniqueCaller: 2,
  /** An outbound dial that connected. Dials that never connect score nothing. */
  perOutboundConnect: 1,
  /** Ten minutes of connected talk time. Time on the phone, not time logged in. */
  perTenMinutesTalk: 1,
  /** Each whole point of conversion rate, above the volume floor below. */
  perConversionPoint: 5,
  /**
   * The volume floor for the conversion bonus.
   *
   * Without it the top of the board is whoever took one call and closed it:
   * 100% conversion, 500 bonus points, no work. Ten opportunities is not
   * statistical significance and is not claimed to be -- it is the point below
   * which a rate is obviously noise, and it is disclosed rather than hidden so
   * nobody has to guess why their 100% morning did not pay.
   */
  conversionBonusMinCallers: 10,
} as const;

export interface Scorable {
  applications: number;
  uniqueInboundCallers: number;
  outboundConnected: number;
  talkTimeSeconds: number;
  conversionPct: number | null;
}

export interface ScoreBreakdown {
  applications: number;
  uniqueCallers: number;
  outboundConnects: number;
  talkTime: number;
  conversionBonus: number;
  total: number;
}

/** The points an agent's period is worth, and where each one came from. */
export function scoreOf(row: Scorable): ScoreBreakdown {
  const applications = row.applications * POINTS.perApplication;
  const uniqueCallers = row.uniqueInboundCallers * POINTS.perUniqueCaller;
  const outboundConnects = row.outboundConnected * POINTS.perOutboundConnect;
  const talkTime = Math.floor(row.talkTimeSeconds / 600) * POINTS.perTenMinutesTalk;

  const qualifies =
    row.conversionPct !== null && row.uniqueInboundCallers >= POINTS.conversionBonusMinCallers;
  const conversionBonus = qualifies
    ? Math.round((row.conversionPct as number) * POINTS.perConversionPoint)
    : 0;

  return {
    applications,
    uniqueCallers,
    outboundConnects,
    talkTime,
    conversionBonus,
    total: applications + uniqueCallers + outboundConnects + talkTime + conversionBonus,
  };
}

/**
 * The conversion rate: applications over UNIQUE inbound callers.
 *
 * Null with no opportunities behind it, never 0%. An agent who took no calls
 * did not convert at zero percent; they were not measured. The whole product
 * holds this line -- see the header of `services/billing/delivery-view.ts` --
 * and a leaderboard is exactly the wrong place to break it, because a column
 * of fabricated 0% rows sorts agents who were off sick below agents who failed.
 */
export function conversionPctOf(applications: number, uniqueInboundCallers: number): number | null {
  return uniqueInboundCallers > 0 ? (applications / uniqueInboundCallers) * 100 : null;
}

/* ── Ranking ───────────────────────────────────────────────────────────────── */

export interface Rankable {
  userId: string | null;
  points: number;
  applications: number;
  uniqueInboundCallers: number;
  name: string;
}

/**
 * Rank by points, descending, with a deterministic tiebreak.
 *
 * Ties are broken by applications, then by opportunities worked, then by name
 * -- the last one purely so that two agents with identical days do not swap
 * places on every refresh. A board whose order changes when nothing changed is
 * a board people screenshot and argue about.
 *
 * Equal scores get the SAME rank, and the next rank skips accordingly (1, 2, 2,
 * 4). Two agents who did exactly the same work are not first and second.
 *
 * The unattributed row is never ranked -- see `UNATTRIBUTED` below.
 */
export function rankRows<T extends Rankable>(rows: T[]): Array<T & { rank: number | null }> {
  const people = rows.filter(row => row.userId !== null);
  const unattributed = rows.filter(row => row.userId === null);

  people.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.applications !== a.applications) return b.applications - a.applications;
    if (b.uniqueInboundCallers !== a.uniqueInboundCallers) {
      return b.uniqueInboundCallers - a.uniqueInboundCallers;
    }
    return a.name.localeCompare(b.name);
  });

  const ranked: Array<T & { rank: number | null }> = [];
  let lastPoints: number | null = null;
  let lastRank = 0;

  people.forEach((row, index) => {
    const rank = lastPoints !== null && row.points === lastPoints ? lastRank : index + 1;
    lastPoints = row.points;
    lastRank = rank;
    ranked.push({ ...row, rank });
  });

  /*
   * Delivered calls with no agent recorded. Held at the bottom and never given
   * a rank, for the same reason `/delivery/agents` keeps it: it is not a
   * person, nobody can be coached or congratulated on it, and it is on the
   * board only so the rows reconcile with the agency total above them.
   */
  for (const row of unattributed) ranked.push({ ...row, rank: null });

  return ranked;
}

/* ── Movement ──────────────────────────────────────────────────────────────── */

/**
 * How far an agent moved since the previous period.
 *
 * Positive is UP the board -- rank 5 to rank 2 is `+3` -- which is the opposite
 * of the arithmetic and the right way round for a reader.
 *
 * Null when the agent was not ranked in the previous period. That is a new
 * starter, or somebody who was on holiday, and inventing a movement for them
 * ("up 12 places!") is the kind of fabricated encouragement that teaches people
 * the board is decorative.
 */
export function movementOf(rank: number | null, previousRank: number | null): number | null {
  if (rank === null || previousRank === null) return null;
  return previousRank - rank;
}

/* ── Streaks ───────────────────────────────────────────────────────────────── */

/**
 * Consecutive days, ending today, on which an agent submitted business.
 *
 * ── Today is allowed to be empty ─────────────────────────────────────────────
 *
 * An agent with a nine-day streak who opens the board at 09:00 has not written
 * anything yet today. Counting today as a miss would show them a broken streak
 * every single morning, which is the precise opposite of what a streak is for.
 * So the walk starts at today, and a day with nothing on it only breaks the
 * chain if it is BEHIND us.
 *
 * ── It is a fact about now, not about the selected period ────────────────────
 *
 * Deliberately computed from today backwards whatever range the board is
 * showing, and labelled that way on screen. A streak stamped on last March
 * would be a number that looks like a measurement and is not one -- the same
 * reason `getAgentRange` carries no live presence.
 *
 * @param daysWithBusiness calendar-day keys on which this agent submitted at
 *   least one application. Order does not matter.
 * @param today the calendar day to walk back from.
 * @param previousDay how to step one day back (injected so this file needs no
 *   timezone knowledge of its own).
 */
export function streakOf(
  daysWithBusiness: Iterable<string>,
  today: string,
  previousDay: (day: string) => string
): number {
  const days = daysWithBusiness instanceof Set ? daysWithBusiness : new Set(daysWithBusiness);

  let streak = 0;
  let cursor = today;

  if (!days.has(cursor)) {
    // Today is not over. Start the walk at yesterday instead of breaking here.
    cursor = previousDay(cursor);
  }

  // A floor rather than a `while (true)`: the lookback the caller loaded is
  // finite, and a bug in `previousDay` must not spin.
  for (let guard = 0; guard < 366; guard++) {
    if (!days.has(cursor)) break;
    streak++;
    cursor = previousDay(cursor);
  }

  return streak;
}

/** A streak long enough to be worth showing. Below this it is a coincidence. */
export const STREAK_BADGE_DAYS = 3;

/* ── Badges ────────────────────────────────────────────────────────────────── */

/**
 * Every badge the board can award, with the rule that awards it.
 *
 * Each of these is DERIVED from the figures already on the row -- there is no
 * table of awards, nothing is granted by hand, and nothing persists. Re-run the
 * query and the same period produces the same badges, which is what makes them
 * arguable: an agent can see exactly what they would have to do to take one.
 *
 * `minimum` is the volume floor, where one applies. A "best conversion" badge
 * with no floor belongs to whoever took one call, which is why it has one.
 */
export interface BadgeDefinition {
  id: string;
  label: string;
  /** What an agent has to do to hold it. Rendered in the tooltip, verbatim. */
  rule: string;
  /** Awarded to exactly one agent (the leader), or to everyone who qualifies. */
  scope: 'leader' | 'threshold';
}

export const BADGES: readonly BadgeDefinition[] = [
  {
    id: 'TOP_CLOSER',
    label: 'Top closer',
    rule: `Best conversion rate, with at least ${POINTS.conversionBonusMinCallers} unique callers worked`,
    scope: 'leader',
  },
  {
    id: 'MOST_APPLICATIONS',
    label: 'Most applications',
    rule: 'Most applications submitted in the period',
    scope: 'leader',
  },
  {
    id: 'MOST_CALLS',
    label: 'Busiest phone',
    rule: 'Most inbound calls taken in the period',
    scope: 'leader',
  },
  {
    id: 'MOST_DIALS',
    label: 'Hardest dialer',
    rule: 'Most outbound calls connected in the period',
    scope: 'leader',
  },
  {
    id: 'TOP_PREMIUM',
    label: 'Biggest book',
    rule: 'Most annualized premium written in the period',
    scope: 'leader',
  },
  {
    id: 'IRON_PHONE',
    label: 'Iron phone',
    rule: 'Most connected talk time in the period',
    scope: 'leader',
  },
  {
    id: 'MOST_IMPROVED',
    label: 'Most improved',
    rule: 'Biggest climb up the board since the previous period',
    scope: 'leader',
  },
  {
    id: 'ON_FIRE',
    label: 'On fire',
    rule: `Business written on ${STREAK_BADGE_DAYS} or more consecutive days, as of today`,
    scope: 'threshold',
  },
] as const;

export interface Badgeable {
  userId: string | null;
  applications: number;
  uniqueInboundCallers: number;
  inboundCalls: number;
  outboundConnected: number;
  annualizedPremium: number;
  talkTimeSeconds: number;
  conversionPct: number | null;
  movement: number | null;
  streakDays: number;
}

/**
 * Which badges each agent holds, as a map of user id to badge ids.
 *
 * A leader badge is awarded only when the leading value is greater than zero.
 * "Most applications: 0" on a quiet Sunday is not an achievement, and handing
 * it out devalues the one that was earned on Monday.
 */
export function awardBadges(rows: Badgeable[]): Map<string, string[]> {
  const held = new Map<string, string[]>();
  const people = rows.filter((row): row is Badgeable & { userId: string } => row.userId !== null);

  function give(userId: string, badgeId: string): void {
    const existing = held.get(userId);
    if (existing) existing.push(badgeId);
    else held.set(userId, [badgeId]);
  }

  /**
   * The single leader on a measure, or nobody.
   *
   * Ties award NOBODY rather than everybody. Two agents on four applications
   * each are not both "most applications", and a badge two people hold is a
   * badge neither of them mentions.
   */
  function leader(
    badgeId: string,
    valueOf: (row: Badgeable & { userId: string }) => number | null,
    eligible: (row: Badgeable & { userId: string }) => boolean = () => true
  ): void {
    let best: { userId: string; value: number } | null = null;
    let tied = false;

    for (const row of people) {
      if (!eligible(row)) continue;
      const value = valueOf(row);
      if (value === null || value <= 0) continue;

      if (best === null || value > best.value) {
        best = { userId: row.userId, value };
        tied = false;
      } else if (value === best.value) {
        tied = true;
      }
    }

    if (best && !tied) give(best.userId, badgeId);
  }

  leader(
    'TOP_CLOSER',
    row => row.conversionPct,
    row => row.uniqueInboundCallers >= POINTS.conversionBonusMinCallers
  );
  leader('MOST_APPLICATIONS', row => row.applications);
  leader('MOST_CALLS', row => row.inboundCalls);
  leader('MOST_DIALS', row => row.outboundConnected);
  leader('TOP_PREMIUM', row => row.annualizedPremium);
  leader('IRON_PHONE', row => row.talkTimeSeconds);
  leader('MOST_IMPROVED', row => row.movement);

  for (const row of people) {
    if (row.streakDays >= STREAK_BADGE_DAYS) give(row.userId, 'ON_FIRE');
  }

  return held;
}
