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
 * FracTEL / FoneStorm Adapter
 *
 * Implements the FoneStorm API for number search and ordering.
 * API docs: https://developer.fonestorm.com/reference
 *
 * Auth: POST /v2/auth with { username, password } → returns a JWT used in the
 * `token` request header. Tokens expire (default 3600s); we cache and refresh.
 *
 * Key endpoints:
 *   POST /v2/auth                              — create auth token
 *   GET  /v2/fonenumbers/inventory/local       — search local DIDs by area_code
 *   GET  /v2/fonenumbers/inventory/tollfree     — search toll-free DIDs by tollfree_code
 *   POST /v2/fonenumbers/order                  — order DIDs { fonenumbers: [...] }
 */
export class FractelAdapter implements ProvisioningAdapter {
  readonly provider = 'fractel' as const;

  private username?: string;
  private password?: string;
  private baseUrl: string;

  private token?: string;
  private tokenExpiresAt = 0;

  constructor() {
    this.username = process.env.FONESTORM_USERNAME || secrets.get('FONESTORM_USERNAME');
    this.password = process.env.FONESTORM_PASSWORD || secrets.get('FONESTORM_PASSWORD');
    this.baseUrl = (process.env.FONESTORM_BASE_URL || 'https://api.fonestorm.com/v2').replace(
      /\/$/,
      ''
    );
  }

  isConfigured(): boolean {
    return !!(this.username && this.password);
  }

  /**
   * Get a valid auth token, creating/refreshing it when expired.
   */
  private async getToken(): Promise<string> {
    // Reuse a cached token until 60s before expiry.
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    if (!this.username || !this.password) {
      throw new Error('FoneStorm credentials not configured (FONESTORM_USERNAME/PASSWORD)');
    }

    const expiresSeconds = 3600;
    const response = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
        expires: expiresSeconds,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      logger.error({
        msg: 'FoneStorm auth failed',
        status: response.status,
        body: text.slice(0, 300),
      });
      throw new Error(`FoneStorm authentication failed (${response.status})`);
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }

    // FoneStorm nests the token: { "auth": { "token": "..." } }
    const authObj = (data.auth as Record<string, unknown> | undefined) ?? data;
    const token =
      (authObj.token as string) ||
      (data.token as string) ||
      (data.Token as string) ||
      (data.authorization as string) ||
      (data.access_token as string);

    if (!token) {
      logger.error({ msg: 'FoneStorm auth returned no token', keys: Object.keys(data) });
      throw new Error('FoneStorm authentication returned no token');
    }

    this.token = token;
    this.tokenExpiresAt = Date.now() + expiresSeconds * 1000;
    return token;
  }

  /**
   * Make an authenticated request to the FoneStorm API.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string | undefined>
  ): Promise<T> {
    const token = await this.getToken();

    let fetchUrl = `${this.baseUrl}${endpoint}`;
    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== '') params.append(key, value);
      }
      const qs = params.toString();
      if (qs) fetchUrl = `${fetchUrl}?${qs}`;
    }

    const headers: Record<string, string> = { token, Accept: 'application/json' };
    const options: RequestInit = { method, headers };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(fetchUrl, options);
    const text = await response.text();

    if (!response.ok) {
      let errData: { message?: string } = {};
      try {
        errData = JSON.parse(text) as { message?: string };
      } catch {
        errData = { message: text };
      }
      logger.error({
        msg: 'FoneStorm API error',
        status: response.status,
        url: fetchUrl,
        error: errData,
      });
      if (response.status === 401 || response.status === 403) {
        // Force a token refresh on the next call.
        this.token = undefined;
        throw new Error('FoneStorm authentication failed. Check FONESTORM credentials.');
      }
      throw new Error(
        `FoneStorm API error: ${errData.message || response.statusText} (${response.status})`
      );
    }

    if (!text || text.trim() === '') return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }

  /**
   * Normalize a FoneStorm inventory item to a ProvisionedNumber.
   */
  private mapItem(item: Record<string, unknown>): ProvisionedNumber | null {
    const raw =
      (item.fonenumber as string) ||
      (item.FoneNumber as string) ||
      (item.foneNumber as string) ||
      (item.number as string) ||
      (item.tn as string) ||
      (item.did as string);
    if (!raw) return null;

    const clean = String(raw).replace(/\D/g, '');
    const e164 = clean.startsWith('1') ? `+${clean}` : `+1${clean}`;
    const last10 = clean.length === 11 ? clean.slice(1) : clean;

    return {
      id: clean,
      number: e164,
      provider: 'fractel',
      status: 'available' as NumberStatus,
      features: { voice: true, sms: false },
      providerId: last10,
      metadata: {
        npa: last10.slice(0, 3),
        rateCenter:
          (item.rate_center as string) ||
          (item.ratecenter as string) ||
          (item.rateCenter as string),
        state: (item.state as string) || (item.State as string),
        tier: (item.tier as string) || (item.Tier as string) || (item.max_tier as string),
      },
    };
  }

  private extractItems(response: unknown): Record<string, unknown>[] {
    if (Array.isArray(response)) return response as Record<string, unknown>[];
    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      for (const key of ['fonenumbers', 'data', 'results', 'Results', 'inventory', 'records']) {
        if (Array.isArray(resp[key])) return resp[key] as Record<string, unknown>[];
      }
    }
    return [];
  }

  /**
   * Search available DIDs. Local by default; set options.numberType='tollfree'
   * to search toll-free inventory.
   */
  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const max = String(options?.limit && options.limit > 0 ? Math.min(options.limit, 200) : 50);

    let response: unknown;
    if (options?.numberType === 'tollfree') {
      response = await this.request<unknown>('GET', '/fonenumbers/inventory/tollfree', undefined, {
        tollfree_code: options?.areaCode || '800,888,877,866,855,844,833',
        max,
      });
    } else {
      const areaCode = (options?.areaCode || '').replace(/\D/g, '').slice(0, 3);
      if (!areaCode) {
        throw new Error('An area code is required to search local FracTEL numbers');
      }
      response = await this.request<unknown>('GET', '/fonenumbers/inventory/local', undefined, {
        area_code: areaCode,
        max,
      });
    }

    return this.extractItems(response)
      .map(item => this.mapItem(item))
      .filter(Boolean) as ProvisionedNumber[];
  }

  /**
   * Order a DID from FoneStorm. POST /fonenumbers/order with a 10-digit number.
   */
  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    let tn = request.number;
    if (!tn) {
      if (!request.areaCode) {
        throw new Error('Area code or specific number is required to purchase a FracTEL number');
      }
      const available = await this.listNumbers({ areaCode: request.areaCode, limit: 1 });
      if (available.length === 0) {
        throw new Error(`No FracTEL numbers available for area code ${request.areaCode}`);
      }
      tn = available[0].providerId!;
    }

    const clean = tn.replace(/\D/g, '');
    const tenDigit = clean.length === 11 && clean.startsWith('1') ? clean.slice(1) : clean;

    const result = await this.request<Record<string, unknown>>('POST', '/fonenumbers/order', {
      fonenumbers: [tenDigit],
      messaging_enabled: request.features?.sms ?? false,
    });

    // Each ordered number carries a `result` of SUCCESS/FAILED.
    const ordered = this.extractItems(result);
    const entry = ordered.find(n => {
      const num = String((n.fonenumber as string) || (n.number as string) || '').replace(/\D/g, '');
      return num === tenDigit || num === clean;
    });
    const resultStatus = String(
      entry?.result || (result.result as string) || 'SUCCESS'
    ).toUpperCase();
    if (resultStatus === 'FAILED') {
      throw new Error(`FoneStorm declined the order for ${tenDigit}`);
    }

    const e164 = `+1${tenDigit}`;
    logger.info({ msg: 'Purchased FracTEL DID', did: e164 });

    return {
      id: tenDigit,
      number: e164,
      provider: 'fractel',
      status: 'assigned',
      features: { voice: true, sms: request.features?.sms ?? false },
      providerId: tenDigit,
      purchasedAt: new Date(),
      metadata: {},
    };
  }

  /**
   * Release a DID back to FoneStorm.
   */
  async releaseNumber(providerId: string): Promise<void> {
    const tenDigit = providerId.replace(/\D/g, '').slice(-10);
    await this.request('DELETE', `/fonenumbers/${tenDigit}`);
    logger.info({ msg: 'Released FracTEL DID', providerId: tenDigit });
  }

  /**
   * Get details for a specific DID.
   */
  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    const tenDigit = providerId.replace(/\D/g, '').slice(-10);
    try {
      const response = await this.request<Record<string, unknown>>(
        'GET',
        `/fonenumbers/${tenDigit}`
      );
      return {
        id: tenDigit,
        number: `+1${tenDigit}`,
        provider: 'fractel',
        status: 'assigned',
        features: { voice: true },
        providerId: tenDigit,
        metadata: response || {},
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('404') || error.message.includes('not found'))
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Configure DID features. FoneStorm routing is handled at the account/trunk
   * level (STATIC IP trunk), so this is a best-effort no-op.
   */
  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    logger.debug({ msg: 'FracTEL configureNumber (no-op)', providerId, features });
    await Promise.resolve();
  }
}
