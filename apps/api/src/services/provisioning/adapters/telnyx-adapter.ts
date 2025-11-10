import { logger } from '../../lib/logger.js';
import type {
  ProvisioningAdapter,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  NumberFeatures,
} from '../types.js';

/**
 * Telnyx Adapter (Placeholder)
 * 
 * Placeholder implementation for Telnyx number provisioning.
 * TODO: Implement real Telnyx API integration
 * Documentation: https://developers.telnyx.com/docs/api/v2/telephony
 */
export class TelnyxAdapter implements ProvisioningAdapter {
  readonly provider = 'telnyx' as const;

  isConfigured(): boolean {
    // TODO: Check for Telnyx API key
    return false;
  }

  async listNumbers(_options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    logger.warn('Telnyx adapter not yet implemented');
    throw new Error('Telnyx adapter not yet implemented');
  }

  async purchaseNumber(_request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    logger.warn('Telnyx adapter not yet implemented');
    throw new Error('Telnyx adapter not yet implemented');
  }

  async releaseNumber(_providerId: string): Promise<void> {
    logger.warn('Telnyx adapter not yet implemented');
    throw new Error('Telnyx adapter not yet implemented');
  }

  async getNumber(_providerId: string): Promise<ProvisionedNumber | null> {
    logger.warn('Telnyx adapter not yet implemented');
    throw new Error('Telnyx adapter not yet implemented');
  }

  async configureNumber(_providerId: string, _features: NumberFeatures): Promise<void> {
    logger.warn('Telnyx adapter not yet implemented');
    throw new Error('Telnyx adapter not yet implemented');
  }
}

