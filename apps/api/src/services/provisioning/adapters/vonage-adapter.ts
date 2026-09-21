import { logger } from '../../../lib/logger.js';
import { secrets } from '../../secrets.js';
import type {
  ProvisioningAdapter,
  ProvisionedNumber,
  PurchaseNumberRequest,
  ListNumbersOptions,
  NumberFeatures,
} from '../types.js';

/** What the Numbers API returns for one number, owned or available. */
interface VonageNumberRow {
  country: string;
  msisdn: string;
  type?: string;
  cost?: string;
  features?: string[];
  voiceCallbackType?: string;
  voiceCallbackValue?: string;
  moHttpUrl?: string;
  app_id?: string;
}

/**
 * Vonage Adapter
 *
 * Number provisioning against the Vonage (formerly Nexmo) Numbers API.
 * https://developer.vonage.com/en/api/numbers
 *
 * ── Shapes that differ from every other adapter here ────────────────────────
 *
 * 1. Numbers are MSISDNs — bare digits, no `+`. Everything inside this
 *    platform is E.164, so the `+` is added on the way out and stripped on the
 *    way in. A `+` sent to Vonage matches nothing and reads as "number not
 *    found".
 * 2. There is no opaque per-number id. The MSISDN *is* the identifier, so it
 *    is what lands in `providerId`.
 * 3. Cancelling a number needs its country, which the id does not carry. The
 *    adapter looks the number up first and falls back to
 *    `VONAGE_DEFAULT_COUNTRY` (default `US`) only when the lookup finds
 *    nothing.
 * 4. Several endpoints answer HTTP 200 with an `error-code` in the body, so
 *    the status line alone is not evidence of success.
 *
 * ── Inbound routing ─────────────────────────────────────────────────────────
 *
 * A freshly bought Vonage number is not attached to anything. Purchases here
 * link it, which is what makes calls to it arrive at this platform:
 *
 *   VONAGE_APPLICATION_ID  a Voice application (preferred).
 *   VONAGE_SIP_URI         a SIP URI for accounts terminating straight to our
 *                          SBC, paired with the `vonage` FreeSWITCH gateway.
 *
 * Searching and listing work without either; purchasing does not, because a
 * number that rings nowhere is worse than a failed purchase.
 */
export class VonageAdapter implements ProvisioningAdapter {
  readonly provider = 'vonage' as const;

  private apiKey?: string;
  private apiSecret?: string;
  private applicationId?: string;
  private sipUri?: string;
  private defaultCountry: string;
  private baseUrl = 'https://rest.nexmo.com';

  constructor() {
    this.apiKey = process.env.VONAGE_API_KEY || secrets.get('VONAGE_API_KEY');
    this.apiSecret = process.env.VONAGE_API_SECRET || secrets.get('VONAGE_API_SECRET');
    this.applicationId = process.env.VONAGE_APPLICATION_ID || secrets.get('VONAGE_APPLICATION_ID');
    this.sipUri = process.env.VONAGE_SIP_URI || secrets.get('VONAGE_SIP_URI');
    this.defaultCountry = (process.env.VONAGE_DEFAULT_COUNTRY || 'US').toUpperCase();
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  /** Digits only. Vonage rejects a leading `+` everywhere it takes an MSISDN. */
  private toMsisdn(value: string): string {
    return (value || '').replace(/\D/g, '');
  }

  /** The platform's own format. Everything downstream expects E.164. */
  private toE164(msisdn: string): string {
    const digits = this.toMsisdn(msisdn);
    return digits ? `+${digits}` : msisdn;
  }

  private credentials(): Record<string, string> {
    return { api_key: this.apiKey ?? '', api_secret: this.apiSecret ?? '' };
  }

  /**
   * The Numbers API authenticates by `api_key`/`api_secret` parameters rather
   * than a header, so credentials ride in the query string on GET and in the
   * form body on POST. Nothing here ever logs a built URL for that reason —
   * only the endpoint path.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    params: Record<string, string | undefined> = {}
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Vonage credentials not configured');
    }

    const fields = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...this.credentials(), ...params })) {
      if (value !== undefined && value !== '') fields.append(key, value);
    }

    const url =
      method === 'GET'
        ? `${this.baseUrl}${endpoint}?${fields.toString()}`
        : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method === 'POST' ? { body: fields.toString() } : {}),
    });

    const text = await response.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { 'error-code-label': text };
      }
    }

    const body = parsed as {
      'error-code'?: string | number;
      'error-code-label'?: string;
    };

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Vonage rate limit exceeded. Retry shortly.');
      }
      if (response.status === 401) {
        throw new Error('Vonage authentication failed. Check credentials.');
      }
      const detail = body['error-code-label'] || response.statusText;
      throw new Error(`Vonage API error: ${detail} (${response.status})`);
    }

    // A 200 is not a success on its own: the write endpoints report failures
    // in the body and leave the status line alone. The code is documented as a
    // string and arrives as one, but is compared as text either way — a numeric
    // 200 read as "not the string 200" would fail every successful purchase.
    const errorCode = body['error-code'] == null ? '' : String(body['error-code']);
    if (errorCode && errorCode !== '200') {
      throw new Error(
        `Vonage API error: ${body['error-code-label'] || 'request rejected'} (${errorCode})`
      );
    }

    return parsed as T;
  }

  private mapFeatures(features?: string[]): NumberFeatures {
    const set = new Set((features ?? []).map(f => f.toUpperCase()));
    return {
      voice: set.has('VOICE'),
      sms: set.has('SMS'),
      mms: set.has('MMS'),
    };
  }

  private toProvisionedNumber(row: VonageNumberRow, owned: boolean): ProvisionedNumber {
    return {
      id: this.toMsisdn(row.msisdn),
      number: this.toE164(row.msisdn),
      provider: 'vonage',
      // Vonage reports no per-number lifecycle state: a number is either in the
      // account or it is not. Owned rows are therefore `assigned`, and search
      // results — which are by definition not ours yet — are `available`.
      status: owned ? 'assigned' : 'available',
      features: this.mapFeatures(row.features),
      providerId: this.toMsisdn(row.msisdn),
      metadata: {
        country: row.country,
        numberType: row.type,
        ...(row.cost ? { cost: row.cost } : {}),
        ...(row.voiceCallbackType ? { voiceCallbackType: row.voiceCallbackType } : {}),
        ...(row.voiceCallbackValue ? { voiceCallbackValue: row.voiceCallbackValue } : {}),
        ...(row.app_id ? { applicationId: row.app_id } : {}),
      },
    };
  }

  /** The fields that point a number at this platform, or {} if unconfigured. */
  private routingFields(): Record<string, string> {
    if (this.applicationId) return { app_id: this.applicationId };
    if (this.sipUri) return { voiceCallbackType: 'sip', voiceCallbackValue: this.sipUri };
    return {};
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const size = options?.limit || 20;
    // `index` is 1-based and counts pages, not rows.
    const index = options?.offset ? Math.floor(options.offset / size) + 1 : 1;

    const response = await this.request<{ count?: number; numbers?: VonageNumberRow[] }>(
      'GET',
      '/account/numbers',
      {
        size: size.toString(),
        index: index.toString(),
        ...(options?.areaCode
          ? // `search_pattern=0` is "starts with", and a NANP area code starts
            // after the country code.
            { pattern: `1${options.areaCode}`, search_pattern: '0' }
          : {}),
      }
    );

    return (response.numbers ?? []).map(row => this.toProvisionedNumber(row, true));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    const routing = this.routingFields();
    if (Object.keys(routing).length === 0) {
      throw new Error(
        'Vonage inbound routing is not configured: set VONAGE_APPLICATION_ID or VONAGE_SIP_URI ' +
          'before purchasing, or calls to the number will not reach this platform'
      );
    }

    const country = (request.country || this.defaultCountry).toUpperCase();
    let msisdn = request.number ? this.toMsisdn(request.number) : undefined;
    let searched: VonageNumberRow | undefined;

    if (!msisdn) {
      const search = await this.request<{ count?: number; numbers?: VonageNumberRow[] }>(
        'GET',
        '/number/search',
        {
          country,
          size: '10',
          ...(request.areaCode ? { pattern: `1${request.areaCode}`, search_pattern: '0' } : {}),
          // Vonage filters on one feature at a time. Voice is what this
          // platform buys numbers for, so SMS-only inventory is excluded here
          // rather than discovered after the purchase.
          features: request.features?.sms && !request.features?.voice ? 'SMS' : 'VOICE',
        }
      );

      searched = search.numbers?.[0];
      if (!searched) {
        throw new Error(
          request.areaCode
            ? `No available Vonage numbers found for area code ${request.areaCode}`
            : `No available Vonage numbers found in ${country}`
        );
      }
      msisdn = this.toMsisdn(searched.msisdn);
    }

    await this.request('POST', '/number/buy', { country, msisdn });

    // Buying and routing are two calls. A number that is bought but not linked
    // rings nowhere, so a failure here is reported with the MSISDN in the
    // message — it is already on the account and billing.
    try {
      await this.request('POST', '/number/update', { country, msisdn, ...routing });
    } catch (error) {
      logger.error({
        msg: 'Purchased Vonage number but failed to configure inbound routing',
        msisdn,
        err: (error as Error).message,
      });
      throw new Error(
        `Vonage number ${this.toE164(msisdn)} was purchased but could not be routed: ` +
          `${(error as Error).message}. Link it to the application or SIP URI in the Vonage ` +
          'dashboard, or release it.'
      );
    }

    logger.info({
      msg: 'Purchased Vonage number',
      number: this.toE164(msisdn),
      country,
      routedTo: routing.app_id ? `application:${routing.app_id}` : 'sipUri',
    });

    return {
      id: msisdn,
      number: this.toE164(msisdn),
      provider: 'vonage',
      status: 'assigned',
      features:
        request.features ?? (searched ? this.mapFeatures(searched.features) : { voice: true }),
      providerId: msisdn,
      purchasedAt: new Date(),
      metadata: {
        country,
        numberType: searched?.type,
        ...routing,
      },
    };
  }

  /**
   * The country a number is registered in.
   *
   * `/number/cancel` needs it and `providerId` cannot carry it, so it is read
   * back from the account. The configured default is the fallback rather than
   * the first answer: cancelling under the wrong country silently cancels
   * nothing.
   */
  private async countryFor(msisdn: string): Promise<string> {
    try {
      const existing = await this.getNumber(msisdn);
      const country = (existing?.metadata as { country?: string } | undefined)?.country;
      if (country) return country.toUpperCase();
    } catch (error) {
      logger.warn({
        msg: 'Vonage number lookup failed; falling back to default country',
        msisdn,
        country: this.defaultCountry,
        err: (error as Error).message,
      });
    }
    return this.defaultCountry;
  }

  async releaseNumber(providerId: string): Promise<void> {
    const msisdn = this.toMsisdn(providerId);
    const country = await this.countryFor(msisdn);
    await this.request('POST', '/number/cancel', { country, msisdn });
    logger.info({ msg: 'Released Vonage number', providerId: msisdn, country });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    const msisdn = this.toMsisdn(providerId);
    if (!msisdn) return null;

    const response = await this.request<{ count?: number; numbers?: VonageNumberRow[] }>(
      'GET',
      '/account/numbers',
      { pattern: msisdn, search_pattern: '1', size: '10' }
    );

    // `search_pattern=1` is a contains match, so the result set can hold more
    // than the number asked for.
    const row = (response.numbers ?? []).find(n => this.toMsisdn(n.msisdn) === msisdn);
    return row ? this.toProvisionedNumber(row, true) : null;
  }

  /**
   * Re-point a number at this platform.
   *
   * Vonage has no per-number capability switches — voice and SMS come with the
   * DID — so what this actually does is (re)link the number to the configured
   * application or SIP URI, which is also the repair for a number edited in
   * the Vonage dashboard.
   */
  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    const routing = this.routingFields();
    if (Object.keys(routing).length === 0) {
      throw new Error(
        'Vonage inbound routing is not configured: set VONAGE_APPLICATION_ID or VONAGE_SIP_URI'
      );
    }

    const msisdn = this.toMsisdn(providerId);
    const country = await this.countryFor(msisdn);

    await this.request('POST', '/number/update', { country, msisdn, ...routing });

    logger.info({
      msg: 'Configured Vonage number routing',
      providerId: msisdn,
      country,
      routedTo: routing.app_id ? `application:${routing.app_id}` : 'sipUri',
      features,
    });
  }
}
