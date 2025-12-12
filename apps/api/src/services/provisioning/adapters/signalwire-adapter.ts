import { logger } from '../../../lib/logger.js';
import { secrets } from '../../secrets.js';
import type {
  ProvisioningAdapter,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  NumberFeatures,
  NumberStatus,
} from '../types.js';

/**
 * SignalWire Adapter
 *
 * Implements real SignalWire REST API integration for number provisioning.
 * Documentation: https://developer.signalwire.com/apis/docs/overview
 */
export class SignalWireAdapter implements ProvisioningAdapter {
  readonly provider = 'signalwire' as const;

  private projectId: string;
  private apiToken: string;
  private spaceUrl: string;
  private baseUrl: string;

  constructor() {
    // SignalWire uses Project ID (not "project key") and API Token
    this.projectId = secrets.getRequired('SIGNALWIRE_PROJECT_ID');
    this.apiToken = secrets.getRequired('SIGNALWIRE_API_TOKEN');
    this.spaceUrl = secrets.getRequired('SIGNALWIRE_SPACE_URL');

    // Remove protocol if present, ensure it's just the domain
    const cleanUrl = this.spaceUrl.replace(/^https?:\/\//, '');
    this.baseUrl = `https://${cleanUrl}`;
  }

  isConfigured(): boolean {
    return !!(this.projectId && this.apiToken && this.spaceUrl);
  }

  /**
   * Get authorization header for SignalWire API
   * SignalWire uses Basic Auth with Project ID as username and API Token as password
   */
  private getAuthHeader(): string {
    const credentials = `${this.projectId}:${this.apiToken}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Make authenticated request to SignalWire API
   */
  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new Error(
            `SignalWire rate limit exceeded. Retry after ${retryAfter || '60'} seconds`
          );
        }

        // Handle auth errors
        if (response.status === 401 || response.status === 403) {
          throw new Error('SignalWire authentication failed. Check credentials.');
        }

        throw new Error(
          `SignalWire API error: ${errorData.message || response.statusText} (${response.status})`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`SignalWire API request failed: ${String(error)}`);
    }
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const params = new URLSearchParams();

    if (options?.areaCode) {
      params.append('area_code', options.areaCode);
    }

    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }

    if (options?.offset) {
      params.append('offset', options.offset.toString());
    }

    const queryString = params.toString();
    const endpoint = `/api/relay/rest/phone_numbers${queryString ? `?${queryString}` : ''}`;

    const response = await this.request<{
      data: Array<{
        id: string;
        number: string;
        name: string;
        capabilities: {
          voice?: boolean;
          sms?: boolean;
          mms?: boolean;
          fax?: boolean;
        };
        created_at: string;
      }>;
    }>('GET', endpoint);

    return response.data.map(item => ({
      id: item.id,
      number: item.number,
      provider: 'signalwire',
      status: 'assigned' as NumberStatus, // SignalWire numbers are owned
      features: item.capabilities,
      providerId: item.id,
      purchasedAt: new Date(item.created_at),
      metadata: {
        name: item.name,
      },
    }));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    const body: Record<string, unknown> = {};

    if (request.areaCode) {
      body.area_code = request.areaCode;
    }

    if (request.region) {
      body.region = request.region;
    }

    if (request.country) {
      body.country = request.country;
    } else {
      body.country = 'US';
    }

    // SignalWire capabilities
    if (request.features) {
      const capabilities: string[] = [];
      if (request.features.voice) capabilities.push('voice');
      if (request.features.sms) capabilities.push('sms');
      if (request.features.mms) capabilities.push('mms');
      if (request.features.fax) capabilities.push('fax');
      if (capabilities.length > 0) {
        body.capabilities = capabilities;
      }
    }

    const response = await this.request<{
      id: string;
      number: string;
      name: string;
      capabilities: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
      };
      created_at: string;
    }>('POST', '/api/relay/rest/phone_numbers', body);

    logger.info({ msg: 'Purchased SignalWire number', number: response.number });

    return {
      id: response.id,
      number: response.number,
      provider: 'signalwire',
      status: 'assigned',
      features: response.capabilities,
      providerId: response.id,
      purchasedAt: new Date(response.created_at),
      metadata: {
        name: response.name,
      },
    };
  }

  async releaseNumber(providerId: string): Promise<void> {
    await this.request('DELETE', `/api/relay/rest/phone_numbers/${providerId}`);
    logger.info({ msg: 'Released SignalWire number', providerId });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    try {
      const response = await this.request<{
        id: string;
        number: string;
        name: string;
        capabilities: {
          voice?: boolean;
          sms?: boolean;
          mms?: boolean;
          fax?: boolean;
        };
        created_at: string;
      }>('GET', `/api/relay/rest/phone_numbers/${providerId}`);

      return {
        id: response.id,
        number: response.number,
        provider: 'signalwire',
        status: 'assigned',
        features: response.capabilities,
        providerId: response.id,
        purchasedAt: new Date(response.created_at),
        metadata: {
          name: response.name,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    const capabilities: string[] = [];
    if (features.voice) capabilities.push('voice');
    if (features.sms) capabilities.push('sms');
    if (features.mms) capabilities.push('mms');
    if (features.fax) capabilities.push('fax');

    await this.request('PATCH', `/api/relay/rest/phone_numbers/${providerId}`, {
      capabilities,
    });

    logger.info({ msg: 'Configured SignalWire number', providerId, features });
  }
}
