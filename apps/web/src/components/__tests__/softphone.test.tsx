/**
 * The softphone's pure presentation helpers: number and timer formatting, the
 * one-state derivation the panel colours itself by, the plain-English error
 * copy, and the rule that single-letter shortcuts never fire into a field.
 *
 * `.tsx` so the existing `src/components/__tests__/**\/*.test.tsx` entry in
 * vitest.config.ts picks it up; there is no JSX in it.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveSoftphoneState,
  describePhoneError,
  formatCallTimer,
  formatDurationShort,
  formatLocation,
  formatPartialNumber,
  formatPhoneNumber,
  formatRelativeTime,
  initialsFor,
  isDialing,
  knownCallerName,
  mergeRecentCalls,
  type SoftphoneStateInput,
} from '../phone/softphone/format';
import { isTypingTarget, keypadKeyFor, resolveShortcut } from '../phone/softphone/shortcuts';

describe('formatPhoneNumber', () => {
  it('formats US numbers in any common shape as (XXX) XXX-XXXX', () => {
    expect(formatPhoneNumber('+18135550142')).toBe('(813) 555-0142');
    expect(formatPhoneNumber('18135550142')).toBe('(813) 555-0142');
    expect(formatPhoneNumber('813-555-0142')).toBe('(813) 555-0142');
    expect(formatPhoneNumber('8135550142')).toBe('(813) 555-0142');
  });

  it('leaves anything that is not a ten-digit US number as it was', () => {
    expect(formatPhoneNumber('1001')).toBe('1001');
    expect(formatPhoneNumber('+442071234567')).toBe('+442071234567');
    expect(formatPhoneNumber('Unknown')).toBe('Unknown');
    expect(formatPhoneNumber('')).toBe('');
    expect(formatPhoneNumber(null)).toBe('');
  });
});

describe('formatPartialNumber', () => {
  it('formats as the digits arrive', () => {
    expect(formatPartialNumber('81')).toBe('81');
    expect(formatPartialNumber('8135')).toBe('(813) 5');
    expect(formatPartialNumber('8135550')).toBe('(813) 555-0');
    expect(formatPartialNumber('18135550142')).toBe('+1 (813) 555-0142');
  });

  it('does not format keypad codes', () => {
    expect(formatPartialNumber('*72')).toBe('*72');
    expect(formatPartialNumber('123#')).toBe('123#');
  });
});

describe('formatCallTimer', () => {
  it('is mm:ss under an hour', () => {
    expect(formatCallTimer(0)).toBe('00:00');
    expect(formatCallTimer(7)).toBe('00:07');
    expect(formatCallTimer(754)).toBe('12:34');
    expect(formatCallTimer(3599)).toBe('59:59');
  });

  it('is h:mm:ss from an hour', () => {
    expect(formatCallTimer(3600)).toBe('1:00:00');
    expect(formatCallTimer(3729)).toBe('1:02:09');
    expect(formatCallTimer(36_000)).toBe('10:00:00');
  });

  it('never shows a negative or broken time', () => {
    expect(formatCallTimer(-5)).toBe('00:00');
    expect(formatCallTimer(Number.NaN)).toBe('00:00');
    expect(formatCallTimer(12.9)).toBe('00:12');
  });
});

describe('formatDurationShort', () => {
  it('reads naturally at each scale', () => {
    expect(formatDurationShort(0)).toBe('—');
    expect(formatDurationShort(42)).toBe('42s');
    expect(formatDurationShort(252)).toBe('4m 12s');
    expect(formatDurationShort(3780)).toBe('1h 03m');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-25T15:30:00');
  it('counts minutes and hours today, then calendar days', () => {
    expect(formatRelativeTime(new Date('2026-09-25T15:29:30'), now)).toBe('Just now');
    expect(formatRelativeTime(new Date('2026-09-25T15:18:00'), now)).toBe('12m ago');
    expect(formatRelativeTime(new Date('2026-09-25T12:00:00'), now)).toBe('3h ago');
    expect(formatRelativeTime(new Date('2026-09-24T23:50:00'), now)).toBe('Yesterday');
    expect(formatRelativeTime(new Date('2026-09-22T10:00:00'), now)).toBe('Tue');
    expect(formatRelativeTime(new Date('2026-09-03T10:00:00'), now)).toBe('Sep 3');
  });

  it('takes ISO strings and ignores junk', () => {
    expect(formatRelativeTime('2026-09-25T15:00:00', now)).toBe('30m ago');
    expect(formatRelativeTime('not a date', now)).toBe('');
    expect(formatRelativeTime(null, now)).toBe('');
  });
});

describe('caller identity', () => {
  it('treats placeholder names as no name', () => {
    expect(knownCallerName('Unknown')).toBeNull();
    expect(knownCallerName('anonymous')).toBeNull();
    expect(knownCallerName('  ')).toBeNull();
    expect(knownCallerName('8135550142')).toBeNull();
    expect(knownCallerName('Maria Delgado')).toBe('Maria Delgado');
  });

  it('takes initials from the first and last words', () => {
    expect(initialsFor('Maria Delgado')).toBe('MD');
    expect(initialsFor('maria del carmen ortiz')).toBe('MO');
    expect(initialsFor('Cher')).toBe('C');
    expect(initialsFor('')).toBe('');
    expect(initialsFor(null)).toBe('');
  });

  it('joins whichever of city and state is known', () => {
    expect(formatLocation('Tampa', 'FL')).toBe('Tampa, FL');
    expect(formatLocation(undefined, 'FL')).toBe('FL');
    expect(formatLocation('', '')).toBeNull();
  });
});

describe('deriveSoftphoneState', () => {
  const base: SoftphoneStateInput = {
    phoneStatus: 'registered',
    agentStatus: 'available',
    currentCall: null,
    hasPendingDisposition: false,
  };
  const call = (
    state: 'ringing' | 'connecting' | 'active' | 'hold' | 'ended',
    direction: 'inbound' | 'outbound' = 'inbound',
    isOnHold = false
  ): SoftphoneStateInput['currentCall'] => ({ state, direction, isOnHold });

  it('maps the connection', () => {
    expect(deriveSoftphoneState(base)).toBe('ready');
    expect(deriveSoftphoneState({ ...base, phoneStatus: 'connecting' })).toBe('connecting');
    expect(deriveSoftphoneState({ ...base, phoneStatus: 'retrying' })).toBe('connecting');
    expect(deriveSoftphoneState({ ...base, phoneStatus: 'failed' })).toBe('offline');
    expect(deriveSoftphoneState({ ...base, agentStatus: 'offline' })).toBe('offline');
  });

  it('maps the call', () => {
    expect(deriveSoftphoneState({ ...base, currentCall: call('ringing') })).toBe('incoming');
    expect(deriveSoftphoneState({ ...base, currentCall: call('ringing', 'outbound') })).toBe(
      'connected'
    );
    expect(deriveSoftphoneState({ ...base, currentCall: call('active') })).toBe('connected');
    expect(deriveSoftphoneState({ ...base, currentCall: call('hold') })).toBe('hold');
    expect(deriveSoftphoneState({ ...base, currentCall: call('active', 'inbound', true) })).toBe(
      'hold'
    );
  });

  it('puts a live call ahead of a connection blip, and wrap-up after the call', () => {
    expect(
      deriveSoftphoneState({ ...base, phoneStatus: 'retrying', currentCall: call('active') })
    ).toBe('connected');
    expect(
      deriveSoftphoneState({ ...base, currentCall: call('ended'), hasPendingDisposition: true })
    ).toBe('wrapup');
    expect(
      deriveSoftphoneState({ ...base, currentCall: call('ringing'), hasPendingDisposition: true })
    ).toBe('incoming');
  });
});

describe('isDialing', () => {
  it('is an outbound call not yet answered', () => {
    expect(isDialing({ direction: 'outbound', state: 'connecting' })).toBe(true);
    expect(isDialing({ direction: 'outbound', state: 'ringing' })).toBe(true);
    expect(isDialing({ direction: 'outbound', state: 'active', answerTime: new Date() })).toBe(
      false
    );
    expect(isDialing({ direction: 'inbound', state: 'ringing' })).toBe(false);
    expect(isDialing(null)).toBe(false);
  });
});

describe('describePhoneError', () => {
  const raw = [
    'Phone not connected',
    'Call failed',
    'Failed to answer',
    'No active call to add party to',
    'Need two calls to merge',
    'Failed to merge calls',
    'SIP connection lost',
    'Phone initialization failed',
    'Invalid SIP URI',
    'The phone could not connect after 5 attempts. Calls will not reach you until it does.',
    'TypeError: Cannot read properties of undefined (reading "sessionDescriptionHandler")',
  ];

  it('never shows the raw error text', () => {
    for (const message of raw) {
      const copy = describePhoneError(message);
      expect(copy).not.toBeNull();
      expect(copy?.title).not.toContain(message);
      expect(copy?.body).not.toContain(message);
      expect(`${copy?.title} ${copy?.body}`).not.toMatch(/SIP|TypeError|undefined/);
    }
  });

  it('offers a reconnect when reconnecting is the fix', () => {
    expect(describePhoneError('SIP connection lost')?.reconnect).toBe(true);
    expect(describePhoneError('Failed to answer')?.reconnect).toBe(false);
  });

  it('is null with no error', () => {
    expect(describePhoneError(null)).toBeNull();
    expect(describePhoneError('')).toBeNull();
  });
});

describe('keyboard shortcuts', () => {
  const input = { tagName: 'INPUT', type: 'text' };
  const textarea = { tagName: 'TEXTAREA' };
  const editable = { tagName: 'DIV', isContentEditable: true };
  const checkbox = { tagName: 'INPUT', type: 'checkbox' };
  const button = { tagName: 'BUTTON' };

  it('knows a text field from a control', () => {
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'tel' })).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'textbox' })).toBe(true);
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('is off while typing', () => {
    for (const target of [input, textarea, editable]) {
      expect(resolveShortcut({ key: 'a', target }, 'incoming')).toBeNull();
      expect(resolveShortcut({ key: 'm', target }, 'connected')).toBeNull();
      expect(resolveShortcut({ key: 'Escape', target }, 'ready')).toBeNull();
      expect(resolveShortcut({ key: '?', target }, 'ready')).toBeNull();
      expect(keypadKeyFor({ key: '5', target })).toBeNull();
    }
  });

  it('means the right thing in the right state', () => {
    expect(resolveShortcut({ key: 'a', target: button }, 'incoming')).toBe('answer');
    expect(resolveShortcut({ key: 'D' }, 'incoming')).toBe('decline');
    expect(resolveShortcut({ key: 'a' }, 'ready')).toBeNull();
    expect(resolveShortcut({ key: 'm' }, 'connected')).toBe('mute');
    expect(resolveShortcut({ key: 'h' }, 'hold')).toBe('hold');
    expect(resolveShortcut({ key: 'm' }, 'ready')).toBeNull();
    expect(resolveShortcut({ key: 'k' }, 'ready')).toBe('keypad');
    expect(resolveShortcut({ key: 'k' }, 'incoming')).toBeNull();
    expect(resolveShortcut({ key: 'Escape' }, 'connected')).toBe('close');
    expect(resolveShortcut({ key: '?' }, 'offline')).toBe('help');
  });

  it('leaves modified keys to the browser', () => {
    expect(resolveShortcut({ key: 'm', metaKey: true }, 'connected')).toBeNull();
    expect(resolveShortcut({ key: 'h', ctrlKey: true }, 'connected')).toBeNull();
    expect(keypadKeyFor({ key: '1', ctrlKey: true })).toBeNull();
  });

  it('takes keypad keys, but not Enter on a focused button', () => {
    expect(keypadKeyFor({ key: '7' })).toBe('digit');
    expect(keypadKeyFor({ key: '#' })).toBe('digit');
    expect(keypadKeyFor({ key: 'Backspace' })).toBe('backspace');
    expect(keypadKeyFor({ key: 'Enter' })).toBe('enter');
    expect(keypadKeyFor({ key: 'Enter', target: button })).toBeNull();
    expect(keypadKeyFor({ key: 'x' })).toBeNull();
  });
});

describe('mergeRecentCalls', () => {
  it('merges, dedupes and sorts newest first', () => {
    const items = mergeRecentCalls(
      [
        {
          callId: 'a',
          direction: 'outbound',
          phoneNumber: '+18135550142',
          callerName: 'Unknown',
          duration: 30,
          startTime: new Date('2026-09-25T15:00:00'),
          answerTime: new Date('2026-09-25T15:00:05'),
        },
        {
          callId: 'dup',
          direction: 'inbound',
          phoneNumber: '+18135550000',
          duration: 0,
          startTime: new Date('2026-09-25T14:00:00'),
        },
      ],
      [
        {
          id: 'dup',
          direction: 'INBOUND',
          callerNumber: '+18135550000',
          duration: 0,
          status: 'NO_ANSWER',
          startedAt: '2026-09-25T14:00:00',
        },
        {
          id: 'b',
          direction: 'OUTBOUND',
          toNumber: '+14075550198',
          duration: 96,
          startedAt: '2026-09-25T15:10:00',
        },
      ]
    );
    expect(items.map(i => i.id)).toEqual(['b', 's-a', 'dup']);
    expect(items[1].name).toBeNull();
    expect(items[2]).toMatchObject({ direction: 'inbound', missed: true, number: '+18135550000' });
    expect(items[0]).toMatchObject({
      direction: 'outbound',
      number: '+14075550198',
      missed: false,
    });
  });
});
