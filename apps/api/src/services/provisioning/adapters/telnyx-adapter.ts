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
 * Telnyx Adapter
 *
 * Implements real Telnyx REST API integration for number provisioning.
 * Documentation: https://developers.telnyx.com/docs/api/v2/telephony
 */
export class TelnyxAdapter implements ProvisioningAdapter {
  readonly provider = 'telnyx' as const;

  private apiKey: string;
  private baseUrl = 'https://api.telnyx.com/v2';
  private defaultConnectionId: string;

  constructor() {
    this.apiKey = secrets.getRequired('TELNYX_API_KEY');
    // Connection ID is required for inbound routing to our edge
    this.defaultConnectionId = secrets.getRequired('TELNYX_CONNECTION_ID');
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.defaultConnectionId);
  }

  private getAuthHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    let url = `${this.baseUrl}${endpoint}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value) searchParams.append(key, value);
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
          errorData = JSON.parse(errorText) as { errors?: Array<{ detail?: string }> };
        } catch {
          errorData = { errors: [{ detail: errorText }] };
        }

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          throw new Error(`Telnyx rate limit exceeded. Retry after ${retryAfter || '60'} seconds`);
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error('Telnyx authentication failed. Check credentials.');
        }

        const message = errorData.errors?.[0]?.detail || response.statusText;
        throw new Error(`Telnyx API error: ${message} (${response.status})`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Telnyx API request failed: ${String(error)}`);
    }
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const params: Record<string, string> = {
      'page[size]': (options?.limit || 20).toString(),
      'page[number]': options?.offset
        ? Math.floor(options.offset / (options.limit || 20) + 1).toString()
        : '1',
    };

    if (options?.areaCode) {
      // Filter by phone_number contains for area code
      params['filter[phone_number][contains]'] = options.areaCode;
    }

    const response = await this.request<{
      data: Array<{
        id: string;
        phone_number: string;
        status: string;
        connection_id: string;
        created_at: string;
        tags: string[];
      }>;
    }>('GET', '/phone_numbers', undefined, params);

    return response.data.map(item => ({
      id: item.id,
      number: item.phone_number,
      provider: 'telnyx',
      status: this.mapStatus(item.status),
      features: {
        voice: true, // Telnyx numbers generally support voice/sms
        sms: true,
        mms: true,
      },
      providerId: item.id,
      purchasedAt: new Date(item.created_at),
      metadata: {
        connectionId: item.connection_id,
        tags: item.tags,
      },
    }));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    // 1. Search for available number
    const searchParams: Record<string, string> = {
      'filter[country_code]': request.country || 'US',
      'filter[limit]': '1',
    };

    if (request.areaCode) {
      searchParams['filter[national_destination_code]'] = request.areaCode;
    }

    if (request.region) {
      searchParams['filter[region]'] = request.region;
    }

    // Filter by features if possible
    if (request.features?.voice) searchParams['filter[features][]'] = 'voice';
    if (request.features?.sms) searchParams['filter[features][]'] = 'sms';

    const searchResponse = await this.request<{
      data: Array<{
        phone_number: string;
        region_information: {
          region_name: string;
          region_code: string;
        };
      }>;
    }>('GET', '/available_phone_numbers', undefined, searchParams);

    if (!searchResponse.data || searchResponse.data.length === 0) {
      throw new Error(`No available numbers found for area code ${request.areaCode}`);
    }

    const selectedNumber = searchResponse.data[0];
    const phoneNumber = selectedNumber.phone_number;

    // 2. Purchase the number and assign to connection (inbound routing)
    const purchaseBody: Record<string, unknown> = {
      phone_number: phoneNumber,
      connection_id: this.defaultConnectionId,
    };

    const purchaseResponse = await this.request<{
      data: {
        id: string;
        phone_number: string;
        status: string;
        connection_id: string;
        created_at: string;
      };
    }>('POST', '/phone_numbers', purchaseBody);

    logger.info({ msg: 'Purchased Telnyx number', number: phoneNumber });

    return {
      id: purchaseResponse.data.id,
      number: purchaseResponse.data.phone_number,
      provider: 'telnyx',
      status: 'assigned',
      features: request.features || { voice: true, sms: true },
      providerId: purchaseResponse.data.id,
      purchasedAt: new Date(purchaseResponse.data.created_at),
      metadata: {
        connectionId: purchaseResponse.data.connection_id,
        region: selectedNumber.region_information?.region_name,
      },
    };
  }

  async releaseNumber(providerId: string): Promise<void> {
    await this.request('DELETE', `/phone_numbers/${providerId}`);
    logger.info({ msg: 'Released Telnyx number', providerId });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    try {
      const response = await this.request<{
        data: {
          id: string;
          phone_number: string;
          status: string;
          connection_id: string;
          created_at: string;
          tags: string[];
        };
      }>('GET', `/phone_numbers/${providerId}`);

      return {
        id: response.data.id,
        number: response.data.phone_number,
        provider: 'telnyx',
        status: this.mapStatus(response.data.status),
        features: { voice: true, sms: true },
        providerId: response.data.id,
        purchasedAt: new Date(response.data.created_at),
        metadata: {
          connectionId: response.data.connection_id,
          tags: response.data.tags,
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
    // Ensure the number is routed to our edge via the default connection ID
    // This satisfies the "configure inbound routing" requirement
    const updateBody: Record<string, unknown> = {
      connection_id: this.defaultConnectionId,
    };

    // We could also update tags based on features if needed
    // const tags = [];
    // if (features.voice) tags.push('voice');
    // if (features.sms) tags.push('sms');
    // updateBody.tags = tags;

    await this.request('PATCH', `/phone_numbers/${providerId}`, updateBody);

    logger.info({
      msg: 'Configured Telnyx number routing',
      providerId,
      connectionId: this.defaultConnectionId,
      features,
    });
  }

  private mapStatus(telnyxStatus: string): NumberStatus {
    switch (telnyxStatus) {
      case 'active':
        return 'assigned';
      case 'purchase-pending':
        return 'pending';
      case 'deleted':
        return 'released';
      default:
        return 'assigned';
    }
  }
}
