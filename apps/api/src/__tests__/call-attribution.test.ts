/**
 * Tying an application to the call that produced it.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * The closing percentage prices every agency, and its two sides were
 * CORRELATED BY AGENT AND DAY rather than joined -- delivered calls through
 * `Call.answeredByUserId`, submitted applications through `createdById`. That
 * answers "this agent took 40 calls and wrote 4 applications" and cannot answer
 * "which call became this application", so an agency disputing the figure that
 * sets its price had nothing to drill into.
 *
 * `callId` existed and was barely used: optional, so the form almost never sent
 * it, and verified only against the TENANT -- correctly, which is why another
 * agency's call never reached it, but not against the submitting AGENT.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. The missing half of the check. A call belonging to a COLLEAGUE is
 *      refused. Accepting it would move production between agents on the
 *      figures a principal decides coaching and pay from.
 *   2. A bad claim is REFUSED, not quietly downgraded. Substituting a different
 *      call would write a plausible row for something nobody asked for and the
 *      caller would never learn their link was wrong.
 *   3. `NONE` is an honest absence and is never faked. An inference that cannot
 *      run returns NONE rather than failing the application, because the row is
 *      what the agency is measured on and the link is a convenience.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { UnknownCallError, attributeCall } from '../services/applications/call-attribution.js';

const findFirst = vi.fn<[args: unknown], Promise<{ id: string } | null>>();
const prisma = { call: { findFirst } } as unknown as Parameters<typeof attributeCall>[0];

const AT = new Date('2026-09-21T15:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
});

/* ── A call the agent named ────────────────────────────────────────────────── */

describe('when the client names a call', () => {
  it('accepts it, as CLIENT, once verified', async () => {
    findFirst.mockResolvedValue({ id: 'call-1' });

    const result = await attributeCall(prisma, 'agency-a', 'agent-1', 'call-1', AT);

    expect(result).toEqual({ callId: 'call-1', attribution: 'CLIENT' });
  });

  it('verifies the call against BOTH the agency and the agent', async () => {
    findFirst.mockResolvedValue({ id: 'call-1' });

    await attributeCall(prisma, 'agency-a', 'agent-1', 'call-1', AT);

    /*
     * `tenantId` is the check the route already made. `answeredByUserId` is the
     * one that was missing, and without it an agent can attribute their
     * application to a colleague's call.
     */
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'call-1', tenantId: 'agency-a', answeredByUserId: 'agent-1' },
      })
    );
  });

  it('refuses a call that is not this agents', async () => {
    // The colleague's call: it exists, in this agency, and the query finds
    // nothing because `answeredByUserId` does not match.
    findFirst.mockResolvedValue(null);

    await expect(
      attributeCall(prisma, 'agency-a', 'agent-1', 'colleagues-call', AT)
    ).rejects.toBeInstanceOf(UnknownCallError);
  });

  it('refuses rather than silently attributing a different call', async () => {
    findFirst.mockResolvedValue(null);

    /*
     * The property that matters. Downgrading to an inferred call here would
     * write a plausible-looking row for something nobody asked for, and the
     * caller would never learn their link was wrong.
     */
    await expect(attributeCall(prisma, 'agency-a', 'agent-1', 'not-mine', AT)).rejects.toThrow(
      /only be attributed to a call the submitting agent took/i
    );

    // And it did not fall through to the inference query.
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

/* ── Nothing named ─────────────────────────────────────────────────────────── */

describe('when the client names nothing', () => {
  it('infers the agents own most recent answered call', async () => {
    findFirst.mockResolvedValue({ id: 'call-recent' });

    const result = await attributeCall(prisma, 'agency-a', 'agent-1', null, AT);

    expect(result).toEqual({ callId: 'call-recent', attribution: 'INFERRED' });
  });

  it('scopes the inference to this agent, newest first', async () => {
    findFirst.mockResolvedValue({ id: 'call-recent' });

    await attributeCall(prisma, 'agency-a', 'agent-1', undefined, AT);

    const args = findFirst.mock.calls[0][0] as {
      where: { tenantId: string; answeredByUserId: string; answeredAt: { gte: Date; lte: Date } };
      orderBy: { answeredAt: string };
    };
    // The agent's call, not the agency's most recent.
    expect(args.where.tenantId).toBe('agency-a');
    expect(args.where.answeredByUserId).toBe('agent-1');
    expect(args.orderBy).toEqual({ answeredAt: 'desc' });
    expect(args.where.answeredAt.lte).toEqual(AT);
    expect(args.where.answeredAt.gte.getTime()).toBeLessThan(AT.getTime());
  });

  it('reports NONE when the agent has taken no call in the window', async () => {
    findFirst.mockResolvedValue(null);

    /*
     * An honest absence. Business written from a callback, from paper, or hours
     * after the call legitimately lands here, and a row saying so is worth more
     * than a guess.
     */
    expect(await attributeCall(prisma, 'agency-a', 'agent-1', null, AT)).toEqual({
      callId: null,
      attribution: 'NONE',
    });
  });
});

/* ── Never failing the application ─────────────────────────────────────────── */

describe('when the inference query fails', () => {
  it('records NONE rather than throwing', async () => {
    findFirst.mockRejectedValue(new Error('database is down'));

    /*
     * The row is what the agency is measured on; the link is a convenience for
     * reading it afterwards. An application must never be lost because the
     * lookup that decorates it failed.
     */
    expect(await attributeCall(prisma, 'agency-a', 'agent-1', null, AT)).toEqual({
      callId: null,
      attribution: 'NONE',
    });
  });

  it('still propagates a refusal of a named call', async () => {
    findFirst.mockResolvedValue(null);

    // A named call that is not the agent's is a caller error, not a lookup
    // failure, and must not be swallowed by the same safety net.
    await expect(
      attributeCall(prisma, 'agency-a', 'agent-1', 'not-mine', AT)
    ).rejects.toBeInstanceOf(UnknownCallError);
  });
});
