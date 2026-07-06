/**
 * Field-level encryption for sensitive carrier application data
 * (SSN, bank routing/account numbers).
 *
 * AES-256-GCM with a key derived from the FIELD_ENCRYPTION_KEY env var.
 * Format: "enc:v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>"
 *
 * In production the key is required — encryption fails loudly if missing.
 * In development/test a deterministic fallback key is used so the feature
 * works locally without extra setup (a warning is logged in development).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const DEV_FALLBACK_KEY = 'hopwhistle-dev-only-field-encryption-key';

let warnedDevKey = false;

function getKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw || raw.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FIELD_ENCRYPTION_KEY is required in production to store sensitive carrier application fields'
      );
    }
    if (process.env.NODE_ENV !== 'test' && !warnedDevKey) {
      warnedDevKey = true;
      console.warn(
        '[FieldEncryption] FIELD_ENCRYPTION_KEY not set — using insecure development fallback key'
      );
    }
    return createHash('sha256').update(DEV_FALLBACK_KEY).digest();
  }
  // Accept any string; derive a stable 32-byte key
  return createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a sensitive field value. Returns null for empty input.
 */
export function encryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a value produced by encryptField.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) {
    throw new Error('Value is not an encrypted field payload');
  }
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted field payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Last 4 characters of a value (for masked display), or null.
 */
export function last4(value: string | null | undefined): string | null {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.slice(-4);
}
