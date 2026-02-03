/**
 * Anveo DID API Service
 *
 * Implements the Anveo XML API for phone number provisioning.
 * API Documentation: https://www.anveo.com/api/
 *
 * Key API Actions:
 * - ANVEO.COUNTRIES.LIST - Get list of countries
 * - ANVEO.STATES.LIST - Get list of states for a country
 * - ANVEO.AREAS.LIST - Get list of area codes with rate plans
 * - DID.ORDER - Purchase a DID
 * - DID.UPDATE - Configure DID routing (SIP URI, SMS, etc.)
 * - DID.LIST - List purchased DIDs
 * - DID.CANCEL - Release a DID
 */

import { createHmac } from 'crypto';
import { logger } from '../../lib/logger.js';
import { secrets } from '../secrets.js';

// Types
export interface AnveoCountry {
  countryId: string;
  countryName: string;
  hasStates: boolean;
  isFax: boolean;
  isSms: boolean;
}

export interface AnveoState {
  stateId: string;
  stateName: string;
  stateCode: string;
}

export interface AnveoRatePlan {
  ratePlanId: string;
  ratePlanName: string;
  monthly100: number; // Monthly price * 100 (cents)
  setup100: number; // Setup fee * 100 (cents)
  // Computed convenience fields
  monthlyPrice: number; // Actual price in dollars
  setupPrice: number; // Actual price in dollars
}

export interface AnveoArea {
  areaId: string;
  areaName: string;
  areaCode: string;
  stock: number;
  ratePlans: AnveoRatePlan[];
}

export interface AnveoDid {
  e164: string;
  didType: string;
  smsUrl: string;
  smsEmail: string;
  callForwardType: string;
  callForwardTo: string;
  status: string;
  countryName: string;
  areaName: string;
  areaCode: string;
  monthly100: number;
  ratePlanId: string;
  title: string;
  accountNumber?: string;
  orderDate?: string;
}

export interface DidOrderRequest {
  didType: 'GEOGRAPHIC' | 'NATIONAL' | 'TOLLFREE' | 'MOBILE';
  areaId: string;
  ratePlanId?: string;
  quantity?: number;
  title?: string;
}

export interface DidUpdateRequest {
  e164: string;
  callForwardType?: 'SIP_URI' | 'CALLFLOW' | 'PHONE' | 'SIP_REGISTERED' | 'TRUNK';
  callForwardTo?: string;
  smsUrl?: string;
  smsEmail?: string;
  smsPhone?: string;
  channelsLimit?: number;
  channelsOnDemand?: number;
}

/**
 * Anveo DID API Service
 */
export class AnveoDIDService {
  private apiKey: string;
  private email: string;
  private securePhrase: string;
  private signature: string;
  private baseUrl: string;
  private publicIp: string;

  constructor() {
    this.apiKey = secrets.getRequired('ANVEO_API_KEY');
    this.email = secrets.get('ANVEO_EMAIL') || '';
    this.securePhrase = secrets.get('ANVEO_SECURE_PHRASE') || '';

    // Calculate signature: HMAC_SHA1(email, securePhrase)
    // Note: email is the data, securePhrase is the key
    this.signature = this.calculateSignature();

    // Use sandbox in development, production in prod
    this.baseUrl =
      process.env.NODE_ENV === 'production'
        ? 'https://www.anveo.com/api/v3.asp'
        : 'http://sandbox.anveo.com/api/v2.asp';
    this.publicIp = process.env.PUBLIC_IP || '';

    logger.info({
      msg: 'AnveoDIDService initialized',
      baseUrl: this.baseUrl,
      publicIp: this.publicIp ? '***configured***' : 'NOT SET',
      hasEmail: !!this.email,
      hasSecurePhrase: !!this.securePhrase,
      hasSignature: !!this.signature,
    });
  }

  /**
   * Calculate HMAC-SHA1 signature for Anveo API authentication
   * SIGNATURE = HMAC_SHA1(email, securePhrase)
   */
  private calculateSignature(): string {
    if (!this.email || !this.securePhrase) {
      logger.warn({
        msg: 'Anveo signature cannot be calculated - missing email or securePhrase',
        hasEmail: !!this.email,
        hasSecurePhrase: !!this.securePhrase,
      });
      return '';
    }

    // HMAC_SHA1: key = securePhrase, data = email
    const hmac = createHmac('sha1', this.securePhrase);
    hmac.update(this.email);
    return hmac.digest('hex');
  }

  /**
   * Build XML request payload
   */
  private buildXmlRequest(actionName: string, params: Record<string, string> = {}): string {
    // Always include SIGNATURE as the first parameter
    const allParams: Record<string, string> = {};
    if (this.signature) {
      allParams.SIGNATURE = this.signature;
    }
    Object.assign(allParams, params);

    const paramXml = Object.entries(allParams)
      .map(([name, value]) => `    <PARAMETER NAME="${name}">${this.escapeXml(value)}</PARAMETER>`)
      .join('\n');

    return `<?xml version="1.0" standalone="no" ?>
<REQUEST>
  <USERTOKEN>
    <USERKEY>${this.apiKey}</USERKEY>
  </USERTOKEN>
  <ACTION NAME="${actionName}">
${paramXml}
  </ACTION>
</REQUEST>`;
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Parse XML response from Anveo
   */
  private parseXmlResponse(xml: string): {
    success: boolean;
    error?: string;
    data: Record<string, unknown>;
  } {
    // Simple XML parsing for Anveo responses
    const resultMatch = xml.match(/<RESULT>(.*?)<\/RESULT>/i);
    const errorMatch = xml.match(/<ERROR>(.*?)<\/ERROR>/i);

    const result = resultMatch ? resultMatch[1].toUpperCase() === 'SUCCESS' : false;
    const error = errorMatch ? errorMatch[1] : undefined;

    return {
      success: result,
      error,
      data: { raw: xml },
    };
  }

  /**
   * Make authenticated XML request to Anveo API
   */
  private async request(actionName: string, params: Record<string, string> = {}): Promise<string> {
    const xmlPayload = this.buildXmlRequest(actionName, params);

    logger.debug({
      msg: 'Anveo API request',
      action: actionName,
      params,
    });

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml; charset=UTF-8',
          Accept: 'application/xml; charset=UTF-8',
        },
        body: xmlPayload,
      });

      const responseText = await response.text();

      logger.debug({
        msg: 'Anveo API response',
        action: actionName,
        status: response.status,
        responseLength: responseText.length,
      });

      if (!response.ok) {
        throw new Error(`Anveo API HTTP error: ${response.status} ${response.statusText}`);
      }

      // Check for errors in response
      const parsed = this.parseXmlResponse(responseText);
      if (!parsed.success && parsed.error) {
        throw new Error(`Anveo API error: ${parsed.error}`);
      }

      return responseText;
    } catch (error) {
      logger.error({
        msg: 'Anveo API request failed',
        action: actionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Parse COUNTRY nodes from XML response
   */
  private parseCountries(xml: string): AnveoCountry[] {
    const countries: AnveoCountry[] = [];
    const countryRegex = /<COUNTRY\s+([^>]+)\/>/gi;
    let match;

    while ((match = countryRegex.exec(xml)) !== null) {
      const attrs = match[1];
      countries.push({
        countryId: this.extractAttr(attrs, 'COUNTRY_ID'),
        countryName: this.extractAttr(attrs, 'COUNTRY_NAME') || this.extractAttr(attrs, 'NAME'),
        hasStates: this.extractAttr(attrs, 'HAS_STATES')?.toLowerCase() === 'true',
        isFax: this.extractAttr(attrs, 'IS_FAX')?.toLowerCase() === 'true',
        isSms: this.extractAttr(attrs, 'IS_SMS')?.toLowerCase() === 'true',
      });
    }

    return countries;
  }

  /**
   * Parse STATE nodes from XML response
   */
  private parseStates(xml: string): AnveoState[] {
    const states: AnveoState[] = [];
    const stateRegex = /<STATE\s+([^>]+)(?:\/>|>)/gi;
    let match;

    while ((match = stateRegex.exec(xml)) !== null) {
      const attrs = match[1];
      states.push({
        stateId: this.extractAttr(attrs, 'STATE_ID'),
        stateName: this.extractAttr(attrs, 'STATE_NAME'),
        stateCode: this.extractAttr(attrs, 'STATE_CODE'),
      });
    }

    return states;
  }

  /**
   * Parse AREA nodes with nested RATE_PLAN from XML response
   */
  private parseAreas(xml: string): AnveoArea[] {
    const areas: AnveoArea[] = [];
    // Match AREA opening tag with attributes
    const areaRegex = /<AREA\s+([^>]+)>([\s\S]*?)<\/AREA>/gi;
    let match;

    while ((match = areaRegex.exec(xml)) !== null) {
      const attrs = match[1];
      const innerContent = match[2];

      // Parse rate plans within this area
      const ratePlans: AnveoRatePlan[] = [];
      const planRegex = /<RATE_PLAN\s+([^>]+)\/>/gi;
      let planMatch;

      while ((planMatch = planRegex.exec(innerContent)) !== null) {
        const planAttrs = planMatch[1];
        const monthly100 = parseInt(this.extractAttr(planAttrs, 'MONTHLY100') || '0', 10);
        const setup100 = parseInt(this.extractAttr(planAttrs, 'SETUP100') || '0', 10);

        ratePlans.push({
          ratePlanId: this.extractAttr(planAttrs, 'RATE_PLAN_ID'),
          ratePlanName: this.extractAttr(planAttrs, 'RATE_PLAN_NAME'),
          monthly100,
          setup100,
          monthlyPrice: monthly100 / 100,
          setupPrice: setup100 / 100,
        });
      }

      areas.push({
        areaId: this.extractAttr(attrs, 'AREA_ID'),
        areaName: this.extractAttr(attrs, 'AREA_NAME'),
        areaCode: this.extractAttr(attrs, 'AREA_CODE'),
        stock: parseInt(this.extractAttr(attrs, 'STOCK') || '0', 10),
        ratePlans,
      });
    }

    return areas;
  }

  /**
   * Parse DID nodes from XML response
   */
  private parseDids(xml: string): AnveoDid[] {
    const dids: AnveoDid[] = [];
    const didRegex = /<DID\s+([^>]+)(?:\/>|>)/gi;
    let match;

    while ((match = didRegex.exec(xml)) !== null) {
      const attrs = match[1];
      dids.push({
        e164: this.extractAttr(attrs, 'E164'),
        didType: this.extractAttr(attrs, 'DID_TYPE'),
        smsUrl: this.extractAttr(attrs, 'SMS_URL'),
        smsEmail: this.extractAttr(attrs, 'SMS_EMAIL'),
        callForwardType: this.extractAttr(attrs, 'CALL_FORWARD_TYPE'),
        callForwardTo: this.extractAttr(attrs, 'CALL_FORWARD_TO'),
        status: this.extractAttr(attrs, 'STATUS'),
        countryName: this.extractAttr(attrs, 'COUNTRY_NAME'),
        areaName: this.extractAttr(attrs, 'AREA_NAME'),
        areaCode: this.extractAttr(attrs, 'AREA_CODE'),
        monthly100: parseInt(this.extractAttr(attrs, 'MONTHLY100') || '0', 10),
        ratePlanId: this.extractAttr(attrs, 'RATE_PLAN_ID'),
        title: this.extractAttr(attrs, 'TITLE'),
        accountNumber: this.extractAttr(attrs, 'ACCOUNT_NUMBER'),
        orderDate: this.extractAttr(attrs, 'ORDER_DATE'),
      });
    }

    return dids;
  }

  /**
   * Extract attribute value from XML attributes string
   */
  private extractAttr(attrs: string, name: string): string {
    const regex = new RegExp(`${name}="([^"]*)"`, 'i');
    const match = attrs.match(regex);
    return match ? match[1] : '';
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Get list of countries where DIDs are available
   */
  async listCountries(didType: string = 'GEOGRAPHIC'): Promise<AnveoCountry[]> {
    const xml = await this.request('ANVEO.COUNTRIES.LIST', {
      DID_TYPE: didType,
    });
    return this.parseCountries(xml);
  }

  /**
   * Get list of states for a country
   */
  async listStates(countryId: string, didType: string = 'GEOGRAPHIC'): Promise<AnveoState[]> {
    const xml = await this.request('ANVEO.STATES.LIST', {
      DID_TYPE: didType,
      COUNTRY_ID: countryId,
    });
    return this.parseStates(xml);
  }

  /**
   * Get list of area codes with availability and pricing
   */
  async listAreas(params: {
    didType?: string;
    countryId?: string;
    stateId?: string;
  }): Promise<AnveoArea[]> {
    const requestParams: Record<string, string> = {
      DID_TYPE: params.didType || 'GEOGRAPHIC',
    };

    if (params.stateId) {
      requestParams.STATE_ID = params.stateId;
    } else if (params.countryId) {
      requestParams.COUNTRY_ID = params.countryId;
    }

    const xml = await this.request('ANVEO.AREAS.LIST', requestParams);
    return this.parseAreas(xml);
  }

  /**
   * Order a DID from Anveo
   */
  async orderDid(request: DidOrderRequest): Promise<AnveoDid[]> {
    const params: Record<string, string> = {
      DID_TYPE: request.didType,
      AREA_ID: request.areaId,
    };

    if (request.ratePlanId) {
      params.RATE_PLAN_ID = request.ratePlanId;
    }

    if (request.quantity) {
      params.QUANTITY = String(request.quantity);
    }

    if (request.title) {
      params.TITLE = request.title;
    }

    const xml = await this.request('DID.ORDER', params);
    const dids = this.parseDids(xml);

    logger.info({
      msg: 'DID ordered from Anveo',
      count: dids.length,
      dids: dids.map(d => d.e164),
    });

    return dids;
  }

  /**
   * Update DID configuration (routing, SMS, etc.)
   */
  async updateDid(request: DidUpdateRequest): Promise<void> {
    const params: Record<string, string> = {
      'FILTER.E164': request.e164,
    };

    if (request.callForwardType) {
      params.CALL_FORWARD_TYPE = request.callForwardType;
    }

    if (request.callForwardTo) {
      params.CALL_FORWARD_TO = request.callForwardTo;
    }

    if (request.smsUrl) {
      params.SMS_URL = request.smsUrl;
    }

    if (request.smsEmail) {
      params.SMS_EMAIL = request.smsEmail;
    }

    if (request.smsPhone) {
      params.SMS_PHONE = request.smsPhone;
    }

    if (request.channelsLimit !== undefined) {
      params.CHANNELS_LIMIT = String(request.channelsLimit);
    }

    if (request.channelsOnDemand !== undefined) {
      params.CHANNELS_ONDEMAND = String(request.channelsOnDemand);
    }

    await this.request('DID.UPDATE', params);

    logger.info({
      msg: 'DID updated on Anveo',
      e164: request.e164,
      callForwardType: request.callForwardType,
    });
  }

  /**
   * List DIDs from account
   */
  async listDids(filters?: {
    e164?: string;
    didType?: string;
    title?: string;
  }): Promise<AnveoDid[]> {
    const params: Record<string, string> = {};

    if (filters?.e164) {
      params['FILTER.E164'] = filters.e164;
    }

    if (filters?.didType) {
      params['FILTER.DID_TYPE'] = filters.didType;
    }

    if (filters?.title) {
      params['FILTER.TITLE'] = filters.title;
    }

    const xml = await this.request('DID.LIST', params);
    return this.parseDids(xml);
  }

  /**
   * Cancel/release a DID
   */
  async cancelDid(e164: string): Promise<void> {
    await this.request('DID.CANCEL', { E164: e164 });

    logger.info({
      msg: 'DID canceled on Anveo',
      e164,
    });
  }

  /**
   * Configure DID to route to our FreeSWITCH server
   */
  async configureForFreeSWITCH(e164: string, smsWebhookUrl?: string): Promise<void> {
    if (!this.publicIp) {
      throw new Error('PUBLIC_IP not configured - cannot route DID to FreeSWITCH');
    }

    // Format SIP URI: $[E164]$@{PUBLIC_IP}:5080
    const sipUri = `$[E164]$@${this.publicIp}:5080`;

    const updateRequest: DidUpdateRequest = {
      e164,
      callForwardType: 'SIP_URI',
      callForwardTo: sipUri,
    };

    if (smsWebhookUrl) {
      updateRequest.smsUrl = smsWebhookUrl;
    }

    await this.updateDid(updateRequest);

    logger.info({
      msg: 'DID configured for FreeSWITCH',
      e164,
      sipUri,
      smsWebhookUrl,
    });
  }
}

// Singleton instance
let serviceInstance: AnveoDIDService | null = null;

export function getAnveoDIDService(): AnveoDIDService {
  if (!serviceInstance) {
    serviceInstance = new AnveoDIDService();
  }
  return serviceInstance;
}
