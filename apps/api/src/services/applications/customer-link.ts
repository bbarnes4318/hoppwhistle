/**
 * The customer an application belongs to.
 *
 * An application row is the business an agent wrote; the customer record is
 * the `InsuranceLead` the CRM shows -- notes, tasks, calls, every application.
 * `InsuranceCarrierApplication.insuranceLeadId` joins the two, and it is
 * optional: an application logged after a call the CRM never saw has none.
 *
 * `linkApplicationCustomer` fills it in, in this order:
 *
 *   a) it is already set, and that lead is still in the tenant -- use it;
 *   b) the agent who wrote it already has a customer on that phone -- link it;
 *   c) the agency has an unassigned customer on that phone -- hand it to that
 *      agent and link it;
 *   d) otherwise create the customer, as sold, assigned to that agent.
 *
 * All of it in one transaction, so two clicks on the same row make one
 * customer. The phone is the match: a customer created with no phone is a
 * record nothing else can ever find, so an application without one is refused
 * rather than guessed at.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { normalizeStateAbbr } from '../carrier-rpa/normalization.js';

export type CustomerLinkOutcome = 'existing' | 'matched' | 'claimed' | 'created';

export interface CustomerLinkResult {
  customerId: string;
  outcome: CustomerLinkOutcome;
}

/** The application has no phone to match or create a customer on. */
export class ApplicationHasNoPhoneError extends Error {
  readonly code = 'NO_PHONE';
  constructor() {
    super('This application has no phone number to match a customer');
  }
}

/** The application is not in this tenant (or not the caller's to open). */
export class ApplicationNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such application.');
  }
}

/** The last ten digits of a phone, or null when it has fewer. */
export function tenDigitPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** The ways a ten-digit number is stored on older lead rows. */
function phoneVariants(ten: string): string[] {
  return [ten, `1${ten}`, `+1${ten}`];
}

function asString(value: Prisma.Decimal | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export interface LinkOptions {
  tenantId: string;
  applicationId: string;
  /**
   * When set, the application must have been written by this user: the
   * agent-scope rule, applied inside the lookup so a colleague's application
   * reads as not found.
   */
  onlyCreatedById?: string | null;
  now?: Date;
}

export async function linkApplicationCustomer(
  prisma: PrismaClient,
  options: LinkOptions
): Promise<CustomerLinkResult> {
  const { tenantId, applicationId } = options;
  const now = options.now ?? new Date();

  return prisma.$transaction(async tx => {
    const application = await tx.insuranceCarrierApplication.findFirst({
      where: {
        id: applicationId,
        tenantId,
        ...(options.onlyCreatedById !== undefined ? { createdById: options.onlyCreatedById } : {}),
      },
      select: {
        id: true,
        insuranceLeadId: true,
        createdById: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        dob: true,
        age: true,
        gender: true,
        carrier: true,
        product: true,
        faceAmount: true,
        monthlyPremium: true,
      },
    });
    if (!application) throw new ApplicationNotFoundError();

    // a) Already linked, and the customer still exists in this agency.
    if (application.insuranceLeadId) {
      const existing = await tx.insuranceLead.findFirst({
        where: { id: application.insuranceLeadId, tenantId },
        select: { id: true },
      });
      if (existing) return { customerId: existing.id, outcome: 'existing' as const };
    }

    const phone = tenDigitPhone(application.phone);
    if (!phone) throw new ApplicationHasNoPhoneError();

    const link = async (customerId: string): Promise<void> => {
      await tx.insuranceCarrierApplication.update({
        where: { id: application.id },
        data: { insuranceLeadId: customerId },
      });
    };

    const agentId = application.createdById;

    // b) The writing agent's own customer on this phone.
    const mine = await tx.insuranceLead.findFirst({
      where: { tenantId, phone: { in: phoneVariants(phone) }, assignedToId: agentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (mine) {
      await link(mine.id);
      return { customerId: mine.id, outcome: 'matched' as const };
    }

    // c) The agency's unassigned customer on this phone, handed to that agent.
    if (agentId) {
      const unassigned = await tx.insuranceLead.findFirst({
        where: { tenantId, phone: { in: phoneVariants(phone) }, assignedToId: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (unassigned) {
        const claimed = await tx.insuranceLead.updateMany({
          where: { id: unassigned.id, tenantId, assignedToId: null },
          data: { assignedToId: agentId, assignedAt: now },
        });
        if (claimed.count === 1) {
          await link(unassigned.id);
          return { customerId: unassigned.id, outcome: 'claimed' as const };
        }
      }
    }

    // d) A new customer, sold, on the writing agent.
    const firstName = application.firstName?.trim() || null;
    const lastName = application.lastName?.trim() || null;
    const created = await tx.insuranceLead.create({
      data: {
        tenantId,
        vertical: 'FE', // Final expense
        firstName,
        lastName,
        fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
        phone,
        email: application.email || null,
        address: application.address || null,
        city: application.city || null,
        state: normalizeStateAbbr(application.state) || null,
        zipCode: application.zip || null,
        birthDate: application.dob || null,
        age: application.age ?? null,
        gender: application.gender || null,
        carrier: application.carrier || null,
        product: application.product || null,
        faceAmount: asString(application.faceAmount),
        monthlyPremium: asString(application.monthlyPremium),
        status: 'CONVERTED',
        source: 'application',
        assignedToId: agentId,
        assignedAt: agentId ? now : null,
      },
      select: { id: true },
    });
    await link(created.id);
    return { customerId: created.id, outcome: 'created' as const };
  });
}

export interface BackfillCounts {
  existing: number;
  linked: number;
  created: number;
  skippedNoPhone: number;
}

/**
 * Link every submitted, unlinked application to its customer. Idempotent: a
 * linked application is no longer selected, so a second run finds nothing.
 */
export async function backfillApplicationCustomers(
  prisma: PrismaClient,
  options: { tenantId?: string; batchSize?: number } = {}
): Promise<BackfillCounts> {
  const counts: BackfillCounts = { existing: 0, linked: 0, created: 0, skippedNoPhone: 0 };
  const batchSize = options.batchSize ?? 200;
  // The last id processed. Paged with `id > after`, NOT Prisma's `cursor` +
  // `skip: 1`: this loop links every row it reads, so the cursor row has left
  // the `insuranceLeadId: null` set by the next query, and `skip: 1` then drops
  // the first row that is still unlinked -- one application per page, silently.
  let after: string | undefined;

  for (;;) {
    const batch = await prisma.insuranceCarrierApplication.findMany({
      where: {
        submittedAt: { not: null },
        insuranceLeadId: null,
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, tenantId: true },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      try {
        const result = await linkApplicationCustomer(prisma, {
          tenantId: row.tenantId,
          applicationId: row.id,
        });
        if (result.outcome === 'created') counts.created += 1;
        else if (result.outcome === 'existing') counts.existing += 1;
        else counts.linked += 1;
      } catch (error) {
        if (error instanceof ApplicationHasNoPhoneError) {
          counts.skippedNoPhone += 1;
          continue;
        }
        throw error;
      }
    }
    after = batch[batch.length - 1].id;
  }

  return counts;
}
