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

      const hasCampaign = !!phoneNumber.campaignId;
      const hasUser = !!phoneNumber.userId;

      if ((hasUser || hasCampaign) && phoneNumber.status === 'ACTIVE') {
        let destination = '';
        let label = '';
        const campaignId = phoneNumber.campaignId || null;

        if (phoneNumber.userId) {
          let extension = (phoneNumber.user?.metadata as any)?.extension;

          // If user has no extension, dynamically assign a free one from 1000-1019
          if (!isValidPhoneDestination(extension) && phoneNumber.user) {
            const allUsers = await prisma.user.findMany({
              select: { metadata: true },
            });
            const usedExtensions = new Set<string>();
            for (const u of allUsers) {
              const ext = (u.metadata as any)?.extension;
              if (ext) {
                usedExtensions.add(ext.toString().trim());
              }
            }

            let availableExtension: string | null = null;
            for (let extNum = 1000; extNum <= 1019; extNum++) {
              const extStr = extNum.toString();
              if (!usedExtensions.has(extStr)) {
                availableExtension = extStr;
                break;
              }
            }

            if (availableExtension) {
              const currentMetadata = (phoneNumber.user.metadata as Record<string, any>) || {};
              const updatedMetadata = {
                ...currentMetadata,
                extension: availableExtension,
              };

              await prisma.user.update({
                where: { id: phoneNumber.userId },
                data: { metadata: updatedMetadata },
              });

              logger.info({
                msg: 'syncDidRouteForNumber: Automatically assigned free extension to user',
                userId: phoneNumber.userId,
                extension: availableExtension,
                phoneNumber: phoneNumber.number,
              });

              extension = availableExtension;
            }
          }

          // Only use extension if it's a valid phone destination — never fall back to userId
          destination = isValidPhoneDestination(extension) ? extension : '';
          label = `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`;
        } else {
          destination = '1005,1001';
          label = `Auto-routed Campaign (Chantal & Khallel)`;
        }

        if (!destination) {
          // If autoDestination is null/empty, delete the route entirely so we don't leave a corrupted route in the database.
          const existingRoute = await prisma.didRoute.findFirst({
            where: { phoneNumberId: phoneNumber.id },
          });
          if (existingRoute) {
            await prisma.didRoute.delete({
              where: { id: existingRoute.id },
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Deleted existing DidRoute with invalid destination and no extension',
              number: phoneNumber.number,
            });
          }
          return;
        }

        const existingRoute = await prisma.didRoute.findFirst({
          where: { phoneNumberId: phoneNumber.id },
        });

        if (existingRoute) {
          // Auto-created routes (label "Auto-routed …") must follow the CURRENT
          // assignment — otherwise reassigning a number keeps ringing the previous
          // owner's extension. Only a route with a human-set label is preserved.
          const isAutoRoute =
            !existingRoute.label || existingRoute.label.startsWith('Auto-routed');
          const shouldUpdateDestination =
            hasCampaign || isAutoRoute || !isValidPhoneDestination(existingRoute.destination);

          const updateData: Record<string, unknown> = {
            status: 'ACTIVE',
            label: isAutoRoute ? label : existingRoute.label || label,
            campaignId: campaignId,
          };

          if (shouldUpdateDestination) {
            updateData.destination = destination;
          }

          await prisma.didRoute.update({
            where: { id: existingRoute.id },
            data: updateData,
          });
          logger.info({
            msg: 'syncDidRouteForNumber: Updated DidRoute',
            number: phoneNumber.number,
            destinationUpdated: !!shouldUpdateDestination,
          });
        } else {
          // No route exists for this phoneNumberId — check for DID-level duplicate
          const duplicate = await prisma.didRoute.findFirst({
            where: { tenantId, did: phoneNumber.number },
          });

          if (duplicate) {
            const isAutoDuplicate =
              !duplicate.label || duplicate.label.startsWith('Auto-routed');
            const shouldUpdateDestination =
              hasCampaign || isAutoDuplicate || !isValidPhoneDestination(duplicate.destination);

            const updateData: Record<string, unknown> = {
              phoneNumberId: phoneNumber.id,
              status: 'ACTIVE',
              label: isAutoDuplicate ? label : duplicate.label || label,
              campaignId: campaignId,
            };

            if (shouldUpdateDestination) {
              updateData.destination = destination;
            }

            await prisma.didRoute.update({
              where: { id: duplicate.id },
              data: updateData,
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Reclaimed duplicate DidRoute',
              number: phoneNumber.number,
              destinationUpdated: !!shouldUpdateDestination,
            });
          } else {
            // Brand new route
            await prisma.didRoute.create({
              data: {
                tenantId,
                phoneNumberId: phoneNumber.id,
                did: phoneNumber.number,
                destination: destination,
                campaignId: campaignId,
                label: label,
                status: 'ACTIVE',
                recordingEnabled: true,
              },
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Created DidRoute',
              number: phoneNumber.number,
              destination,
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
