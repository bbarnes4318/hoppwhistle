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

/**
 * Whether an INVITE is a supervisor listen-in leg rather than a call.
 *
 * The API rings a manager's softphone with `X-Hopwhistle-Monitor: <channel>`
 * when they press Listen on the floor (routes/call-monitor.ts). Such a leg is
 * answered by the softphone itself, with the microphone off, and is not a call
 * the manager took: no screen pop, no disposition, no presence change.
 */
export function isMonitorInvite(request: InviteLike | null | undefined): boolean {
  if (!request) return false;
  let value: string | undefined;
  if (typeof request.getHeader === 'function') {
    value = request.getHeader('X-Hopwhistle-Monitor');
  }
  if (!value && request.headers) {
    const key = Object.keys(request.headers).find(
      name => name.toLowerCase() === 'x-hopwhistle-monitor'
    );
    value = key ? request.headers[key]?.[0]?.raw : undefined;
  }
  return Boolean(value?.trim());
}
