/**
 * NetEnroll's agreement settings: the singleton `agreement_settings` row.
 */

import type { AgreementSettings, PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

export const SETTINGS_ID = 'default';

export async function loadAgreementSettings(
  prisma: PrismaClient = getPrismaClient()
): Promise<AgreementSettings> {
  const existing = await prisma.agreementSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  // The migration seeds the row; a database built by `db push` has none.
  return prisma.agreementSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, internalCopyEmails: [] },
    update: {},
  });
}

/** The first required field that is empty, in words, or null when complete. */
export function missingSetting(settings: AgreementSettings): string | null {
  if (!settings.netenrollNoticeAddress?.trim()) return "NetEnroll's notice address";
  if (!settings.netenrollNoticeEmail?.trim()) return "NetEnroll's notice email";
  return null;
}

/** The address every "contact" line names. */
export function noticeEmailOf(settings: AgreementSettings | null): string {
  return settings?.netenrollNoticeEmail?.trim() || 'support@pvnvoice.com';
}
