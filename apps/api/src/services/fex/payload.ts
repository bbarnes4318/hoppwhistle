/**
 * A saved quote's applicant and results, sealed for storage.
 *
 * Both carry health answers -- conditions, medications, build -- so they are
 * never stored in the clear. The JSON is gzipped (a full result set is
 * ~100 KB of repetitive text) and then encrypted with the platform's field
 * key (`encryptField`, AES-256-GCM):
 *
 *     encryptField("gz1:" + base64(gzip(JSON.stringify(value))))
 *
 * The "gz1:" tag names the inner encoding so a later format can sit beside
 * this one. `FIELD_ENCRYPTION_KEY` must be set in production; without it
 * `encryptField` throws and a save fails rather than writing plaintext.
 */

import { gunzipSync, gzipSync } from 'zlib';

import { decryptField, encryptField } from '../../lib/field-encryption.js';

const TAG = 'gz1:';

export function sealJson(value: unknown): string {
  const packed = TAG + gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
  const sealed = encryptField(packed);
  if (!sealed) throw new Error('Nothing to seal');
  return sealed;
}

export function openJson<T>(sealed: string): T {
  const packed = decryptField(sealed);
  if (!packed || !packed.startsWith(TAG)) throw new Error('Not a sealed FEX payload');
  return JSON.parse(
    gunzipSync(Buffer.from(packed.slice(TAG.length), 'base64')).toString('utf8')
  ) as T;
}
