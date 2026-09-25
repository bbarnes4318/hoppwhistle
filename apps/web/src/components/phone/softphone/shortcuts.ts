/**
 * Softphone keyboard shortcuts, as pure functions so the "off while typing"
 * rule can be tested without a browser.
 *
 * Single letters are only safe as shortcuts because they never fire into a
 * field: an agent typing "Mark" into the intake form must not mute the call.
 */

import type { SoftphoneState } from './format';

export type ShortcutAction = 'answer' | 'decline' | 'mute' | 'hold' | 'keypad' | 'close' | 'help';

export interface ShortcutDef {
  keys: string[];
  label: string;
  /** Which states it does anything in; the sheet greys the rest out. */
  when: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: ['A'], label: 'Answer', when: 'Incoming call' },
  { keys: ['D'], label: 'Decline', when: 'Incoming call' },
  { keys: ['M'], label: 'Mute or unmute', when: 'On a call' },
  { keys: ['H'], label: 'Hold or resume', when: 'On a call' },
  { keys: ['K'], label: 'Show or hide the keypad', when: 'Any time' },
  { keys: ['0–9', '*', '#'], label: 'Type on the keypad', when: 'Keypad open' },
  { keys: ['Enter'], label: 'Call the number', when: 'Keypad open' },
  { keys: ['Esc'], label: 'Close the phone', when: 'Any time' },
  { keys: ['?'], label: 'Show these shortcuts', when: 'Any time' },
];

/** The minimum of a KeyboardEvent this needs, so tests can pass plain objects. */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null | TypingTargetLike;
}

/** The parts of an element `isTypingTarget` reads. */
export interface TypingTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

// Input types that take a click, not text. A focused checkbox is not typing.
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when a keystroke on this element is someone typing, not a command. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as TypingTargetLike;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase());
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

/**
 * The action a keystroke means in this state, or null for "not ours".
 *
 * A and D only while ringing and M and H only with a call up, so a stray key
 * with nothing on the line does nothing rather than something surprising.
 */
export function resolveShortcut(event: KeyLike, state: SoftphoneState): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;

  const onCall = state === 'connected' || state === 'hold';
  switch (event.key) {
    case 'Escape':
      return 'close';
    case '?':
      return 'help';
    case 'a':
    case 'A':
      return state === 'incoming' ? 'answer' : null;
    case 'd':
    case 'D':
      return state === 'incoming' ? 'decline' : null;
    case 'm':
    case 'M':
      return onCall ? 'mute' : null;
    case 'h':
    case 'H':
      return onCall ? 'hold' : null;
    case 'k':
    case 'K':
      return state === 'incoming' ? null : 'keypad';
    default:
      return null;
  }
}

/** The keys a keypad takes from a physical keyboard, or null for others. */
export function keypadKeyFor(event: KeyLike): 'digit' | 'backspace' | 'enter' | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  if (/^[0-9*#+]$/.test(event.key)) return 'digit';
  if (event.key === 'Backspace') return 'backspace';
  if (event.key === 'Enter') {
    // Enter on a focused button presses that button; dialing as well would
    // place a call nobody asked for.
    const tag = (event.target as TypingTargetLike | null | undefined)?.tagName?.toUpperCase();
    return tag === 'BUTTON' || tag === 'A' ? null : 'enter';
  }
  return null;
}
