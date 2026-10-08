/**
 * AI callbacks: a lead calling back one of the AI's outbound caller IDs.
 *
 * The Dograh AI dials out from our FracTEL DIDs. A lead who misses that call
 * and rings the number back reaches FreeSWITCH like any other inbound call, and
 * used to ring whoever that DID happened to be routed to. These callbacks
 * belong with the AI voice agent instead, so the FreeSWITCH lookup hands them
 * to Dograh's Asterisk, where the number's inbound agent answers.
 * See deploy/dograh/inbound-callback/README.md.
 *
 * Which DIDs: those marked `phone_numbers.metadata.dograhCallback = true`.
 * deploy/dograh/inbound-callback marks exactly the numbers Dograh has an
 * inbound agent on (`markDograhCallbackNumbers` below), so a call is never sent
 * to Dograh for a number it would refuse.
 *
 * Off until `DOGRAH_CALLBACK_BRIDGE` is set. Its value is the FreeSWITCH bridge
 * leg to Dograh's Asterisk with `{DID}` standing for the dialled number in
 * +1XXXXXXXXXX form, for example `sofia/external/{DID}@178.156.223.97:5070`.
 *
 * Never for:
 *   - a call Dograh itself sent us (`fromDograh`: its direct-transfer header),
 *     which would loop the transfer straight back to the AI;
 *   - a call whose caller ID is itself one of the AI's numbers, which is the AI
 *     transferring through FracTEL rather than a lead calling back.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

type PrismaLike = ReturnType<typeof getPrismaClient>;

export interface DograhCallbackRoute {
  /** The bridge leg to Dograh's Asterisk, `{DID}` filled in. */
  bridge: string;
  /** The agency that owns the dialled number. */
  tenantId: string;
  /** The dialled DID, +1XXXXXXXXXX. */
  did: string;
}

/** +1XXXXXXXXXX for a NANP number, or null. */
export function nanpE164(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? `+1${digits}` : null;
}

/** The forms a number may be stored in. */
function storedForms(number: string): string[] {
  return [number, number.slice(1), number.slice(2)];
}

function isFlagged(metadata: Prisma.JsonValue, key: string): boolean {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[key] === true
  );
}

/** The configured bridge leg for this DID, or null when callbacks are off. */
export function dograhCallbackBridge(did: string, template?: string): string | null {
  const configured = (template ?? process.env.DOGRAH_CALLBACK_BRIDGE ?? '').trim();
  if (!configured || !configured.includes('{DID}')) return null;
  return configured.split('{DID}').join(did);
}

export async function findDograhCallbackRoute(input: {
  did: string;
  caller?: string | null;
  fromDograh?: boolean;
  prismaClient?: PrismaLike;
  template?: string;
}): Promise<DograhCallbackRoute | null> {
  const did = nanpE164(input.did);
  if (!did || input.fromDograh) return null;
  const bridge = dograhCallbackBridge(did, input.template);
  if (!bridge) return null;

  const caller = nanpE164(input.caller);
  const prisma = input.prismaClient ?? getPrismaClient();
  const rows = await prisma.phoneNumber.findMany({
    where: {
      number: { in: [...storedForms(did), ...(caller ? storedForms(caller) : [])] },
      status: 'ACTIVE',
      OR: [
        { metadata: { path: ['dograhCallback'], equals: true } },
        { metadata: { path: ['dograhCallerId'], equals: true } },
      ],
    },
    select: { number: true, tenantId: true, metadata: true },
  });

  const owned = rows.find(
    r => nanpE164(r.number) === did && isFlagged(r.metadata, 'dograhCallback')
  );
  if (!owned) return null;
  if (caller && rows.some(r => nanpE164(r.number) === caller)) return null;

  return { bridge, tenantId: owned.tenantId, did };
}

export interface MarkResult {
  marked: number;
  alreadyMarked: number;
  unmarked: number;
  /** Numbers Dograh answers that Hopwhistle has no phone_numbers row for. */
  notInHopwhistle: string[];
}

/**
 * Mark exactly `numbers` as AI-callback numbers: flag each one, and clear the
 * flag from any number no longer in the list. An empty list clears them all.
 */
export async function markDograhCallbackNumbers(
  numbers: string[],
  options: { apply: boolean; prismaClient?: PrismaLike }
): Promise<MarkResult> {
  const prisma = options.prismaClient ?? getPrismaClient();
  const wanted = new Set(numbers.map(nanpE164).filter((n): n is string => !!n));
  const result: MarkResult = { marked: 0, alreadyMarked: 0, unmarked: 0, notInHopwhistle: [] };

  const rows = await prisma.phoneNumber.findMany({
    where: {
      OR: [
        { number: { in: [...wanted].flatMap(storedForms) } },
        { metadata: { path: ['dograhCallback'], equals: true } },
      ],
    },
    select: { id: true, number: true, metadata: true },
  });

  const found = new Set<string>();
  for (const row of rows) {
    const e164 = nanpE164(row.number);
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    const flagged = metadata.dograhCallback === true;
    const want = !!e164 && wanted.has(e164);
    if (want) found.add(e164);

    if (want && flagged) {
      result.alreadyMarked++;
      continue;
    }
    if (!want && !flagged) continue;

    const next: Prisma.JsonObject = { ...metadata };
    if (want) {
      next.dograhCallback = true;
      result.marked++;
    } else {
      delete next.dograhCallback;
      result.unmarked++;
    }
    if (options.apply) {
      await prisma.phoneNumber.update({ where: { id: row.id }, data: { metadata: next } });
    }
  }

  result.notInHopwhistle = [...wanted].filter(n => !found.has(n)).sort();
  return result;
}
