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
 * Twilio Adapter
 *
 * Number provisioning against the Twilio REST API (2010-04-01).
 * https://www.twilio.com/docs/phone-numbers/api
 *
 * Auth is HTTP Basic. Either the account credentials (`TWILIO_ACCOUNT_SID` +
 * `TWILIO_AUTH_TOKEN`) or an API key pair (`TWILIO_API_KEY_SID` +
 * `TWILIO_API_KEY_SECRET`, still scoped to `TWILIO_ACCOUNT_SID`) works; the
 * key pair is preferred where it is set because it can be revoked on its own
 * without rotating the account token every other integration shares.
 *
 * `TWILIO_API_KEY`/`TWILIO_API_SECRET` — the names carrier and CNAM lookup
 * already use for the same kind of Twilio API key — are accepted as fallbacks,
 * so an account already wired up for lookups does not need a second copy of
 * the same credential under a new name to provision numbers.
 *
 * ── Inbound routing ─────────────────────────────────────────────────────────
 *
 * A Twilio DID that is bought and left alone answers with Twilio's demo
 * message, not with us. Every purchase here therefore also points the number
 * at this platform, and the right target depends on how the account carries
 * voice:
 *
 *   TWILIO_TRUNK_SID   an Elastic SIP Trunk (TK…), which is what pairs with
 *                      the `twilio` FreeSWITCH gateway — the number arrives
 *                      over SIP at our SBC and never touches TwiML.
 *   TWILIO_VOICE_URL   a TwiML webhook, for accounts that route with
 *                      Programmable Voice instead.
 *
 * Neither is required to search or list, so the adapter stays usable for
 * read-only inventory work; a purchase without either is refused rather than
 * quietly landing a number on Twilio's demo greeting.
 */
export class TwilioAdapter implements ProvisioningAdapter {
  readonly provider = 'twilio' as const;

  private accountSid?: string;
  private authUser?: string;
  private authPass?: string;
  private trunkSid?: string;
  private voiceUrl?: string;
  private baseUrl = 'https://api.twilio.com/2010-04-01';

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || secrets.get('TWILIO_ACCOUNT_SID');

    // An API key authenticates as itself; the account SID stays in the URL.
    const apiKeySid =
      process.env.TWILIO_API_KEY_SID ||
      secrets.get('TWILIO_API_KEY_SID') ||
      process.env.TWILIO_API_KEY ||
      secrets.get('TWILIO_API_KEY');
    const apiKeySecret =
      process.env.TWILIO_API_KEY_SECRET ||
      secrets.get('TWILIO_API_KEY_SECRET') ||
      process.env.TWILIO_API_SECRET ||
      secrets.get('TWILIO_API_SECRET');
    const authToken = process.env.TWILIO_AUTH_TOKEN || secrets.get('TWILIO_AUTH_TOKEN');

    if (apiKeySid && apiKeySecret) {
      this.authUser = apiKeySid;
      this.authPass = apiKeySecret;
    } else if (authToken) {
      this.authUser = this.accountSid;
      this.authPass = authToken;
    }

    this.trunkSid = process.env.TWILIO_TRUNK_SID || secrets.get('TWILIO_TRUNK_SID');
    this.voiceUrl = process.env.TWILIO_VOICE_URL || secrets.get('TWILIO_VOICE_URL');
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authUser && this.authPass);
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.authUser}:${this.authPass}`).toString('base64')}`;
  }

  /**
   * Where a purchased or reconfigured number should send its calls.
   *
   * Returns the form fields to send. Empty means nothing is configured, which
   * callers treat as a refusal rather than a default.
   */
  private routingFields(): Record<string, string> {
    if (this.trunkSid) return { TrunkSid: this.trunkSid };
    if (this.voiceUrl) return { VoiceUrl: this.voiceUrl, VoiceMethod: 'POST' };
    return {};
  }

  /**
   * Twilio speaks form-encoded requests and JSON responses. Bodies are always
   * `application/x-www-form-urlencoded` — a JSON body is rejected with a 400
   * that names no field, which is a miserable thing to debug.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, string>,
    params?: Record<string, string | undefined>
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Twilio credentials not configured');
    }

    let url = `${this.baseUrl}/Accounts/${this.accountSid}${path}`;

    if (params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') search.append(key, value);
      }
      const qs = search.toString();
      if (qs) url += `?${qs}`;
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.getAuthHeader(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: { message?: string; code?: number } = {};
      try {
        parsed = JSON.parse(errorText) as { message?: string; code?: number };
      } catch {
        parsed = { message: errorText };
      }

      if (response.status === 429) {
        throw new Error('Twilio rate limit exceeded. Retry shortly.');
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('Twilio authentication failed. Check credentials.');
      }

      const detail = parsed.message || response.statusText;
      const code = parsed.code ? ` [${parsed.code}]` : '';
      throw new Error(`Twilio API error: ${detail}${code} (${response.status})`);
    }

    // DELETE answers 204 with no body.
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }

  /** Twilio capability keys are inconsistently cased across endpoints. */
  private mapCapabilities(
    capabilities?: Record<string, boolean | undefined> | null
  ): NumberFeatures {
    const read = (...keys: string[]): boolean => keys.some(key => capabilities?.[key] === true);
    return {
      voice: read('voice', 'Voice'),
      sms: read('sms', 'SMS', 'Sms'),
      mms: read('mms', 'MMS', 'Mms'),
      fax: read('fax', 'Fax'),
    };
  }

  private toProvisionedNumber(item: {
    sid: string;
    phone_number: string;
    friendly_name?: string;
    status?: string;
    date_created?: string;
    trunk_sid?: string | null;
    voice_url?: string | null;
    capabilities?: Record<string, boolean | undefined> | null;
  }): ProvisionedNumber {
    return {
      id: item.sid,
      number: item.phone_number,
      provider: 'twilio',
      status: this.mapStatus(item.status),
      features: this.mapCapabilities(item.capabilities),
      providerId: item.sid,
      purchasedAt: item.date_created ? new Date(item.date_created) : undefined,
      metadata: {
        friendlyName: item.friendly_name,
        trunkSid: item.trunk_sid ?? null,
        voiceUrl: item.voice_url ?? null,
      },
    };
  }

  async listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const limit = options?.limit || 20;
    const params: Record<string, string | undefined> = {
      PageSize: limit.toString(),
      Page: options?.offset ? Math.floor(options.offset / limit).toString() : '0',
    };

    // Twilio filters owned numbers by pattern, where `*` is any digit — so an
    // area code search is the NANP prefix followed by seven wildcards.
    if (options?.areaCode) {
      params.PhoneNumber = `+1${options.areaCode}*******`;
    }

    const response = await this.request<{
      incoming_phone_numbers: Array<{
        sid: string;
        phone_number: string;
        friendly_name?: string;
        status?: string;
        date_created?: string;
        trunk_sid?: string | null;
        voice_url?: string | null;
        capabilities?: Record<string, boolean> | null;
      }>;
    }>('GET', '/IncomingPhoneNumbers.json', undefined, params);

    return (response.incoming_phone_numbers ?? []).map(item => this.toProvisionedNumber(item));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    const routing = this.routingFields();
    if (Object.keys(routing).length === 0) {
      throw new Error(
        'Twilio inbound routing is not configured: set TWILIO_TRUNK_SID (Elastic SIP Trunk) ' +
          'or TWILIO_VOICE_URL before purchasing, or the number will answer with Twilio demo audio'
      );
    }

    const country = request.country || 'US';
    let phoneNumber = request.number;

    // A caller that named a number is taken at their word; otherwise search.
    if (!phoneNumber) {
      const searchParams: Record<string, string | undefined> = {
        PageSize: '1',
        ...(request.areaCode ? { AreaCode: request.areaCode } : {}),
        ...(request.region ? { InRegion: request.region } : {}),
        ...(request.features?.voice === false ? {} : { VoiceEnabled: 'true' }),
        ...(request.features?.sms ? { SmsEnabled: 'true' } : {}),
        ...(request.features?.mms ? { MmsEnabled: 'true' } : {}),
      };

      const search = await this.request<{
        available_phone_numbers: Array<{
          phone_number: string;
          friendly_name?: string;
          locality?: string;
          region?: string;
          capabilities?: Record<string, boolean>;
        }>;
      }>('GET', `/AvailablePhoneNumbers/${country}/Local.json`, undefined, searchParams);

      const candidate = search.available_phone_numbers?.[0];
      if (!candidate) {
        throw new Error(
          request.areaCode
            ? `No available Twilio numbers found for area code ${request.areaCode}`
            : 'No available Twilio numbers found'
        );
      }
      phoneNumber = candidate.phone_number;
    }

    const purchased = await this.request<{
      sid: string;
      phone_number: string;
      friendly_name?: string;
      status?: string;
      date_created?: string;
      trunk_sid?: string | null;
      voice_url?: string | null;
      capabilities?: Record<string, boolean> | null;
    }>('POST', '/IncomingPhoneNumbers.json', {
      PhoneNumber: phoneNumber,
      ...routing,
    });

    logger.info({
      msg: 'Purchased Twilio number',
      number: purchased.phone_number,
      sid: purchased.sid,
      routedTo: routing.TrunkSid ? `trunk:${routing.TrunkSid}` : 'voiceUrl',
    });

    return {
      ...this.toProvisionedNumber(purchased),
      status: 'assigned',
      features: request.features || this.mapCapabilities(purchased.capabilities),
    };
  }

  async releaseNumber(providerId: string): Promise<void> {
    await this.request('DELETE', `/IncomingPhoneNumbers/${providerId}.json`);
    logger.info({ msg: 'Released Twilio number', providerId });
  }

  async getNumber(providerId: string): Promise<ProvisionedNumber | null> {
    try {
      const response = await this.request<{
        sid: string;
        phone_number: string;
        friendly_name?: string;
        status?: string;
        date_created?: string;
        trunk_sid?: string | null;
        voice_url?: string | null;
        capabilities?: Record<string, boolean> | null;
      }>('GET', `/IncomingPhoneNumbers/${providerId}.json`);

      return this.toProvisionedNumber(response);
    } catch (error) {
      if (error instanceof Error && error.message.includes('(404)')) return null;
      throw error;
    }
  }

  /**
   * Re-point a number at this platform.
   *
   * Twilio has no per-number capability switches to set — voice and SMS come
   * with the DID — so the useful work here is the routing target, which is
   * also what repairs a number that was bought or edited in the Twilio console.
   */
  async configureNumber(providerId: string, features: NumberFeatures): Promise<void> {
    const routing = this.routingFields();
    if (Object.keys(routing).length === 0) {
      throw new Error(
        'Twilio inbound routing is not configured: set TWILIO_TRUNK_SID or TWILIO_VOICE_URL'
      );
    }

    await this.request('POST', `/IncomingPhoneNumbers/${providerId}.json`, routing);

    logger.info({
      msg: 'Configured Twilio number routing',
      providerId,
      routedTo: routing.TrunkSid ? `trunk:${routing.TrunkSid}` : 'voiceUrl',
      features,
    });
  }

  private mapStatus(status?: string): NumberStatus {
    switch ((status || '').toLowerCase()) {
      case 'in-use':
      case 'active':
        return 'assigned';
      case 'pending':
        return 'pending';
      case 'released':
      case 'deleted':
        return 'released';
      default:
        return 'assigned';
    }
  }
}
