import { describe, it, expect, beforeAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The constraints `prisma db push` cannot create.
 *
 * Prisma's schema language cannot express a partial unique index, so those live
 * in prisma/sql/db-push-constraints.sql and are applied by `db:constraints`
 * after every db push. Nothing else enforces them, and their absence is silent:
 * the database works, it just stops rejecting what it should reject.
 *
 * lead_dial_reservations went that way. The guarantee was written in a
 * migration, `migrate deploy` stopped running (the history is missing CREATE
 * TABLE for leads and ai_campaign_calls, so it fails part way), every database
 * moved to db push, and the index quietly ceased to exist. The suite that
 * covers the race passed anyway, because without a constraint the outcome is
 * timing: ten concurrent workers serialised locally and produced five winners
 * in CI.
 *
 * This asserts presence directly, so it fails the same way every time rather
 * than whenever the scheduler happens to interleave.
 */
const gate = databaseGate();
announceSkip('db push constraints', gate);

describe.skipIf(!gate.available)('constraints db push cannot create', () => {
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    prisma = getPrismaClient();
  });

  it('lead_dial_reservations has the partial unique index on the active reservation', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'lead_dial_reservations'
        AND indexname = 'lead_dial_reservations_active_lead_key'
    `;

    expect(
      rows,
      'Run `pnpm --filter @hopwhistle/api db:constraints` after `prisma db push`. ' +
        'Without this index, concurrent workers can each reserve the same lead and ' +
        'several agents dial the same person.'
    ).toHaveLength(1);

    // Both halves matter: unique gives the guarantee, the predicate is what lets
    // a released lead be reserved again.
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/i);
    expect(rows[0].indexdef).toMatch(/\(\s*"?leadId"?\s*\)/i);
    expect(rows[0].indexdef).toMatch(/WHERE\s*\(?\s*"releasedAt"\s+IS\s+NULL/i);
  });

  /*
   * Phase 3 puts three triggers in the same file, for the same reason: a
   * trigger cannot be expressed in schema.prisma either, so `db push` builds a
   * database without them and nothing says so.
   *
   * Their absence is exactly as silent as the missing index above, and far more
   * expensive: without them an UPDATE can move a balance or rewrite what an
   * agency was charged on a night, and the row would still read as the record.
   */
  it.each([
    [
      'application_credit_ledger_append_only',
      'application_credit_ledger',
      'the credit ledger would accept an UPDATE that moves a balance',
    ],
    [
      'daily_settlements_figures_immutable',
      'daily_settlements',
      "a settled day's figures could be rewritten after the fact",
    ],
    [
      'settlement_payment_attempts_append_only',
      'settlement_payment_attempts',
      'a payment attempt could be edited out of the history',
    ],
  ])('%s is installed on %s', async (trigger, table, consequence) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT t.tgname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal
          AND c.relname = '${table}'
          AND t.tgname = '${trigger}'`
    );

    expect(
      rows,
      'Run `pnpm --filter @hopwhistle/api db:constraints` after `prisma db push`. ' +
        `Without this trigger, ${consequence}.`
    ).toHaveLength(1);
  });
});
