/**
 * What "a call in progress" means. One definition, for every screen that counts
 * or shows one: the delivery panel, the live strip above every page, the
 * platform and agency live boards, the white-label Today screen, the live
 * metrics endpoint and the Agents floor.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 *   status is INITIATED, RINGING or ANSWERED
 *   AND no end time is recorded
 *   AND the call was created inside the last IN_FLIGHT_WINDOW_MS
 *
 * The window is the part that matters. A call whose hangup was never written
 * keeps `endedAt` null forever, and the delivery panel used to count every such
 * call as in progress for the rest of time: the strip read "3 in progress" on a
 * floor that had taken nothing all day while Today, bounded, read 0. A call
 * with no end time from hours ago is a stuck row, not a live one.
 */

import type { Prisma } from '@prisma/client';

/** How long a call with no end time still counts as up. */
export const IN_FLIGHT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Still up: dialling, ringing or connected. */
export const IN_FLIGHT_STATUSES = ['INITIATED', 'RINGING', 'ANSWERED'] as const;

/** The rule as a where clause, without a tenant. Spread a tenant or a set of them in. */
export function callInProgressWhere(now: Date = new Date()): Prisma.CallWhereInput {
  return {
    status: { in: [...IN_FLIGHT_STATUSES] },
    endedAt: null,
    createdAt: { gte: new Date(now.getTime() - IN_FLIGHT_WINDOW_MS) },
  };
}

/** The same rule for a row already in hand. */
export function isCallInProgress(
  call: { status: string; endedAt: Date | null; createdAt: Date },
  now: Date = new Date()
): boolean {
  return (
    (IN_FLIGHT_STATUSES as readonly string[]).includes(call.status) &&
    call.endedAt === null &&
    call.createdAt.getTime() >= now.getTime() - IN_FLIGHT_WINDOW_MS
  );
}
