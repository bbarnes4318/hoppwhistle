/**
 * The id an inbound softphone call is recorded under.
 *
 * FreeSWITCH puts the call's uuid on every agent leg as `X-Call-Id: fs-<uuid>`
 * -- the same `fs-` callSid the CDR writes the call row under. The softphone
 * uses it as the call's id, so the disposition and any application land on
 * that row. The SIP Call-ID it used before names only the leg to this browser,
 * which no row carries, and the disposition endpoint made a second INBOUND row
 * for it.
 */

const SOFTPHONE_CALL_SID_RE = /^fs-[0-9a-f-]{8,}$/i;

export function isSoftphoneCallSid(value: string | null | undefined): value is string {
  return typeof value === 'string' && SOFTPHONE_CALL_SID_RE.test(value);
}

interface InviteLike {
  getHeader?: (name: string) => string | undefined;
  headers?: Record<string, Array<{ raw?: string }> | undefined>;
}

/** `fs-<uuid>` from the INVITE's X-Call-Id header, or null when it has none. */
export function inboundCallSid(request: InviteLike | null | undefined): string | null {
  if (!request) return null;
  let value: string | undefined;
  if (typeof request.getHeader === 'function') {
    value = request.getHeader('X-Call-Id');
  }
  if (!value && request.headers) {
    const key = Object.keys(request.headers).find(name => name.toLowerCase() === 'x-call-id');
    value = key ? request.headers[key]?.[0]?.raw : undefined;
  }
  const trimmed = value?.trim();
  return isSoftphoneCallSid(trimmed) ? trimmed : null;
}
