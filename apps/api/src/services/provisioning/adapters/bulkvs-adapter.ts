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
 * BulkVS Adapter
 *
 * Implements BulkVS API integration for number provisioning.
 * API Documentation: https://portal.bulkvs.com/api/v1.0/documentation
 *
 * Auth: HTTP Basic Auth (API Username + API Password from BulkVS Portal → API → API Credentials)
 *
 * Key endpoints:
 *   GET  /orderTn   — Search available DIDs by NPA or NPANXX
 *   POST /orderTn   — Purchase/order a DID
 *   GET  /tnRecord  — Query existing telephone number records
 *   POST /tnRecord  — Update routing for a telephone number
 *   DELETE /tnRecord — Delete/release a telephone number
 */
export class BulkvsAdapter implements ProvisioningAdapter {
  readonly provider = 'bulkvs' as const;

  private username?: string;
  private password?: string;
  private baseUrl: string;
  private trunkGroup?: string;

  constructor() {
    this.username = process.env.BULKVS_USERNAME || secrets.get('BULKVS_USERNAME');
    this.password = process.env.BULKVS_PASSWORD || secrets.get('BULKVS_PASSWORD');
    this.baseUrl = 'https://portal.bulkvs.com/api/v1.0';
    // Trunk group name — required for POST /orderTn to route the number
    this.trunkGroup = process.env.BULKVS_TRUNK_GROUP || secrets.get('BULKVS_TRUNK_GROUP');
  }

  isConfigured(): boolean {
    return !!(this.username && this.password);
  }

  /**
   * Make authenticated request to BulkVS API
   * 
   * Uses HTTP Basic Auth per the BulkVS API documentation.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<T> {
    if (!this.username || !this.password) {
      throw new Error('BulkVS credentials not configured');
    }

    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    };

    // Build URL with query params
    let fetchUrl = `${this.baseUrl}${endpoint}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== '') {
          params.append(key, value);
        }
      }
      const qs = params.toString();
      if (qs) {
        fetchUrl = `${fetchUrl}?${qs}`;
      }
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    logger.debug({
      msg: 'BulkVS API request',
      method,
      url: fetchUrl,
      hasBody: !!body,
    });

    try {
      const response = await fetch(fetchUrl, options);

      // Read the raw response body
      const responseText = await response.text();

      if (!response.ok) {
        let errorData: { message?: string } = {};
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { message: responseText };
        }

        logger.error({
          msg: 'BulkVS API error response',
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          url: fetchUrl,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error('BulkVS authentication failed. Check API credentials in BulkVS Portal → API → API Credentials.');
        }

        throw new Error(
          `BulkVS API error: ${errorData.message || response.statusText} (${response.status})`
        );
      }

      // Parse JSON response — handle empty responses (e.g. from DELETE)
      if (!responseText || responseText.trim() === '') {
        return {} as T;
      }

      try {
        const data = JSON.parse(responseText);
        return data as T;
      } catch {
        // If response is not JSON, return as-is wrapped
        return { raw: responseText } as T;
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`BulkVS API request failed: ${String(error)}`);
    }
  }

  /**
   * List available DIDs from BulkVS inventory
   *
   * Uses: GET /orderTn?npa=XXX or GET /orderTn?npanxx=XXXXXX
   *
   * The BulkVS API returns an array of available numbers with fields:
   *   TN, RateCenter, State, Tier (and possibly others)
   */
  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const queryParams: Record<string, string> = {};

    if (options?.areaCode) {
      // BulkVS supports both 3-digit NPA and 6-digit NPANXX
      if (options.areaCode.length <= 3) {
        queryParams.npa = options.areaCode;
      } else {
        queryParams.npanxx = options.areaCode;
      }
    }

    let response: unknown;
    try {
      response = await this.request<unknown>('GET', '/orderTn', undefined, queryParams);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('404') || error.message.includes('No telephone numbers'))
      ) {
        return [];
      }
      throw error;
    }

    logger.debug({
      msg: 'BulkVS listNumbers raw response',
      responseType: typeof response,
      isArray: Array.isArray(response),
    });

    // Parse the response — BulkVS may return:
    //   - Direct array of number objects
    //   - Object with array in a known field
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(response)) {
      items = response;
    } else if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      // Try common wrapper field names
      if (Array.isArray(resp.data)) {
        items = resp.data;
      } else if (Array.isArray(resp.records)) {
        items = resp.records;
      } else if (Array.isArray(resp.tns)) {
        items = resp.tns;
      } else if (Array.isArray(resp.TNs)) {
        items = resp.TNs;
      } else if (Array.isArray(resp.Results)) {
        items = resp.Results;
      } else {
        // If the response is a single object, it might be a single result
        // or the whole response is the result set — log and return empty
        logger.warn({
          msg: 'BulkVS unexpected response format for listNumbers',
          responseKeys: Object.keys(resp),
          response: resp,
        });
        return [];
      }
    }

    return items
      .map((item: Record<string, unknown>) => {
        // BulkVS uses uppercase field names: TN, RateCenter, State, Tier
        const did =
          (item.TN as string) ||
          (item.Tn as string) ||
          (item.tn as string) ||
          (item.number as string) ||
          (item.did as string) ||
          (item.telephoneNumber as string);

        if (!did) {
          logger.debug({ msg: 'BulkVS item missing TN field', itemKeys: Object.keys(item) });
          return null;
        }

        // Normalize to E.164 format
        const cleanDid = did.replace(/\D/g, '');
        const e164 = cleanDid.startsWith('1') ? `+${cleanDid}` : `+1${cleanDid}`;

        return {
          id: cleanDid,
          number: e164,
          provider: 'bulkvs' as const,
          status: 'available' as NumberStatus,
          features: { voice: true, sms: false },
          providerId: cleanDid,
          metadata: {
            npa: (item.Npa as string) || (item.npa as string) || cleanDid.substring(cleanDid.length === 11 ? 1 : 0, cleanDid.length === 11 ? 4 : 3),
            rateCenter:
              (item.RateCenter as string) ||
              (item['Rate Center'] as string) ||
              (item.rateCenter as string) ||
              (item.ratecenter as string),
            state: (item.State as string) || (item.state as string),
            tier: (item.Tier as string) || (item.tier as string),
          },
        };
      })
      .filter(Boolean) as ProvisionedNumber[];
  }

  /**
   * Purchase a DID from BulkVS
   *
   * Uses: POST /orderTn
   * Body: { "TN": "15550101234" }
   * Optional: { "TN": "15550101234", "trunkGroup": "YourTrunkGroup" }
   */
  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    let tnToOrder = request.number;

    if (!tnToOrder) {
      if (!request.areaCode) {
        throw new Error('Area code or specific number is required to purchase a BulkVS number');
      }

      // Search for available numbers first
      const searchResponse = await this.listNumbers({ areaCode: request.areaCode });
      if (searchResponse.length === 0) {
        throw new Error(`No BulkVS numbers available for area code ${request.areaCode}`);
      }

      tnToOrder = searchResponse[0].providerId!;
    }

    // Strip any non-digit characters and ensure 10 or 11 digit format
    const cleanTn = tnToOrder.replace(/\D/g, '');
    // BulkVS typically expects 10-digit or 11-digit (with leading 1) TN
    const tn = cleanTn.length === 11 && cleanTn.startsWith('1') ? cleanTn : cleanTn.length === 10 ? `1${cleanTn}` : cleanTn;

    // Build the order payload per BulkVS API docs
    const orderPayload: Record<string, unknown> = {
      TN: tn,
    };

    // Include trunk group if configured
    if (this.trunkGroup) {
      orderPayload.trunkGroup = this.trunkGroup;
    }

    logger.info({
      msg: 'Ordering DID from BulkVS',
      tn,
      hasTrunkGroup: !!this.trunkGroup,
    });

    await this.request('POST', '/orderTn', orderPayload);

    logger.info({ msg: 'Purchased BulkVS DID', did: tn });

    const e164 = tn.startsWith('1') ? `+${tn}` : `+1${tn}`;

    return {
      id: tn,
      number: e164,
      provider: 'bulkvs',
      status: 'assigned',
      features: { voice: true },
      providerId: tn,
      purchasedAt: new Date(),
      metadata: {},
    };
  }

  /**
   * Release a DID back to BulkVS
   *
   * Uses: DELETE /tnRecord with TN parameter
   */
  async releaseNumber(providerId: string): Promise<void> {
    const cleanTn = providerId.replace(/\D/g, '');

    await this.request('DELETE', '/tnRecord', undefined, { TN: cleanTn });

    logger.info({ msg: 'Released BulkVS DID', providerId: cleanTn });
  }

  /**
   * Get details about a specific DID
   *
   * Uses: GET /tnRecord?TN=XXXXXXXXXX
   */
  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    const cleanTn = providerId.replace(/\D/g, '');

    try {
      const response = await this.request<Record<string, unknown>>(
        'GET',
        '/tnRecord',
        undefined,
        { TN: cleanTn }
      );

      const e164 = cleanTn.startsWith('1') ? `+${cleanTn}` : `+1${cleanTn}`;

      return {
        id: cleanTn,
        number: e164,
        provider: 'bulkvs',
        status: 'assigned',
        features: { voice: true },
        providerId: cleanTn,
        metadata: response || {},
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('not found') || error.message.includes('404'))
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Configure DID routing
   *
   * Uses: POST /tnRecord to update routing for a telephone number
   */
  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    const cleanTn = providerId.replace(/\D/g, '');

    // Build update payload for tnRecord
    const updatePayload: Record<string, unknown> = {
      TN: cleanTn,
    };

    // If trunk group is configured, set routing
    if (this.trunkGroup) {
      updatePayload.trunkGroup = this.trunkGroup;
    }

    try {
      await this.request('POST', '/tnRecord', updatePayload);

      logger.info({
        msg: 'Configured BulkVS DID routing',
        providerId: cleanTn,
        features,
        trunkGroup: this.trunkGroup,
      });
    } catch (error) {
      logger.warn({
        msg: 'Failed to configure BulkVS DID routing (non-fatal)',
        providerId: cleanTn,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw — routing configuration is best-effort
      // The number is still usable even if routing config fails
    }
  }
}
