/**
 * A child agency's "direct" publisher.
 *
 * Every campaign names a publisher (`Campaign.publisherId` is required), and a
 * child agency cannot create one: publishers are the white-label tier's call
 * network, and a downline agency does not run one. Its calls come through its
 * parent. So a child's campaigns are attributed to one publisher of its own,
 * "<agency> (direct)", made the first time a campaign needs it.
 *
 * Only for a child. Anybody else is asked for a publisher as before.
 */

import { getPrismaClient } from '../lib/prisma.js';

/** The code the house publisher is stored under; one per tenant. */
function houseCode(tenantId: string): string {
  return `direct-${tenantId}`;
}

/** The child's house publisher id, creating it if need be; null if not a child. */
export async function housePublisherForChild(tenantId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, parentTenantId: true },
  });
  if (!tenant?.parentTenantId) return null;

  const code = houseCode(tenantId);
  const existing = await prisma.publisher.findFirst({
    where: { tenantId, code },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.publisher.create({
      data: { tenantId, name: `${tenant.name} (direct)`, code, status: 'ACTIVE' },
      select: { id: true },
    });
    return created.id;
  } catch {
    // A concurrent request made it first.
    const raced = await prisma.publisher.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    return raced?.id ?? null;
  }
}
