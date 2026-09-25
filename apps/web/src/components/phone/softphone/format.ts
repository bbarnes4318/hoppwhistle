/**
 * Pure helpers behind the softphone's presentation.
 *
 * Nothing here touches SIP, the provider or the DOM, so the real panel and the
 * /design-preview mock render from exactly the same derivations, and the unit
 * tests can pin them without a browser.
 */

import type { AgentStatus, CallInfo } from '../phone-provider';

// ─── Numbers ──────────────────────────────────────────────────────────────────

/**
 * The digits of a US number, without the leading country code, or null when
 * it is not a ten-digit NANP number.
 */
function nanpDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return null;
}

/**
 * (XXX) XXX-XXXX for a US number in any common shape (E.164, dashed, bare).
 * Anything else — an extension, an international number, "Unknown" — comes back
 * as given, because a mangled number is worse than an unformatted one.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = nanpDigits(raw);
  if (!d) return raw.trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * The same shape while someone is still typing: "(415) 55", not "41555".
 * Keypad characters that are not digits (* and #) leave it unformatted.
 */
export function formatPartialNumber(input: string): string {
  if (/[*#]/.test(input)) return input;
  let digits = input.replace(/\D/g, '');
  const hasCountry = digits.length === 11 && digits.startsWith('1');
  if (hasCountry) digits = digits.slice(1);
  if (digits.length > 10) return input;
  let out: string;
  if (digits.length <= 3) out = digits;
  else if (digits.length <= 6) out = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  else out = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return hasCountry ? `+1 ${out}` : out;
}

// ─── Time ─────────────────────────────────────────────────────────────────────

/** A call timer: 0:07 → "00:07", 754 → "12:34", past an hour "1:02:09". */
export function formatCallTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

/** A duration in a list: "42s", "4m 12s", "1h 03m". Zero reads as an em dash. */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  if (s === 0) return '—';
  if (s < 60) return `${s}s`;
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins.toString().padStart(2, '0')}m`;
  return `${mins}m ${(s % 60).toString().padStart(2, '0')}s`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Just now", "12m ago", "3h ago", "Yesterday", "Tue", then "Sep 3". Calendar
 * days, not 24-hour windows, decide "Yesterday" — that is how people say it.
 */
export function formatRelativeTime(when: Date | string | null | undefined, now: Date): string {
  if (!when) return '';
  const date = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;

  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `${Math.floor(diff / 3600)}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return WEEKDAY[date.getDay()];
  return `${MONTH[date.getMonth()]} ${date.getDate()}`;
}

// ─── People ───────────────────────────────────────────────────────────────────

/**
 * The provider fills a missing display name with the literal "Unknown", and
 * some carriers send the number itself as the name. Neither is a name.
 */
export function knownCallerName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (/^(unknown|anonymous|unavailable|restricted)( caller)?$/i.test(trimmed)) return null;
  // A "name" with no letters in it is a number: the carrier sent the caller's
  // number, or an extension, as the display name.
  if (!/\p{L}/u.test(trimmed)) return null;
  return trimmed;
}

/** "Maria del Carmen Ortiz" → "MO". Empty when there is no name to take them from. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(w => /[a-z]/i.test(w));
  if (words.length === 0) return '';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** "Tampa, FL" from whichever of the two is known. */
export function formatLocation(city?: string | null, state?: string | null): string | null {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * The seven things the softphone can be doing, as a person would name them.
 *
 * The provider tracks three separate facts — whether the phone is registered
 * (phoneStatus), what the agent set themselves to (agentStatus) and the call
 * in hand (currentCall) — plus the call waiting to be dispositioned. The panel
 * needs one answer to colour itself by, and this is it.
 */
export type SoftphoneState =
  | 'offline'
  | 'connecting'
  | 'ready'
  | 'incoming'
  | 'connected'
  | 'hold'
  | 'wrapup';

export type PhoneStatus = 'disabled' | 'connecting' | 'registered' | 'retrying' | 'failed';

export interface SoftphoneStateInput {
  phoneStatus: PhoneStatus;
  agentStatus: AgentStatus;
  currentCall: Pick<CallInfo, 'state' | 'direction' | 'isOnHold'> | null;
  hasPendingDisposition: boolean;
}

export function deriveSoftphoneState({
  phoneStatus,
  agentStatus,
  currentCall,
  hasPendingDisposition,
}: SoftphoneStateInput): SoftphoneState {
  // A call in hand outranks the connection: the audio is already flowing, and
  // a registration blip mid-call must not repaint the call card as "Offline".
  if (currentCall && currentCall.state !== 'ended' && currentCall.state !== 'idle') {
    if (currentCall.state === 'ringing' && currentCall.direction === 'inbound') return 'incoming';
    if (currentCall.isOnHold || currentCall.state === 'hold') return 'hold';
    return 'connected';
  }
  if (hasPendingDisposition) return 'wrapup';
  if (phoneStatus === 'failed' || phoneStatus === 'disabled') return 'offline';
  if (phoneStatus === 'connecting' || phoneStatus === 'retrying') return 'connecting';
  if (agentStatus === 'offline') return 'offline';
  return 'ready';
}

/** Which signal colours a state. Neutral is for the in-between ones. */
export type SoftphoneTone = 'live' | 'ringing' | 'dropped' | 'neutral';

export interface SoftphoneStateMeta {
  label: string;
  tone: SoftphoneTone;
}

export const SOFTPHONE_STATE_META: Record<SoftphoneState, SoftphoneStateMeta> = {
  offline: { label: 'Offline', tone: 'dropped' },
  connecting: { label: 'Connecting', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'live' },
  incoming: { label: 'Incoming call', tone: 'ringing' },
  connected: { label: 'On a call', tone: 'live' },
  hold: { label: 'On hold', tone: 'ringing' },
  wrapup: { label: 'Wrap-up', tone: 'neutral' },
};

/** Placed by us and not yet answered: the header says "Calling", not "On a call". */
export function isDialing(
  call: Pick<CallInfo, 'direction' | 'state' | 'answerTime'> | null | undefined
): boolean {
  return Boolean(
    call &&
      call.direction === 'outbound' &&
      !call.answerTime &&
      (call.state === 'connecting' || call.state === 'ringing')
  );
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  available: 'Available',
  'on-call': 'On a call',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

// ─── Errors ───────────────────────────────────────────────────────────────────

export interface PhoneErrorCopy {
  title: string;
  body: string;
  /** Reconnecting is the fix, so the notice offers it. */
  reconnect: boolean;
}

/**
 * The provider's error strings are written for a log. This turns each into a
 * sentence an agent can act on. Anything unrecognised gets a generic line
 * rather than being shown raw — a stack-trace fragment in the call card
 * frightens people and tells them nothing.
 */
export function describePhoneError(error: string | null | undefined): PhoneErrorCopy | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (e.includes('could not connect after') || e.includes('initialization failed')) {
    return {
      title: 'Your phone is not connected',
      body: 'Calls will not reach you until it reconnects. Check your internet connection, then reconnect.',
      reconnect: true,
    };
  }
  if (e.includes('connection lost') || e.includes('not connected')) {
    return {
      title: 'Your phone lost its connection',
      body: 'Reconnect to start taking and placing calls again.',
      reconnect: true,
    };
  }
  if (e.includes('select an agency')) {
    return {
      title: 'Choose an agency to use the phone',
      body: 'The phone belongs to an agency. Pick one from the agency switcher first.',
      reconnect: false,
    };
  }
  if (e.includes('phone extension')) {
    return {
      title: 'No phone on this account',
      body: 'Ask an administrator to give you an agent extension.',
      reconnect: false,
    };
  }
  if (e.includes('answer')) {
    return {
      title: 'That call could not be answered',
      body: 'The caller may have hung up before it connected.',
      reconnect: false,
    };
  }
  if (e.includes('merge') || e.includes('two calls')) {
    return {
      title: 'The calls could not be merged',
      body: 'Merging needs one call on hold and one connected. Try again.',
      reconnect: false,
    };
  }
  if (e.includes('add party') || e.includes('third')) {
    return {
      title: 'Nobody could be added',
      body: 'Adding a caller needs a connected call first.',
      reconnect: false,
    };
  }
  if (e.includes('sip uri')) {
    return {
      title: 'Your phone is set up incorrectly',
      body: 'Ask an administrator to check your agent extension.',
      reconnect: false,
    };
  }
  if (e.includes('call') || e.includes('invite') || e.includes('dial')) {
    return {
      title: 'The call did not go through',
      body: 'Check the number and try again.',
      reconnect: false,
    };
  }
  return {
    title: 'Something went wrong with the phone',
    body: 'Try again. If it keeps happening, reconnect the phone.',
    reconnect: true,
  };
}

// ─── Recent calls ─────────────────────────────────────────────────────────────

export interface RecentCallItem {
  id: string;
  direction: 'inbound' | 'outbound';
  name?: string | null;
  number: string;
  durationSeconds: number;
  startedAt: Date | string | null;
  missed?: boolean;
}

/** A row from GET /api/v1/calls, as loosely as the list endpoint returns it. */
export interface ApiCallRow {
  id: string;
  direction?: string;
  phoneNumber?: string;
  callerId?: string;
  callerNumber?: string;
  toNumber?: string;
  destinationNumber?: string;
  callerName?: string;
  duration?: number;
  status?: string;
  startedAt?: string;
  createdAt?: string;
}

const UNANSWERED = new Set([
  'NO_ANSWER',
  'MISSED',
  'BUSY',
  'FAILED',
  'CANCELED',
  'CANCELLED',
  'ABANDONED',
]);

/**
 * This session's calls and the stored ones, in one list, newest first.
 *
 * A call placed in this tab is in both once the API has written it, so the
 * session copy is dropped when the API has the same id.
 */
export function mergeRecentCalls(
  session: ReadonlyArray<
    Pick<
      CallInfo,
      | 'callId'
      | 'direction'
      | 'phoneNumber'
      | 'callerName'
      | 'duration'
      | 'startTime'
      | 'answerTime'
    >
  >,
  api: ReadonlyArray<ApiCallRow>,
  limit = 20
): RecentCallItem[] {
  const apiIds = new Set(api.map(c => c.id));
  const fromSession: RecentCallItem[] = session
    .filter(c => !apiIds.has(c.callId))
    .map(c => ({
      id: `s-${c.callId}`,
      direction: c.direction,
      name: knownCallerName(c.callerName),
      number: c.phoneNumber,
      durationSeconds: c.duration || 0,
      startedAt: c.startTime ?? null,
      missed: c.direction === 'inbound' && !c.answerTime,
    }));
  const fromApi: RecentCallItem[] = api.map(c => {
    const inbound = (c.direction ?? '').toUpperCase() === 'INBOUND';
    const number = inbound
      ? c.callerId || c.callerNumber || c.phoneNumber || ''
      : c.toNumber || c.destinationNumber || c.phoneNumber || '';
    const duration = c.duration || 0;
    return {
      id: c.id,
      direction: inbound ? 'inbound' : 'outbound',
      name: knownCallerName(c.callerName),
      number,
      durationSeconds: duration,
      startedAt: c.startedAt || c.createdAt || null,
      missed: inbound && duration === 0 && UNANSWERED.has((c.status ?? '').toUpperCase()),
    };
  });
  const time = (d: Date | string | null): number => (d ? new Date(d).getTime() || 0 : 0);
  return [...fromSession, ...fromApi]
    .sort((a, b) => time(b.startedAt) - time(a.startedAt))
    .slice(0, limit);
}
