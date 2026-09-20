/**
 * One agent, one SIP identity: allocating it, issuing it, and rotating it.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * `GET /api/v1/agent/webrtc/credentials` used to do the allocation inline: read
 * every user row in the agency, collect `metadata.extension`, pick the first
 * free number in 1000..1019, write it back to `metadata`, and hand the agent
 * the ONE global `SIP_AGENT_PASSWORD`. Three defects fell out of that, recorded
 * in full on the `AgentSipCredential` model and in the migration; the two that
 * shape this file are:
 *
 *   * the free-extension scan was scoped to the AGENCY while FreeSWITCH's
 *     directory is one flat domain, so two agencies were handed the same SIP
 *     username and the second browser to register stole the first's calls; and
 *
 *   * every agent held a credential that authenticated every extension on the
 *     platform.
 *
 * So allocation is global here, and the secret is per agent.
 *
 * ── The allocation is not check-then-act ─────────────────────────────────────
 *
 * `nextFreeExtension` reads the taken set and picks the lowest gap, and two
 * requests arriving together will read the same set and pick the same number.
 * That race is not prevented by the read -- it is settled by the UNIQUE index
 * on `extension`, which lets exactly one of them commit. The loser catches
 * P2002 and tries again from a fresh read.
 *
 * This is the only correct shape for it. A scan that believed its own result
 * would need a table lock to be right, and a lock held across an allocation is
 * a queue in front of every agent signing in each morning.
 *
 * ── Reservations ─────────────────────────────────────────────────────────────
 *
 * A row with a NULL `passwordEncrypted` is a RESERVATION: the migration claimed
 * an agent's pre-existing extension so nothing else could take it, but there
 * was no per-agent secret to carry across -- the old one was global, and
 * copying it in would have carried the defect forward. `issueCredential` fills
 * one in on the agent's next fetch, keeping the extension they already had.
 */

import { randomBytes } from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { decryptField, encryptField } from '../../lib/field-encryption.js';
import { getPrismaClient } from '../../lib/prisma.js';

/**
 * The extension range, and the reason it is this range.
 *
 * `apps/freeswitch/conf/dialplan/default.xml` routes local extensions with
 * `^(1[0-9]{3})$` and tests `${local_ext}` against `^\d{4}$` in two more
 * places. 1000..1999 is therefore exactly what the dialplan can already reach,
 * and staying inside it makes this a schema change rather than a telephony
 * change. Widening it past 1999 means editing those three expressions first.
 */
export const EXTENSION_MIN = 1000;
export const EXTENSION_MAX = 1999;

/** Whether a string is an extension this platform can route. */
export function isRoutableExtension(value: string): boolean {
  if (!/^\d{4}$/.test(value)) return false;
  const n = Number(value);
  return n >= EXTENSION_MIN && n <= EXTENSION_MAX;
}

/**
 * How many times to re-read and retry after losing an allocation race.
 *
 * Each attempt re-reads the taken set, so a retry picks a different number
 * than the one that just collided. Five is far past what contention explains:
 * reaching it means the range is full, and the error says so rather than
 * retrying forever.
 */
const ALLOCATION_ATTEMPTS = 5;

/** A credential as its owner receives it. The password is in the clear here. */
export interface IssuedSipCredential {
  extension: string;
  password: string;
  /** True when this call created the row or filled in a reservation. */
  provisioned: boolean;
}

/**
 * A password an agent never types.
 *
 * It is read by the browser from the credentials endpoint and handed straight
 * to SIP.js, so it is sized for an attacker rather than for a human: 24 bytes
 * of `randomBytes` in base64url. Base64url and not hex because the value goes
 * into a SIP Authorization header and an XML attribute, and `+`, `/` and `=`
 * are the three characters that would need escaping in one or the other.
 */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * The lowest extension in the range that nothing holds.
 *
 * Reads the whole taken set rather than probing one number at a time: the range
 * is a thousand wide, the rows are a single indexed column, and one round trip
 * beats a thousand. Returns null when the range is exhausted.
 *
 * REVOKED rows are counted as taken. A revoked credential keeps its name
 * precisely so the name is not reissued to a different agent while a stale
 * softphone is still registered with it.
 */
async function nextFreeExtension(prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.agentSipCredential.findMany({
    select: { extension: true },
  });
  const taken = new Set(rows.map(row => row.extension));

  for (let n = EXTENSION_MIN; n <= EXTENSION_MAX; n++) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** Raised when the platform has no SIP identity left to hand out. */
export class ExtensionRangeExhaustedError extends Error {
  constructor() {
    super(
      `Every SIP extension between ${EXTENSION_MIN} and ${EXTENSION_MAX} is allocated. ` +
        'Revoked credentials still hold their extension; releasing them, or widening the ' +
        'range in apps/freeswitch/conf/dialplan/default.xml, is what frees one.'
    );
    this.name = 'ExtensionRangeExhaustedError';
  }
}

/** Whether a Prisma error is the unique-constraint violation we race against. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * This agent's credential, provisioning one if they have none.
 *
 * Idempotent in the sense that matters: an agent who already holds an ACTIVE
 * credential with a password gets that same extension and that same password
 * back, every time. Nothing rotates on a fetch -- a rotation would invalidate
 * the registration the agent is already holding open.
 *
 * @param tenantId The acting agency. A credential belongs to one.
 * @param userId   The agent it is for.
 */
export async function issueCredential(
  tenantId: string,
  userId: string,
  options: { prisma?: PrismaClient } = {}
): Promise<IssuedSipCredential> {
  const prisma = options.prisma ?? getPrismaClient();

  const existing = await prisma.agentSipCredential.findUnique({ where: { userId } });

  if (existing) {
    /*
     * A credential for an agent who has been moved to another agency is not
     * this agency's to hand out. Refusing rather than re-homing it: moving an
     * agent between agencies is an act somebody performs deliberately, and
     * silently re-pointing a live SIP identity at a different tenant is how one
     * agency's calls end up on another agency's floor -- the exact defect this
     * whole change exists to close.
     */
    if (existing.tenantId !== tenantId) {
      throw new Error(
        `Agent ${userId} holds a SIP credential belonging to a different agency. ` +
          'Revoke it before provisioning them here.'
      );
    }

    if (existing.status !== 'ACTIVE') {
      throw new Error(
        `Agent ${userId}'s SIP credential is ${existing.status}. It must be reinstated ` +
          'before a softphone can register with it.'
      );
    }

    // A reservation: the extension is already theirs, the secret was never
    // written. Fill it in, keeping the number so a configured softphone and any
    // routing that names this extension keep working.
    if (!existing.passwordEncrypted) {
      const password = generatePassword();
      await prisma.agentSipCredential.update({
        where: { userId },
        data: { passwordEncrypted: encryptField(password), rotatedAt: new Date() },
      });
      return { extension: existing.extension, password, provisioned: true };
    }

    return {
      extension: existing.extension,
      password: decryptField(existing.passwordEncrypted) ?? '',
      provisioned: false,
    };
  }

  // No row at all. Allocate, and let the unique index settle the race.
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt++) {
    const extension = await nextFreeExtension(prisma);
    if (!extension) throw new ExtensionRangeExhaustedError();

    const password = generatePassword();
    try {
      await prisma.agentSipCredential.create({
        data: {
          tenantId,
          userId,
          extension,
          passwordEncrypted: encryptField(password),
        },
      });
      return { extension, password, provisioned: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      /*
       * Two ways to land here, and they need different answers.
       *
       * `userId` collided: a concurrent request for THIS agent won, and its row
       * is the one to return -- allocating a second extension for one agent is
       * the "whichever browser registered last wins" defect again.
       *
       * `extension` collided: a concurrent request for a DIFFERENT agent took
       * the number. Loop, re-read, pick the next gap.
       */
      const target = (error as Prisma.PrismaClientKnownRequestError).meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
      if (fields.some(field => field.includes('userId'))) {
        return issueCredential(tenantId, userId, { prisma });
      }
    }
  }

  throw new Error(
    `Could not allocate a SIP extension for agent ${userId} after ${ALLOCATION_ATTEMPTS} ` +
      'attempts. Every candidate was taken by a concurrent request, which at this rate ' +
      'means the range is close to full.'
  );
}

/**
 * Replace an agent's password, keeping their extension.
 *
 * The agent's softphone is registered with the old secret and will keep working
 * until its registration expires, at which point it re-registers with whatever
 * the credentials endpoint now returns. So a rotation is not instant, and it is
 * not meant to be: cutting a live agent off mid-call to change a password is a
 * worse outcome than the minutes the old secret stays usable.
 */
export async function rotatePassword(
  userId: string,
  options: { prisma?: PrismaClient } = {}
): Promise<IssuedSipCredential> {
  const prisma = options.prisma ?? getPrismaClient();
  const password = generatePassword();

  const row = await prisma.agentSipCredential.update({
    where: { userId },
    data: { passwordEncrypted: encryptField(password), rotatedAt: new Date() },
  });

  return { extension: row.extension, password, provisioned: false };
}

/** What the FreeSWITCH directory needs to answer one lookup. */
export interface DirectoryPrincipal {
  extension: string;
  password: string;
  tenantId: string;
  userId: string;
}

/**
 * Resolve a SIP username to the principal behind it, for the directory.
 *
 * Returns null for an extension nothing holds, for a REVOKED credential, and
 * for a reservation that has never been issued a secret. All three are the same
 * answer to FreeSWITCH -- no such user -- and that is correct in each case:
 * there is no password to authenticate against.
 */
export async function lookupDirectoryPrincipal(
  extension: string,
  options: { prisma?: PrismaClient } = {}
): Promise<DirectoryPrincipal | null> {
  const prisma = options.prisma ?? getPrismaClient();

  if (!isRoutableExtension(extension)) return null;

  const row = await prisma.agentSipCredential.findUnique({
    where: { extension },
    select: {
      extension: true,
      passwordEncrypted: true,
      status: true,
      tenantId: true,
      userId: true,
    },
  });

  if (!row || row.status !== 'ACTIVE' || !row.passwordEncrypted) return null;

  const password = decryptField(row.passwordEncrypted);
  if (!password) return null;

  return {
    extension: row.extension,
    password,
    tenantId: row.tenantId,
    userId: row.userId,
  };
}
