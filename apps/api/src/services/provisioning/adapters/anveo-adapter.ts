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
 * Anveo Direct Adapter
 *
 * Implements Anveo Direct API integration for number provisioning.
 * API Documentation: https://www.anveo.com/api/
 *
 * Account: 5878751166
 * Auth: API Key based
 * Inbound Routing: Configures DIDs to route to our SIP URI on port 5080
 */
export class AnveoAdapter implements ProvisioningAdapter {
  readonly provider = 'anveo' as const;

  private apiKey: string;
  private baseUrl: string;
  private publicIp: string;

  constructor() {
    this.apiKey = secrets.getRequired('ANVEO_API_KEY');
    this.baseUrl = 'https://www.anveo.com/api';
    this.publicIp = process.env.PUBLIC_IP || '';
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.publicIp);
  }

  /**
   * Make authenticated request to Anveo API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    params?: Record<string, string | number>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    // Anveo uses query params for auth and API calls
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('format', 'json');

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Accept: 'application/json',
        },
      });

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
          throw new Error(`Anveo rate limit exceeded. Retry after ${retryAfter || '60'} seconds`);
        }

        // Handle auth errors
        if (response.status === 401 || response.status === 403) {
          throw new Error('Anveo authentication failed. Check API key.');
        }

        throw new Error(
          `Anveo API error: ${errorData.message || response.statusText} (${response.status})`
        );
      }

      const data = await response.json();

      // Anveo API returns status in response body
      if (data.status === 'error' || data.error) {
        throw new Error(`Anveo API error: ${data.error || data.message || 'Unknown error'}`);
      }

      return data as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Anveo API request failed: ${String(error)}`);
    }
  }

  /**
   * List available DIDs from Anveo inventory
   */
  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const params: Record<string, string | number> = {
      action: 'list_dids',
    };

    if (options?.areaCode) {
      params.npa = options.areaCode;
    }

    if (options?.limit) {
      params.limit = options.limit;
    }

    const response = await this.request<{
      dids?: Array<{
        did: string;
        npa: string;
        nxx: string;
        state: string;
        rate_center: string;
        monthly_cost?: number;
      }>;
    }>('GET', '/v1/dids', params);

    const dids = response.dids || [];

    return dids.map(item => ({
      id: item.did,
      number: `+1${item.did}`,
      provider: 'anveo' as const,
      status: 'available' as NumberStatus,
      features: { voice: true, sms: false },
      providerId: item.did,
      metadata: {
        npa: item.npa,
        nxx: item.nxx,
        state: item.state,
        rateCenter: item.rate_center,
        monthlyCost: item.monthly_cost,
      },
    }));
  }

  /**
   * Purchase a DID from Anveo and configure routing to our SIP URI
   */
  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    const params: Record<string, string | number> = {
      action: 'order_did',
    };

    if (request.areaCode) {
      params.npa = request.areaCode;
    }

    if (request.region) {
      params.state = request.region;
    }

    const response = await this.request<{
      did: string;
      order_id?: string;
      status?: string;
    }>('POST', '/v1/dids', params);

    logger.info({ msg: 'Purchased Anveo DID', did: response.did });

    // Configure the DID to route to our SIP URI
    await this.configureNumber(response.did, { voice: true });

    return {
      id: response.did,
      number: `+1${response.did}`,
      provider: 'anveo',
      status: 'assigned',
      features: { voice: true },
      providerId: response.did,
      purchasedAt: new Date(),
      metadata: {
        orderId: response.order_id,
      },
    };
  }

  /**
   * Release a DID back to Anveo
   */
  async releaseNumber(providerId: string): Promise<void> {
    await this.request('POST', '/v1/dids', {
      action: 'release_did',
      did: providerId,
    });
    logger.info({ msg: 'Released Anveo DID', providerId });
  }

  /**
   * Get details about a specific DID
   */
  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    try {
      const response = await this.request<{
        did: string;
        status?: string;
        routing?: string;
        npa?: string;
        nxx?: string;
      }>('GET', '/v1/dids', {
        action: 'get_did',
        did: providerId,
      });

      return {
        id: response.did,
        number: `+1${response.did}`,
        provider: 'anveo',
        status: response.status === 'active' ? 'assigned' : ('pending' as NumberStatus),
        features: { voice: true },
        providerId: response.did,
        metadata: {
          routing: response.routing,
          npa: response.npa,
          nxx: response.nxx,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Configure DID routing to our FreeSWITCH SIP URI
   *
   * Routes calls to SIP/{E164}@{PUBLIC_IP}:5080 (external profile)
   */
  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    // Format: SIP/+1XXXXXXXXXX@IP:5080
    const e164Number = providerId.startsWith('+') ? providerId : `+1${providerId}`;
    const sipUri = `SIP/${e164Number}@${this.publicIp}:5080`;

    await this.request('POST', '/v1/dids', {
      action: 'set_did_routing',
      did: providerId,
      routing_type: 'sip',
      routing_value: sipUri,
    });

    logger.info({
      msg: 'Configured Anveo DID routing',
      providerId,
      sipUri,
      features,
    });
  }
}
