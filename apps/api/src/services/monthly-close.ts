/**
 * The 1st of the month, run by the API itself.
 *
 * Two monthly jobs used to be CLIs (`numbers:bill-month`, `statements:close`),
 * and the production runner image carries only `dist/`, so nobody could run
 * them there. The API now does it: every hour it asks "is it the 1st in New
 * York, past 00:15?" and, when it is, bills this month's number charges and
 * THEN closes last month's statements -- in that order, so the agency
 * statements carry the month's number charges.
 *
 * Both are idempotent (number charges insert ON CONFLICT DO NOTHING;
 * `closeMonth` leaves a statement already written alone), so a tick that runs
 * them a second time on the same 1st writes nothing. A Redis lock (SET NX, two
 * hours) keeps two API processes from running them together.
 *
 * Nothing here may stop the API: every failure is logged and swallowed, and
 * the timer is unref'd so it never holds the process open.
 *
 * The same file starts the application → customer backfill once, in the
 * background, at startup (`services/applications/customer-link.ts`).
 */

import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';

import { logger } from '../lib/logger.js';

import { backfillApplicationCustomers } from './applications/customer-link.js';
import { billMonth } from './numbers/number-charges.js';
import { currentCalendarDay, PLATFORM_TIME_ZONE } from './rating/calendar-day.js';
import { closeMonth } from './statements/statements.js';
import { currentMonth, previousMonth } from './statements/statement-month.js';

/** How often the scheduler asks whether it is time. */
export const MONTHLY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** The lock's lifetime: long enough to outlast both jobs, short enough to retry the same day. */
export const MONTHLY_LOCK_TTL_SECONDS = 2 * 60 * 60;
/** Minutes past midnight, New York, before the 1st's run may start. */
const EARLIEST_MINUTE = 15;

export interface MonthlyCloseDeps {
  prisma: PrismaClient;
  redis: Pick<Redis, 'set'>;
  now?: () => Date;
}

export type MonthlyTickResult =
  | { ran: false; reason: 'not-the-1st' | 'too-early' | 'locked' }
  | {
      ran: true;
      billedMonth: string;
      numberChargesWritten: number;
      closedMonth: string;
      statementsWritten: number;
      statementsSkipped: number;
      statementErrors: number;
    };

/** Minutes past midnight in New York at `now`. */
function newYorkMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PLATFORM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * One tick. Runs both jobs when it is the 1st in New York, past 00:15, and no
 * other process holds the lock. Throws only what the jobs throw; the timer
 * below is what keeps that from reaching the process.
 */
export async function runMonthlyCloseTick(deps: MonthlyCloseDeps): Promise<MonthlyTickResult> {
  const now = deps.now?.() ?? new Date();
  const today = currentCalendarDay(now);
  if (!today.endsWith('-01')) return { ran: false, reason: 'not-the-1st' };
  if (newYorkMinuteOfDay(now) < EARLIEST_MINUTE) return { ran: false, reason: 'too-early' };

  const lockKey = `monthly-close:${today}`;
  const acquired = await deps.redis.set(
    lockKey,
    String(process.pid),
    'EX',
    MONTHLY_LOCK_TTL_SECONDS,
    'NX'
  );
  if (acquired !== 'OK') return { ran: false, reason: 'locked' };

  /*
   * The lock is held for its full two hours, not released on finish: another
   * process's tick in the same hour then does nothing at all. After it expires
   * a later tick on the 1st runs both jobs again, which writes nothing new --
   * and is what finishes a run that failed half way.
   */
  const month = currentMonth(now);
  const closing = previousMonth(month);
  logger.info({ msg: 'Monthly close starting', billing: month, closing });

  const billed = await billMonth(deps.prisma, now);
  logger.info({ msg: 'Monthly number charges written', month, written: billed.written });

  const closed = await closeMonth(deps.prisma, closing, { now });
  for (const failure of closed.errors) {
    logger.error({
      msg: 'Monthly statement could not be written',
      month: closing,
      party: failure.party,
      error: failure.message,
    });
  }
  logger.info({
    msg: 'Monthly close finished',
    billing: month,
    numberChargesWritten: billed.written,
    closing,
    statementsWritten: closed.written,
    statementsSkipped: closed.skipped,
    statementErrors: closed.errors.length,
  });

  return {
    ran: true,
    billedMonth: month,
    numberChargesWritten: billed.written,
    closedMonth: closing,
    statementsWritten: closed.written,
    statementsSkipped: closed.skipped,
    statementErrors: closed.errors.length,
  };
}

/**
 * Start the hourly check. Returns a stop function. The first check runs
 * straight away, so an API that restarts on the 1st does not wait an hour.
 */
export function startMonthlyCloseScheduler(deps: MonthlyCloseDeps): () => void {
  const tick = (): void => {
    runMonthlyCloseTick(deps).catch(error => {
      logger.error({ msg: 'Monthly close failed (non-fatal)', err: error });
    });
  };
  const timer = setInterval(tick, MONTHLY_CHECK_INTERVAL_MS);
  timer.unref();
  setImmediate(tick);
  return () => clearInterval(timer);
}

/** The application → customer backfill, once, in the background. Never throws. */
export function startApplicationCustomerBackfill(prisma: PrismaClient): void {
  backfillApplicationCustomers(prisma)
    .then(counts => {
      logger.info({ msg: 'Application customer backfill finished', ...counts });
    })
    .catch(error => {
      logger.error({ msg: 'Application customer backfill failed (non-fatal)', err: error });
    });
}
