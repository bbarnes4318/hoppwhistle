import { describe, expect, it } from 'vitest';

import { resolveVisibleColumns } from '../call-column-visibility';

const DEFAULTS = { time: true, agentName: true, disposition: true, margin: false };

describe('resolveVisibleColumns', () => {
  it('keeps a choice the user has actually made', () => {
    const stored = JSON.stringify({ time: true, margin: true });
    expect(resolveVisibleColumns(stored, DEFAULTS).margin).toBe(true);
  });

  it('keeps a column the user turned OFF turned off', () => {
    const stored = JSON.stringify({ time: false });
    expect(resolveVisibleColumns(stored, DEFAULTS).time).toBe(false);
  });

  it('gives a newly added column its default instead of hiding it', () => {
    // A stored map from before Agent and Disposition existed. Returning it
    // wholesale -- what the screen used to do -- left both columns undefined,
    // so both rendered as hidden, permanently, for every existing user.
    const stored = JSON.stringify({ time: true, margin: false });

    const resolved = resolveVisibleColumns(stored, DEFAULTS);

    expect(resolved.agentName).toBe(true);
    expect(resolved.disposition).toBe(true);
  });

  it('falls back to the defaults when nothing is stored', () => {
    expect(resolveVisibleColumns(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  it.each([
    ['malformed JSON', 'not json at all'],
    ['a bare string', '"time"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
  ])('renders a full table when the stored value is %s', (_label, stored) => {
    // A table with no columns is the one outcome worth ruling out: every one
    // of these is reachable from an older build or a hand-edited store.
    expect(resolveVisibleColumns(stored, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('ignores a non-boolean value rather than treating it as a choice', () => {
    const stored = JSON.stringify({ margin: 'yes', agentName: 0 });

    const resolved = resolveVisibleColumns(stored, DEFAULTS);

    expect(resolved.margin).toBe(false);
    expect(resolved.agentName).toBe(true);
  });

  it('does not mutate the defaults it was given', () => {
    const defaults = { ...DEFAULTS };
    resolveVisibleColumns(JSON.stringify({ time: false }), defaults);
    expect(defaults.time).toBe(true);
  });
});
