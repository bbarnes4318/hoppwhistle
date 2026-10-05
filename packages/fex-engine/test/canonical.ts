import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((out, k) => {
            out[k] = (v as Record<string, unknown>)[k];
            return out;
          }, {})
      : v
  );
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
