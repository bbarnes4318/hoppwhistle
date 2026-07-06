/**
 * Redaction utilities for carrier application automation logs.
 *
 * Ported from fe-rickie/server/services/automation/redaction.js and extended.
 * Nothing that passes through here may contain a full SSN, account number,
 * routing number, password, token, or API key.
 */

export type SensitiveType = 'ssn' | 'account' | 'routing' | 'password' | 'token' | 'phone';

/**
 * Redact a single sensitive value based on type.
 */
export const redactSensitive = (value: unknown, type: string): string => {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (!str) return '';

  const cleanType = (type || '').toLowerCase();

  if (cleanType === 'ssn') {
    return `***-**-${str.slice(-4)}`;
  }
  if (cleanType === 'account') {
    return `******${str.slice(-4)}`;
  }
  if (cleanType === 'routing') {
    return `*****${str.slice(-4)}`;
  }
  if (cleanType === 'phone') {
    return `***-***-${str.replace(/\D/g, '').slice(-4)}`;
  }
  if (cleanType === 'password' || cleanType === 'token') {
    return '[REDACTED]';
  }
  return str;
};

const SECRET_KEY_FRAGMENTS = ['password', 'secret', 'token', 'auth', 'apikey', 'api_key'];

/**
 * Recursively walk a payload and return a redacted copy safe for logging.
 */
export const redactPayload = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(item => redactPayload(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('ssn') || lowerKey.includes('taxid')) {
      redacted[key] = redactSensitive(value, 'ssn');
    } else if (
      lowerKey.includes('account') &&
      !lowerKey.includes('name') &&
      !lowerKey.includes('holder') &&
      !lowerKey.includes('type')
    ) {
      redacted[key] = redactSensitive(value, 'account');
    } else if (lowerKey.includes('routing') || lowerKey.includes('transit')) {
      redacted[key] = redactSensitive(value, 'routing');
    } else if (SECRET_KEY_FRAGMENTS.some(fragment => lowerKey.includes(fragment))) {
      redacted[key] = redactSensitive(value, 'password');
    } else if (lowerKey === 'phone' || lowerKey.endsWith('phone')) {
      redacted[key] = redactSensitive(value, 'phone');
    } else if (value && typeof value === 'object') {
      redacted[key] = redactPayload(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
};

/**
 * Sanitize an error message before persisting or logging: strip long digit
 * runs (possible account/SSN values) and cap the length.
 */
export const sanitizeErrorMessage = (message: unknown, maxLength = 500): string => {
  const str = String(message ?? 'Unknown error');
  const stripped = str.replace(/\d{7,}/g, '[REDACTED-DIGITS]');
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}…` : stripped;
};

/**
 * Build a log-safe summary of a normalized applicant payload:
 * initials, masked phone, last-4s and step context only.
 */
export const safeApplicantSummary = (normalized: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  state?: string;
}): Record<string, unknown> => {
  return {
    applicant: `${(normalized.firstName || '?').charAt(0)}.${(normalized.lastName || '?').charAt(0)}.`,
    phone: normalized.phone ? redactSensitive(normalized.phone, 'phone') : undefined,
    state: normalized.state,
  };
};

/**
 * Log a payload safely with all sensitive fields redacted.
 */
export const safeLog = (label: string, payload?: unknown): void => {
  if (payload && typeof payload === 'object') {
    console.log(`[CarrierRPA] ${label}:`, JSON.stringify(redactPayload(payload)));
  } else if (payload !== undefined) {
    console.log(`[CarrierRPA] ${label}:`, redactSensitive(payload, 'password'));
  } else {
    console.log(`[CarrierRPA] ${label}`);
  }
};
