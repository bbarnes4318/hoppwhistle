import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

/**
 * Check if a string looks like a valid phone number destination
 * (as opposed to a UUID or other non-phone identifier).
 * A valid destination contains at least 10 digits, or is a short extension (3-6 digits).
 */
function isValidPhoneDestination(value: string | null | undefined): boolean {
  if (!value) return false;
  // UUIDs match this pattern — reject them
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return false;
  }
  // Must contain digits and look like a phone number or extension
  const digits = value.replace(/\D/g, '');
  return digits.length >= 3;
}

export class DidRouteService {
  async syncDidRouteForNumber(phoneNumberId: string, tenantId: string): Promise<void> {
    const prisma = getPrismaClient();
    try {
      const phoneNumber = await prisma.phoneNumber.findUnique({
        where: { id: phoneNumberId },
        include: { user: true },
      });

      if (!phoneNumber) {
        logger.warn({ msg: 'syncDidRouteForNumber: Phone number not found', phoneNumberId });
        return;
      }

      if (phoneNumber.userId && phoneNumber.status === 'ACTIVE') {
        const extension = (phoneNumber.user?.metadata as any)?.extension;
        // Only use extension if it's a valid phone destination — never fall back to userId
        const autoDestination = isValidPhoneDestination(extension) ? extension : null;

        const existingRoute = await prisma.didRoute.findFirst({
          where: { phoneNumberId: phoneNumber.id },
        });

        if (existingRoute) {
          // If autoDestination is null and the existing route has an invalid destination (e.g. UUID),
          // delete the route entirely so we don't leave a corrupted route in the database.
          if (!autoDestination && !isValidPhoneDestination(existingRoute.destination)) {
            await prisma.didRoute.delete({
              where: { id: existingRoute.id },
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Deleted existing DidRoute with invalid destination and no extension',
              number: phoneNumber.number,
              invalidDestination: existingRoute.destination,
            });
            return;
          }

          // If the route already has a valid destination (manually configured),
          // do NOT overwrite it — only update status and label
          const shouldUpdateDestination =
            autoDestination && !isValidPhoneDestination(existingRoute.destination);

          const updateData: Record<string, unknown> = {
            status: 'ACTIVE',
            label: existingRoute.label || `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
          };

          if (shouldUpdateDestination) {
            updateData.destination = autoDestination;
          }

          await prisma.didRoute.update({
            where: { id: existingRoute.id },
            data: updateData,
          });
          logger.info({
            msg: 'syncDidRouteForNumber: Updated DidRoute (preserved existing destination)',
            number: phoneNumber.number,
            existingDestination: existingRoute.destination,
            autoDestination,
            destinationUpdated: !!shouldUpdateDestination,
          });
        } else {
          // No route exists for this phoneNumberId — check for DID-level duplicate
          const duplicate = await prisma.didRoute.findFirst({
            where: { tenantId, did: phoneNumber.number },
          });

          if (duplicate) {
            // If autoDestination is null and the duplicate route has an invalid destination (e.g. UUID),
            // delete the duplicate route entirely.
            if (!autoDestination && !isValidPhoneDestination(duplicate.destination)) {
              await prisma.didRoute.delete({
                where: { id: duplicate.id },
              });
              logger.info({
                msg: 'syncDidRouteForNumber: Deleted duplicate DidRoute with invalid destination and no extension',
                number: phoneNumber.number,
                invalidDestination: duplicate.destination,
              });
              return;
            }

            // A route already exists for this DID — preserve its destination if valid
            const shouldUpdateDestination =
              autoDestination && !isValidPhoneDestination(duplicate.destination);

            const updateData: Record<string, unknown> = {
              phoneNumberId: phoneNumber.id,
              status: 'ACTIVE',
              label: duplicate.label || `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
            };

            if (shouldUpdateDestination) {
              updateData.destination = autoDestination;
            }

            await prisma.didRoute.update({
              where: { id: duplicate.id },
              data: updateData,
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Reclaimed duplicate DidRoute (preserved destination)',
              number: phoneNumber.number,
              existingDestination: duplicate.destination,
              autoDestination,
              destinationUpdated: !!shouldUpdateDestination,
            });
          } else if (autoDestination) {
            // Brand new route — only create if we have a valid destination
            await prisma.didRoute.create({
              data: {
                tenantId,
                phoneNumberId: phoneNumber.id,
                did: phoneNumber.number,
                destination: autoDestination,
                label: `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
                status: 'ACTIVE',
                recordingEnabled: true,
              },
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Created DidRoute',
              number: phoneNumber.number,
              destination: autoDestination,
            });
          } else {
            // No valid auto-destination and no existing route — skip creating
            logger.info({
              msg: 'syncDidRouteForNumber: Skipped — no valid destination available (user has no extension)',
              number: phoneNumber.number,
              userId: phoneNumber.userId,
            });
          }
        }
      } else {
        // Unassigned or inactive - delete/disable DidRoute
        const existingRoute = await prisma.didRoute.findFirst({
          where: { phoneNumberId: phoneNumber.id },
        });

        if (existingRoute) {
          await prisma.didRoute.delete({
            where: { id: existingRoute.id },
          });
          logger.info({
            msg: 'syncDidRouteForNumber: Deleted unassigned DidRoute',
            number: phoneNumber.number,
          });
        }
      }
    } catch (error) {
      logger.error({
        msg: 'syncDidRouteForNumber: Failed to sync DidRoute',
        phoneNumberId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const didRouteService = new DidRouteService();
