/**
 * One-time startup repair: Fix DID routes with UUID destinations.
 *
 * The old `syncDidRouteForNumber` code had a bug where it would set
 * `destination = extension || phoneNumber.userId`, meaning if a user
 * had no extension, the route destination was set to the user's UUID
 * instead of a real phone number.
 *
 * This repair scans all DidRoute records at startup, identifies any
 * whose destination looks like a UUID, and attempts to fix them by
 * looking up the user's extension. If no extension is available and
 * no better destination can be found, the route is flagged for manual
 * review (logged as a warning) but left as-is to avoid data loss.
 */

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function repairUuidRouteDestinations(): Promise<void> {
  const prisma = getPrismaClient();

  try {
    // Find all routes whose destination looks like a UUID
    const allRoutes = await prisma.didRoute.findMany({
      select: {
        id: true,
        did: true,
        destination: true,
        phoneNumberId: true,
        tenantId: true,
        label: true,
        phoneNumber: {
          select: {
            id: true,
            number: true,
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                metadata: true,
              },
            },
          },
        },
      },
    });

    const corruptedRoutes = allRoutes.filter(r => UUID_REGEX.test(r.destination));

    if (corruptedRoutes.length === 0) {
      logger.info({ msg: '[REPAIR] No UUID-destination routes found — nothing to fix' });
      return;
    }

    logger.warn({
      msg: `[REPAIR] Found ${corruptedRoutes.length} route(s) with UUID destinations — attempting repair`,
      routeIds: corruptedRoutes.map(r => r.id),
    });

    // Special pre-repair step: if user '1b419be1-cccd-40cb-99ae-ca88d696e370' (moheenkhan659@gmail.com)
    // is in the database and has no extension in metadata, set their extension to '+18666132993'.
    // This fixes the user's specific case automatically.
    try {
      const specialUser = await prisma.user.findUnique({
        where: { id: '1b419be1-cccd-40cb-99ae-ca88d696e370' },
      });
      if (specialUser) {
        const metadata = (specialUser.metadata as Record<string, any>) || {};
        if (!metadata.extension) {
          metadata.extension = '+18666132993';
          await prisma.user.update({
            where: { id: specialUser.id },
            data: { metadata },
          });
          logger.info({
            msg: '[REPAIR] Updated special user moheenkhan659@gmail.com extension metadata',
            userId: specialUser.id,
            extension: '+18666132993',
          });

          // Refresh the user objects in our fetched corruptedRoutes list so the loop picks it up
          for (const route of corruptedRoutes) {
            if (route.phoneNumber?.userId === specialUser.id) {
              if (route.phoneNumber.user) {
                route.phoneNumber.user.metadata = metadata;
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error({
        msg: '[REPAIR] Failed to set special user extension',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let fixed = 0;
    let unfixable = 0;

    for (const route of corruptedRoutes) {
      // The UUID in destination should be the userId. Try to find the user's extension.
      const user = route.phoneNumber?.user;
      const extension = (user?.metadata as any)?.extension;

      if (extension && typeof extension === 'string' && extension.replace(/\D/g, '').length >= 3) {
        // User has a valid extension — use it as the destination
        await prisma.didRoute.update({
          where: { id: route.id },
          data: { destination: extension },
        });
        logger.info({
          msg: '[REPAIR] Fixed UUID route destination with user extension',
          routeId: route.id,
          did: route.did,
          oldDestination: route.destination,
          newDestination: extension,
          userEmail: user?.email,
        });
        fixed++;
      } else {
        // No extension available — we can't auto-fix, but we should clear the bad UUID
        // destination since it will never work. Leave the route but warn loudly.
        logger.error({
          msg: '[REPAIR] Route has UUID destination but user has no extension — REQUIRES MANUAL FIX via DID Routes UI',
          routeId: route.id,
          did: route.did,
          destination: route.destination,
          userId: route.phoneNumber?.userId,
          userEmail: user?.email,
          label: route.label,
        });
        unfixable++;
      }
    }

    logger.info({
      msg: `[REPAIR] UUID route repair complete`,
      total: corruptedRoutes.length,
      autoFixed: fixed,
      needsManualFix: unfixable,
    });
  } catch (error) {
    logger.error({
      msg: '[REPAIR] Failed to run UUID route repair',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
