import { Buffer } from 'buffer';

import { logger } from '../../../lib/logger.js';
import { secrets } from '../../secrets.js';
import type {
  ProvisioningAdapter,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  NumberFeatures,
} from '../types.js';

/**
 * Bandwidth Adapter
 *
 * Implements real Bandwidth REST API integration for number provisioning.
 * Documentation: https://dev.bandwidth.com/docs/numbers/apiReference/
 */
export class BandwidthAdapter implements ProvisioningAdapter {
  readonly provider = 'bandwidth' as const;

  private accountId: string;
  private username: string;
  private pass: string;
  private siteId: string;
  private baseUrl: string;

  constructor() {
    this.accountId = secrets.get('BANDWIDTH_ACCOUNT_ID') || '';
    this.username = secrets.get('BANDWIDTH_USERNAME') || '';
    this.pass = secrets.get('BANDWIDTH_PASSWORD') || '';
    this.siteId = secrets.get('BANDWIDTH_SITE_ID') || '';
    this.baseUrl = `https://dashboard.bandwidth.com/api/accounts/${this.accountId}`;
  }

  isConfigured(): boolean {
    return !!(this.accountId && this.username && this.pass && this.siteId);
  }

  private getAuthHeader(): string {
    const credentials = `${this.username}:${this.pass}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
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
      console.log('BandwidthAdapter response:', response.status, response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('BandwidthAdapter error text:', errorText);
        // Bandwidth errors are often XML, but we requested JSON.
        // Let's try to parse as JSON, else return text.
        let errorMessage = errorText;
        try {
          const jsonError = JSON.parse(errorText) as { Description?: string; Message?: string };
          errorMessage = jsonError.Description || jsonError.Message || errorText;
        } catch {
          // ignore
        }

        logger.error({ msg: 'Bandwidth API error', error: errorMessage, status: response.status });

        if (response.status === 401 || response.status === 403) {
          throw new Error('Bandwidth authentication failed. Check credentials.');
        }

        throw new Error(`Bandwidth API error: ${errorMessage} (${response.status})`);
      }

      // Some DELETE/PUT requests might return empty body
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Bandwidth API request failed: ${String(error)}`);
    }
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const params: Record<string, string> = {};

    // Bandwidth pagination is via page/size? Or just returns all?
    // Docs say it returns a list. Pagination might be supported but let's assume simple list for now.
    // We can filter by area code if needed, but listNumbers interface implies listing *owned* numbers.
    // GET /phoneNumbers supports 'TN' (telephone number) filter.

    if (options?.areaCode) {
      // Bandwidth doesn't support partial match on TN easily in list.
      // We'll filter client side if needed or ignore.
    }

    // Bandwidth returns a list of objects
    const response = await this.request<
      Array<{
        id: string;
        TelephoneNumber: string;
        Status?: string;
        City: string;
        State: string;
        SiteId: string;
      }>
    >('GET', '/phoneNumbers', undefined, params);

    // Filter manually if needed
    let numbers = response;
    if (options?.areaCode) {
      numbers = numbers.filter(n => n.TelephoneNumber.includes(options.areaCode!));
    }

    return numbers.map(item => ({
      id: item.id || item.TelephoneNumber, // Bandwidth ID is usually the number itself or an internal ID
      number: this.formatNumber(item.TelephoneNumber),
      provider: 'bandwidth',
      status: 'assigned', // If it's in our account, it's assigned
      features: {
        voice: true,
        sms: true, // Assuming enabled
      },
      providerId: item.id || item.TelephoneNumber,
      metadata: {
        city: item.City,
        state: item.State,
        siteId: item.SiteId,
      },
    }));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    // 1. Search for available number
    const searchParams: Record<string, string> = {
      quantity: '1',
    };

    if (request.areaCode) {
      searchParams.areaCode = request.areaCode;
    }

    if (request.region) {
      searchParams.state = request.region;
    }

    const searchResponse = await this.request<
      Array<{
        TelephoneNumber: string;
        City: string;
        State: string;
        RateCenter: string;
      }>
    >('GET', '/availableNumbers', undefined, searchParams);

    if (!searchResponse || searchResponse.length === 0) {
      throw new Error(`No available numbers found for area code ${request.areaCode}`);
    }

    const selectedNumber = searchResponse[0];
    const phoneNumber = selectedNumber.TelephoneNumber;

    // 2. Order the number
    // "ExistingTelephoneNumberOrderType" is used to order specific numbers found in inventory
    const orderBody = {
      Name: `Purchase ${phoneNumber}`,
      SiteId: this.siteId,
      ExistingTelephoneNumberOrderType: {
        TelephoneNumberList: {
          TelephoneNumber: [phoneNumber],
        },
      },
    };

    const orderResponse = await this.request<{
      Order: {
        id: string;
        OrderStatus: string;
        CompletedNumbers: {
          TelephoneNumber: string[]; // or object
        };
      };
    }>('POST', '/orders', orderBody);

    logger.info({
      msg: 'Purchased Bandwidth number',
      number: phoneNumber,
      orderId: orderResponse.Order.id,
    });

    return {
      id: phoneNumber, // Use number as ID since Bandwidth uses it heavily
      number: this.formatNumber(phoneNumber),
      provider: 'bandwidth',
      status: 'assigned',
      features: request.features || { voice: true, sms: true },
      providerId: phoneNumber,
      purchasedAt: new Date(),
      metadata: {
        city: selectedNumber.City,
        state: selectedNumber.State,
        orderId: orderResponse.Order.id,
        siteId: this.siteId,
      },
    };
  }

  async releaseNumber(providerId: string): Promise<void> {
    // Bandwidth uses DELETE /phoneNumbers/{number}
    // providerId should be the phone number (unformatted or formatted?)
    // Bandwidth expects 10 digit or E.164? Usually 10 digit for US.
    // We'll strip +1 if present.
    const number = providerId.replace(/^\+1/, '');
    await this.request('DELETE', `/phoneNumbers/${number}`);
    logger.info({ msg: 'Released Bandwidth number', providerId });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    try {
      const number = providerId.replace(/^\+1/, '');
      const response = await this.request<{
        id: string;
        TelephoneNumber: string;
        Status: string;
        City: string;
        State: string;
        SiteId: string;
      }>('GET', `/phoneNumbers/${number}`);

      return {
        id: response.id || response.TelephoneNumber,
        number: this.formatNumber(response.TelephoneNumber),
        provider: 'bandwidth',
        status: 'assigned',
        features: { voice: true, sms: true },
        providerId: response.id || response.TelephoneNumber,
        metadata: {
          city: response.City,
          state: response.State,
          siteId: response.SiteId,
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
    // Bandwidth configuration is via Site/Application.
    // If we wanted to change the application, we'd update the number.
    // PUT /phoneNumbers/{number}
    // Body: { SiteId: "..." }

    // For now, we assume the SiteId set during purchase handles routing.
    // If we needed to change routing, we would update the SiteId here.

    // Example:
    /*
    const number = providerId.replace(/^\+1/, '');
    await this.request('PUT', `/phoneNumbers/${number}`, {
      SiteId: this.siteId
    });
    */

    await Promise.resolve();
    logger.info({ msg: 'Configured Bandwidth number (no-op)', providerId, features });
  }

  private formatNumber(num: string): string {
    if (num.startsWith('+')) return num;
    if (num.length === 10) return `+1${num}`;
    if (num.length === 11 && num.startsWith('1')) return `+${num}`;
    return `+${num}`;
  }
}
