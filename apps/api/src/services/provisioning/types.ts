/**
 * Provisioning service types and interfaces
 */

export type Provider = 'local' | 'signalwire' | 'telnyx' | 'bandwidth' | 'clec';

export type NumberStatus = 'available' | 'assigned' | 'released' | 'pending' | 'failed';

export interface NumberFeatures {
  voice?: boolean;
  sms?: boolean;
  mms?: boolean;
  fax?: boolean;
}

export interface PurchaseNumberRequest {
  areaCode?: string;
  features?: NumberFeatures;
  country?: string; // ISO country code, default 'US'
  region?: string; // State/region code
}

export interface ProvisionedNumber {
  id: string;
  number: string; // E.164 format
  provider: Provider;
  status: NumberStatus;
  features?: NumberFeatures;
  providerId?: string; // Provider's internal ID for this number
  purchasedAt?: Date;
  releasedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ListNumbersOptions {
  status?: NumberStatus;
  areaCode?: string;
  features?: NumberFeatures;
  limit?: number;
  offset?: number;
}

export interface AssignNumberRequest {
  tenantId: string;
  campaignId: string;
  number: string; // E.164 format
}

export interface AuditResult {
  localNumbers: ProvisionedNumber[];
  providerNumbers: ProvisionedNumber[];
  discrepancies: {
    missingInProvider: ProvisionedNumber[]; // In local DB but not in provider
    missingInLocal: ProvisionedNumber[]; // In provider but not in local DB
    statusMismatch: Array<{
      local: ProvisionedNumber;
      provider: ProvisionedNumber;
    }>;
  };
}

/**
 * Core provisioning adapter interface
 * All provider adapters must implement this interface
 */
export interface ProvisioningAdapter {
  /**
   * Provider identifier
   */
  readonly provider: Provider;

  /**
   * List available or owned numbers from the provider
   */
  listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]>;

  /**
   * Purchase a number from the provider
   */
  purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber>;

  /**
   * Release a number back to the provider
   */
  releaseNumber(providerId: string): Promise<void>;

  /**
   * Get details about a specific number
   */
  getNumber(providerId: string): Promise<ProvisionedNumber | null>;

  /**
   * Configure number features (e.g., SMS, voice)
   */
  configureNumber(providerId: string, features: NumberFeatures): Promise<void>;

  /**
   * Check if the adapter is properly configured
   */
  isConfigured(): boolean;
}

