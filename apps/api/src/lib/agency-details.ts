/**
 * What an agency's own record has to look like, wherever one is created.
 *
 * Two routes create agencies: NetEnroll's onboarding (step a, in
 * `routes/onboarding.ts`) and a white-label agency onboarding one of its own
 * downline agencies (`routes/network.ts`). They validate the same fields the
 * same way, from these, so an agency one of them accepts is an agency the
 * other would have accepted too.
 */

import type { PrismaClient } from '@prisma/client';

/** `MON`..`SUN`. Stored as strings so no layer can shift a day by a timezone. */
export const DELIVERY_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STATE_PATTERN = /^[A-Z]{2}$/;

/**
 * A slug that is stable, readable and unlikely to collide.
 *
 * Derived from the name, suffixed when taken. Not from anything in the request
 * that names an existing tenant: a caller must not be able to steer a new
 * agency onto an existing slug.
 */
export async function uniqueSlug(
  prisma: Pick<PrismaClient, 'tenant'>,
  name: string
): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agency';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.tenant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  return `${base}-${Date.now()}`;
}
