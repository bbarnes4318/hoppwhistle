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

export type VonageRoutingMode = 'sip' | 'application';

export type VonageRouting =
  | { ok: true; mode: 'sip'; sipUri: string }
  | { ok: true; mode: 'application'; applicationId: string }
  | { ok: false; reason: string };

const SIP_PLACEHOLDER = /\{(msisdn|number|did)\}/i;

/**
 * Check a `VONAGE_SIP_URI` and say what is wrong with it, or null.
 *
 * Vonage forwards a call to exactly the URI it is given, so the DID has to be
 * IN that URI: FreeSWITCH routes inbound calls on the Request-URI user part,
 * and a URI shared by every number would deliver all of them as the same
 * "number". So the URI is either a bare host — the adapter writes each
 * number's MSISDN in as the user part — or carries a `{msisdn}` placeholder.
 * A fixed user part is refused rather than silently routing every DID to one
 * place.
 */
export function validateVonageSipUri(raw: string): string | null {
  const uri = raw.trim();
  if (!/^sips?:/i.test(uri)) {
    return `VONAGE_SIP_URI must start with sip: (got "${uri}")`;
  }
  const rest = uri.replace(/^sips?:/i, '');
  const at = rest.indexOf('@');
  const host = at >= 0 ? rest.slice(at + 1) : rest;
  if (!host || /^[:;]/.test(host)) {
    return "VONAGE_SIP_URI has no host — it must name this platform's FreeSWITCH, e.g. sip:sbc.example.com:5080";
  }
  if (at >= 0 && !SIP_PLACEHOLDER.test(rest.slice(0, at))) {
    return (
      'VONAGE_SIP_URI must not hard-code a user part: every number would arrive as the same ' +
      'destination and inbound routing could not tell them apart. Use sip:<host>:<port> or ' +
      'sip:{msisdn}@<host>:<port>'
    );
  }
  return null;
}

/** The SIP URI one number forwards to, with its MSISDN as the user part. */
export function renderVonageSipUri(template: string, msisdn: string): string {
  const uri = template.trim();
  if (SIP_PLACEHOLDER.test(uri)) return uri.replace(SIP_PLACEHOLDER, msisdn);
  const scheme = /^sips:/i.test(uri) ? 'sips:' : 'sip:';
  return `${scheme}${msisdn}@${uri.replace(/^sips?:/i, '')}`;
}

/**
 * Decide, unambiguously, where purchased numbers are routed.
 *
 * `VONAGE_NUMBER_ROUTING_MODE` wins when set and must have its value. When it
 * is unset, only `VONAGE_SIP_URI` is allowed to imply a mode, because SIP into
 * FreeSWITCH is how this platform carries calls. `VONAGE_APPLICATION_ID` alone
 * does NOT imply application mode: that variable also exists for unrelated
 * Vonage products (Dograh's own Vonage provider among them), and attaching
 * platform DIDs to someone else's Voice Application just because the variable
 * is present would quietly take them away from FreeSWITCH. Both set with no
 * mode is refused as ambiguous instead of resolved by a precedence rule nobody
 * can see.
 */
export function resolveVonageRouting(config: {
  mode?: string;
  sipUri?: string;
  applicationId?: string;
}): VonageRouting {
  const mode = (config.mode ?? '').trim().toLowerCase();
  const sipUri = (config.sipUri ?? '').trim();
  const applicationId = (config.applicationId ?? '').trim();

  if (mode === 'sip') {
    if (!sipUri) {
      return { ok: false, reason: 'VONAGE_NUMBER_ROUTING_MODE=sip but VONAGE_SIP_URI is not set' };
    }
    const problem = validateVonageSipUri(sipUri);
    return problem ? { ok: false, reason: problem } : { ok: true, mode: 'sip', sipUri };
  }

  if (mode === 'application' || mode === 'app') {
    if (!applicationId) {
      return {
        ok: false,
        reason: 'VONAGE_NUMBER_ROUTING_MODE=application but VONAGE_APPLICATION_ID is not set',
      };
    }
    return { ok: true, mode: 'application', applicationId };
  }

  if (mode) {
    return {
      ok: false,
      reason: `VONAGE_NUMBER_ROUTING_MODE must be "sip" or "application" (got "${config.mode}")`,
    };
  }

  if (sipUri && applicationId) {
    return {
      ok: false,
      reason:
        'Both VONAGE_SIP_URI and VONAGE_APPLICATION_ID are set and VONAGE_NUMBER_ROUTING_MODE is ' +
        'not: set it to "sip" (route numbers into FreeSWITCH) or "application" (attach them to ' +
        'the Voice Application)',
    };
  }

  if (sipUri) {
    const problem = validateVonageSipUri(sipUri);
    return problem ? { ok: false, reason: problem } : { ok: true, mode: 'sip', sipUri };
  }

  if (applicationId) {
    return {
      ok: false,
      reason:
        'VONAGE_APPLICATION_ID is set but VONAGE_NUMBER_ROUTING_MODE is not. Platform numbers are ' +
        'not attached to a Voice Application implicitly: set VONAGE_SIP_URI to route them into ' +
        'FreeSWITCH, or VONAGE_NUMBER_ROUTING_MODE=application to confirm the application',
    };
  }

  return {
    ok: false,
    reason:
      'Vonage inbound routing is not configured: set VONAGE_SIP_URI (and ' +
      'VONAGE_NUMBER_ROUTING_MODE=sip), or VONAGE_NUMBER_ROUTING_MODE=application with ' +
      'VONAGE_APPLICATION_ID',
  };
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
 * link it, which is what makes calls to it arrive at this platform. There are
 * two different destinations and they are different architectures, so the
 * choice is explicit — see `resolveVonageRouting` below:
 *
 *   sip          (the platform default) the number forwards by SIP straight to
 *                our FreeSWITCH, lands in the `public` context, and is routed
 *                by inbound_route.lua exactly like every other carrier's DID.
 *   application  the number is attached to a Vonage Voice Application, whose
 *                webhooks — not FreeSWITCH — decide what happens to the call.
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
  private routingMode?: string;
  private defaultCountry: string;
  private baseUrl = 'https://rest.nexmo.com';

  constructor() {
    this.apiKey = process.env.VONAGE_API_KEY || secrets.get('VONAGE_API_KEY');
    this.apiSecret = process.env.VONAGE_API_SECRET || secrets.get('VONAGE_API_SECRET');
    this.applicationId = process.env.VONAGE_APPLICATION_ID || secrets.get('VONAGE_APPLICATION_ID');
    this.sipUri = process.env.VONAGE_SIP_URI || secrets.get('VONAGE_SIP_URI');
    this.routingMode = process.env.VONAGE_NUMBER_ROUTING_MODE;
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

  /** Where purchased and reconfigured numbers will be routed, or why nowhere. */
  routing(): VonageRouting {
    return resolveVonageRouting({
      mode: this.routingMode,
      sipUri: this.sipUri,
      applicationId: this.applicationId,
    });
  }

  /**
   * The Numbers API fields that point one number at this platform.
   *
   * Throws with the configuration problem rather than returning nothing: the
   * caller is about to buy or re-point a number, and doing either without a
   * clear destination is the failure this exists to prevent.
   */
  private routingFields(msisdn: string): Record<string, string> {
    const routing = this.routing();
    if (!routing.ok) throw new Error(routing.reason);
    if (routing.mode === 'application') return { app_id: routing.applicationId };
    return {
      voiceCallbackType: 'sip',
      voiceCallbackValue: renderVonageSipUri(routing.sipUri, msisdn),
    };
  }

  private describeRouting(fields: Record<string, string>): string {
    return fields.app_id ? `application:${fields.app_id}` : `sip:${fields.voiceCallbackValue}`;
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

  /**
   * Voice numbers for sale, by area code: the same `/number/search` that
   * `purchaseNumber` runs when it is given only an area code. `listNumbers`
   * lists the account's own numbers, which is not what a buyer is shown.
   */
  async searchAvailable(options?: ListNumbersOptions): Promise<ProvisionedNumber[]> {
    const response = await this.request<{ count?: number; numbers?: VonageNumberRow[] }>(
      'GET',
      '/number/search',
      {
        country: this.defaultCountry,
        size: String(Math.min(options?.limit || 20, 100)),
        features: 'VOICE',
        ...(options?.areaCode ? { pattern: `1${options.areaCode}`, search_pattern: '0' } : {}),
      }
    );
    return (response.numbers ?? []).map(row => this.toProvisionedNumber(row, false));
  }

  async purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber> {
    // Checked before anything is searched or bought: a misconfiguration must
    // fail here, not after the number is already on the account and billing.
    const routingCheck = this.routing();
    if (!routingCheck.ok) {
      throw new Error(
        `${routingCheck.reason}. Refusing to purchase: calls to the number would not reach this platform`
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

    const routing = this.routingFields(msisdn);

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
          `${(error as Error).message}. Point it at ${this.describeRouting(routing)} in the ` +
          'Vonage dashboard, or release it.'
      );
    }

    logger.info({
      msg: 'Purchased Vonage number',
      number: this.toE164(msisdn),
      country,
      routedTo: this.describeRouting(routing),
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
        routingMode: routing.app_id ? 'application' : 'sip',
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
    const msisdn = this.toMsisdn(providerId);
    const routing = this.routingFields(msisdn);
    const existing = await this.getNumber(msisdn).catch(() => null);
    const country =
      ((existing?.metadata as { country?: string } | undefined)?.country ?? '').toUpperCase() ||
      this.defaultCountry;

    await this.request('POST', '/number/update', { country, msisdn, ...routing });

    // A number still linked to a Voice Application can keep being answered by
    // that application whatever its SIP forwarding says. The Numbers API has no
    // documented way to unlink one, so say so rather than report success on a
    // number that may still not ring FreeSWITCH.
    const linkedApp = (existing?.metadata as { applicationId?: string } | undefined)?.applicationId;
    if (!routing.app_id && linkedApp) {
      logger.warn({
        msg: 'Vonage number is still linked to a Voice Application; unlink it in the Vonage dashboard so SIP forwarding applies',
        providerId: msisdn,
        applicationId: linkedApp,
      });
    }

    logger.info({
      msg: 'Configured Vonage number routing',
      providerId: msisdn,
      country,
      routedTo: this.describeRouting(routing),
      features,
    });
  }
}
