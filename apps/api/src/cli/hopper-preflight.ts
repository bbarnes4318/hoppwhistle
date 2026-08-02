/**
 * Hopper preflight CLI — STRICTLY READ-ONLY.
 *
 *   pnpm --filter @hopwhistle/api hopper:preflight
 *   pnpm --filter @hopwhistle/api hopper:preflight -- --json
 *
 * Answers, against the live database, whether the production Hopper is blocked
 * by the `LeadStatus` enum and — critically — how many real telephone calls a
 * repair would place immediately.
 *
 * Executes SELECT statements only, and opens a bare TCP socket to FreeSWITCH
 * that is closed without sending or reading anything. It cannot modify a lead,
 * campaign, enum, worker, caller ID, gateway, or FreeSWITCH configuration.
 */

import net from 'node:net';

import { getPrismaClient } from '../lib/prisma.js';
import {
  analyzeHopperPreflight,
  formatHopperPreflight,
  probeHopperPreflight,
  type PreflightQueryClient,
} from '../services/hopper-preflight.js';

const ESL_CONNECT_TIMEOUT_MS = 3_000;

/**
 * TCP reachability only. Deliberately does NOT authenticate and does NOT read
 * the ESL banner — nothing is written to the socket, so this cannot issue a
 * FreeSWITCH command even by accident.
 */
function checkEslReachable(
  host: string,
  port: number
): Promise<{ reachable: boolean; detail: string }> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, detail });
    };

    socket.setTimeout(ESL_CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish(true, `TCP connect to port ${port} succeeded`));
    socket.once('timeout', () => finish(false, `TCP connect to port ${port} timed out`));
    // The host is intentionally omitted from the message: it is infrastructure
    // detail, and error strings end up in logs and tickets.
    socket.once('error', (err: NodeJS.ErrnoException) =>
      finish(false, `TCP connect to port ${port} failed (${err.code ?? 'error'})`)
    );
    socket.connect(port, host);
  });
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const prisma = getPrismaClient();

  try {
    const facts = await probeHopperPreflight({
      db: prisma as unknown as PreflightQueryClient,
      env: process.env,
      checkEsl: checkEslReachable,
    });
    const report = analyzeHopperPreflight(facts);

    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatHopperPreflight(report)}\n`);
    }

    // Exit 2 signals "a repair here would start real calls" so this can gate a
    // deployment step without anyone having to parse the prose.
    process.exitCode = report.repairWouldStartCallsImmediately ? 2 : 0;
  } catch (error) {
    process.stderr.write(
      `hopper:preflight failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

void main();
