import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

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
        const destination = extension || phoneNumber.userId;

        const existingRoute = await prisma.didRoute.findFirst({
          where: { phoneNumberId: phoneNumber.id },
        });

        if (existingRoute) {
          await prisma.didRoute.update({
            where: { id: existingRoute.id },
            data: {
              destination,
              status: 'ACTIVE',
              label: `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
            },
          });
          logger.info({
            msg: 'syncDidRouteForNumber: Updated DidRoute',
            number: phoneNumber.number,
            destination,
          });
        } else {
          // Check if duplicate route exists for this DID before creating
          const duplicate = await prisma.didRoute.findFirst({
            where: { tenantId, did: phoneNumber.number },
          });

          if (duplicate) {
            await prisma.didRoute.update({
              where: { id: duplicate.id },
              data: {
                phoneNumberId: phoneNumber.id,
                destination,
                status: 'ACTIVE',
                label: `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
              },
            });
            logger.info({
              msg: 'syncDidRouteForNumber: Reclaimed duplicate DidRoute',
              number: phoneNumber.number,
              destination,
            });
          } else {
            await prisma.didRoute.create({
              data: {
                tenantId,
                phoneNumberId: phoneNumber.id,
                did: phoneNumber.number,
                destination,
                label: `Auto-routed User (${phoneNumber.user?.email || 'Agent'})`,
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
