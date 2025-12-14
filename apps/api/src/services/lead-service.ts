/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Lead Service - Handles CRM lead lookups for Screen Pop functionality
 *
 * NOTE: This file uses 'any' types because the Lead/LeadCall models
 * are defined in schema.prisma but not yet migrated. After running:
 *   npx prisma migrate dev --name add_lead_model
 *   npx prisma generate
 * These types will be properly typed.
 */
import { getPrismaClient } from '../lib/prisma.js';

// Lead type definition (matches Prisma schema)
// This will be replaced by the generated Prisma type after migration
interface LeadData {
  id: string;
  tenantId: string;
  campaignId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  phoneNumber: string;
  email?: string | null;
  company?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  leadSource?: string | null;
  status: string;
  priority: number;
  customFields?: Record<string, unknown> | null;
  notes?: string | null;
  tags: string[];
  assignedToId?: string | null;
  lastContactedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Included relations
  campaign?: { id: string; name: string } | null;
  assignedTo?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email: string;
  } | null;
}

export class LeadService {
  private get prisma() {
    return getPrismaClient() as any;
  }

  /**
   * Look up a lead by phone number for screen pop
   * Returns the lead data to display when an incoming call arrives
   */
  async lookupByPhone(tenantId: string, phoneNumber: string): Promise<LeadData | null> {
    // Normalize phone number to E.164 format
    const normalized = this.normalizePhoneNumber(phoneNumber);

    try {
      const lead = await this.prisma.lead.findUnique({
        where: {
          tenantId_phoneNumber: {
            tenantId,
            phoneNumber: normalized,
          },
        },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return lead as LeadData | null;
    } catch {
      // Lead table doesn't exist yet (pre-migration)
      return null;
    }
  }

  /**
   * Get screen pop data format for the frontend
   */
  async getScreenPopData(
    tenantId: string,
    phoneNumber: string
  ): Promise<Record<string, unknown> | null> {
    const lead = await this.lookupByPhone(tenantId, phoneNumber);

    if (!lead) {
      return null;
    }

    // Format for screen pop display
    return {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
      phoneNumber: lead.phoneNumber,
      email: lead.email,
      company: lead.company,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zipCode: lead.zipCode,
      country: lead.country,
      leadSource: lead.leadSource,
      status: lead.status,
      priority: lead.priority,
      notes: lead.notes,
      tags: lead.tags,
      customFields: lead.customFields,
      campaignId: lead.campaignId,
      campaignName: lead.campaign?.name,
      assignedToId: lead.assignedToId,
      assignedToName: lead.assignedTo
        ? `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim()
        : null,
      lastContactedAt: lead.lastContactedAt,
      createdAt: lead.createdAt,
    };
  }

  /**
   * Create or update a lead
   */
  async upsert(
    tenantId: string,
    data: {
      phoneNumber: string;
      firstName?: string;
      lastName?: string;
      fullName?: string;
      email?: string;
      company?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
      leadSource?: string;
      campaignId?: string;
      assignedToId?: string;
      customFields?: Record<string, unknown>;
      notes?: string;
      tags?: string[];
    }
  ): Promise<LeadData> {
    const normalized = this.normalizePhoneNumber(data.phoneNumber);
    const { phoneNumber: _, ...restData } = data;
    void _; // Destructured to remove from restData

    return await this.prisma.lead.upsert({
      where: {
        tenantId_phoneNumber: {
          tenantId,
          phoneNumber: normalized,
        },
      },
      create: {
        tenantId,
        phoneNumber: normalized,
        ...restData,
      },
      update: {
        ...restData,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Mark lead as contacted (update lastContactedAt)
   */
  async markContacted(tenantId: string, phoneNumber: string): Promise<void> {
    const normalized = this.normalizePhoneNumber(phoneNumber);

    try {
      await this.prisma.lead.updateMany({
        where: {
          tenantId,
          phoneNumber: normalized,
        },
        data: {
          lastContactedAt: new Date(),
          status: 'CONTACTED',
        },
      });
    } catch {
      // Lead table doesn't exist yet (pre-migration)
    }
  }

  /**
   * Link a call to a lead
   */
  async linkCall(leadId: string, callId: string): Promise<void> {
    try {
      await this.prisma.leadCall.create({
        data: {
          leadId,
          callId,
        },
      });
    } catch {
      // LeadCall table doesn't exist yet (pre-migration)
    }
  }

  /**
   * Normalize phone number to E.164 format
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters except leading +
    let normalized = phoneNumber.replace(/[^\d+]/g, '');

    // If doesn't start with +, assume US number
    if (!normalized.startsWith('+')) {
      // If starts with 1 and is 11 digits, just add +
      if (normalized.startsWith('1') && normalized.length === 11) {
        normalized = '+' + normalized;
      }
      // If 10 digits, add +1
      else if (normalized.length === 10) {
        normalized = '+1' + normalized;
      }
      // Otherwise just add + prefix
      else {
        normalized = '+' + normalized;
      }
    }

    return normalized;
  }
}

// Singleton instance
export const leadService = new LeadService();
