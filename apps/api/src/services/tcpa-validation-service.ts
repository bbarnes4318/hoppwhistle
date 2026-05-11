/**
 * TCPA Litigator Validation Service
 *
 * Uses the Realvalidito DNC Lookup API to check if an incoming caller
 * is a known TCPA litigator.  If the number appears in the
 * `tcpa_litigator` response array the call MUST be blocked.
 *
 * 24-hour Redis caching avoids duplicate API charges for the same number.
 *
 * API endpoint: POST https://app.realvalidito.com/dnclookup/validate
 * Request:  { api_key, api_secret, numbers: string[] }   (10-digit, no +1)
 * Response: { status, data: { cleaned_number[], tcpa_litigator[], federal_dnc[], invalid[] } }
 */

import { getRedisClient } from './redis.js';

// ── Environment ──────────────────────────────────────────────────────────────
const TCPA_API_KEY    = process.env.TCPA_API_KEY    || '';
const TCPA_API_SECRET = process.env.TCPA_API_SECRET || '';
const TCPA_API_URL    = 'https://app.realvalidito.com/dnclookup/validate';
const CACHE_TTL_SECS  = 86400; // 24 hours

// ── Types ────────────────────────────────────────────────────────────────────
export interface TcpaResult {
  /** The normalised 10-digit number that was checked */
  number: string;
  /** TRUE = known TCPA litigator → block the call */
  isLitigator: boolean;
  /** Number appeared on the federal DNC list */
  isFederalDnc: boolean;
  /** Number was classified as clean */
  isClean: boolean;
  /** Number was invalid / not a real US number */
  isInvalid: boolean;
  /** Result came from Redis cache (no API charge) */
  cached: boolean;
  /** ISO timestamp of when this result was generated / cached */
  checkedAt: string;
}

interface RealValiditorResponse {
  status: 'success' | 'failed';
  data?: {
    cleaned_number?: string[];
    tcpa_litigator?: string[];
    federal_dnc?:    string[];
    invalid?:        string[];
  };
  error?: {
    error_code: number;
    message:    string;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip a phone number down to exactly 10 digits (US format, no +1). */
function normalise(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If it starts with 1 and is 11 digits, drop the leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

function cacheKey(tenDigit: string): string {
  return `tcpa:${tenDigit}`;
}

// ── Service class ────────────────────────────────────────────────────────────

class TcpaValidationService {
  // ──────────────────────────────────────────────────────────────────────────
  // Public: validate a single phone number
  // ──────────────────────────────────────────────────────────────────────────
  async validateNumber(rawPhone: string): Promise<TcpaResult> {
    const tenDigit = normalise(rawPhone);

    if (tenDigit.length !== 10) {
      // Not a valid US number — treat as invalid but not a litigator
      return this.buildResult(tenDigit, { isInvalid: true, cached: false });
    }

    // 1. Check Redis cache first
    const cached = await this.getFromCache(tenDigit);
    if (cached) {
      return cached;
    }

    // 2. Call the Realvalidito API
    const apiResult = await this.callApi(tenDigit);

    // 3. Cache the result for 24 hours
    await this.setCache(tenDigit, apiResult);

    return apiResult;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: Redis cache
  // ──────────────────────────────────────────────────────────────────────────
  private async getFromCache(tenDigit: string): Promise<TcpaResult | null> {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(cacheKey(tenDigit));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TcpaResult;
      parsed.cached = true;
      return parsed;
    } catch (err) {
      console.error('[TCPA] Redis read error (proceeding to API):', err);
      return null;
    }
  }

  private async setCache(tenDigit: string, result: TcpaResult): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.set(cacheKey(tenDigit), JSON.stringify(result), 'EX', CACHE_TTL_SECS);
    } catch (err) {
      console.error('[TCPA] Redis write error (non-fatal):', err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: call the Realvalidito API
  // ──────────────────────────────────────────────────────────────────────────
  private async callApi(tenDigit: string): Promise<TcpaResult> {
    if (!TCPA_API_KEY || !TCPA_API_SECRET) {
      console.warn('[TCPA] API credentials not configured — allowing call through');
      return this.buildResult(tenDigit, { isClean: true, cached: false });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(TCPA_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key:    TCPA_API_KEY,
          api_secret: TCPA_API_SECRET,
          numbers:    [tenDigit],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[TCPA] API returned HTTP ${response.status}`);
        // Fail-open: don't block calls if the API is down
        return this.buildResult(tenDigit, { isClean: true, cached: false });
      }

      const json = (await response.json()) as RealValiditorResponse;

      if (json.status !== 'success' || !json.data) {
        console.error('[TCPA] API error:', json.error?.message || 'Unknown');
        // Fail-open
        return this.buildResult(tenDigit, { isClean: true, cached: false });
      }

      const isLitigator  = (json.data.tcpa_litigator || []).includes(tenDigit);
      const isFederalDnc = (json.data.federal_dnc    || []).includes(tenDigit);
      const isClean      = (json.data.cleaned_number  || []).includes(tenDigit);
      const isInvalid    = (json.data.invalid          || []).includes(tenDigit);

      const result = this.buildResult(tenDigit, {
        isLitigator,
        isFederalDnc,
        isClean,
        isInvalid,
        cached: false,
      });

      console.log(
        `[TCPA] ${tenDigit} → litigator=${isLitigator} dnc=${isFederalDnc} clean=${isClean} invalid=${isInvalid}`
      );

      return result;
    } catch (err) {
      console.error('[TCPA] API call failed (fail-open):', err);
      // Fail-open: never block a call due to our own infra failure
      return this.buildResult(tenDigit, { isClean: true, cached: false });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private: build a TcpaResult object
  // ──────────────────────────────────────────────────────────────────────────
  private buildResult(
    number: string,
    flags: Partial<Omit<TcpaResult, 'number' | 'checkedAt'>>
  ): TcpaResult {
    return {
      number,
      isLitigator:  flags.isLitigator  ?? false,
      isFederalDnc: flags.isFederalDnc ?? false,
      isClean:      flags.isClean      ?? false,
      isInvalid:    flags.isInvalid    ?? false,
      cached:       flags.cached       ?? false,
      checkedAt:    new Date().toISOString(),
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────
export const tcpaValidationService = new TcpaValidationService();
