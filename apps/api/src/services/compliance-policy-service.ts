import { getPrismaClient } from '../lib/prisma.js';

export interface CompliancePolicyConfig {
  enforceDnc: boolean;
  enforceConsent: boolean;
  allowOverride: boolean;
  requireAdminApproval: boolean;
}

export class CompliancePolicyService {
  private prisma = getPrismaClient();

  /**
   * Get active compliance policy for tenant
   */
  async getPolicy(tenantId: string, policyName: string = 'default'): Promise<CompliancePolicyConfig | null> {
    const policy = await this.prisma.compliancePolicy.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: policyName,
        },
      },
    });

    if (!policy) {
      return null;
    }

    return {
      enforceDnc: policy.enforceDnc,
      enforceConsent: policy.enforceConsent,
      allowOverride: policy.allowOverride,
      requireAdminApproval: policy.requireAdminApproval,
    };
  }

  /**
   * Get default policy (if no custom policy exists)
   */
  getDefaultPolicy(): CompliancePolicyConfig {
    return {
      enforceDnc: true,
      enforceConsent: true,
      allowOverride: false,
      requireAdminApproval: true,
    };
  }

  /**
   * Get effective policy for tenant
   */
  async getEffectivePolicy(tenantId: string, policyName: string = 'default'): Promise<CompliancePolicyConfig> {
    const policy = await this.getPolicy(tenantId, policyName);
    return policy || this.getDefaultPolicy();
  }
}

export const compliancePolicyService = new CompliancePolicyService();

