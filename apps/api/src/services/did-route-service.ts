import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

/**
 * Check if a string looks like a valid phone number destination
 * (as opposed to a UUID or other non-phone identifier).
 * A valid destination contains at least 10 digits, or is a short extension (3-6 digits).
 */
function isValidPhoneDestination(value: string | null | undefined): value is string {
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

      // A DID shared across agencies is routed by its group, not by the
      // number's user or campaign, and is managed on the shared-routing
      // screens. Re-deriving it from the number would undo that -- and an
      // unassigned number would have its route deleted outright.
      const currentRoute = await prisma.didRoute.findFirst({
        where: { phoneNumberId: phoneNumber.id },
        select: { sharedRoutingGroupId: true },
      });
      if (currentRoute?.sharedRoutingGroupId) {
        logger.info({
          msg: 'syncDidRouteForNumber: DID is shared across agencies; leaving its route alone',
          number: phoneNumber.number,
        });
        return;
      }

      const hasCampaign = !!phoneNumber.campaignId;
      const hasUser = !!phoneNumber.userId;

      if ((hasUser || hasCampaign) && phoneNumber.status === 'ACTIVE') {
        let destination = '';
        let label = '';
        const campaignId = phoneNumber.campaignId || null;

        if (phoneNumber.userId) {
          /*
           * The agent's SIP extension, from their `AgentSipCredential` -- the
           * identity their softphone registers as -- reserving the next free
           * one from 1000 upward if they have none. It used to be
           * `users.metadata.extension`, topped up from a scan of every user on
           * the platform capped at 1019. See `reserveExtension`.
           */
          const { reserveExtension } = await import('./telephony/agent-sip-credential.js');
          const extension = await reserveExtension(tenantId, phoneNumber.userId).catch(
            (error: unknown) => {
              logger.error({
                msg: 'syncDidRouteForNumber: could not reserve an extension for the agent',
                userId: phoneNumber.userId,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            }
          );

          // Only use extension if it's a valid phone destination — never fall back to userId
          destination = isValidPhoneDestination(extension) ? extension : '';
          label = `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`;
        } else {
          // A campaign number is routed by the campaign, per call: the FreeSWITCH
          // lookup sees `campaignId` and asks `selectBestBuyer` for the
          // campaign's buyers. The stored destination is only the sentinel that
          // says so. It used to be the hardcoded extensions '1005,1001', which
          // every campaign number then displayed as its destination, and which
          // the lookup rang whenever campaign routing threw -- two extensions of
          // one agency, on every tenant's campaign numbers. `sanitizeDestination`
          // drops 'Campaign', so a failed lookup now plays the no-agent prompt.
          destination = 'Campaign';
          label = 'Auto-routed Campaign';
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
