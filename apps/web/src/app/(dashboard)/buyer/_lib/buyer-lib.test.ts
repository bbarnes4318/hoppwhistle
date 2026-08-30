import { describe, expect, it } from 'vitest';

import { durationScale } from './calls';
import { composeDisputeReason } from './dispute';
import { resolveRange } from './range';

/**
 * The three pieces of buyer-page logic that are wrong silently rather than
 * loudly: a dispute that files without its evidence, a bar scale that makes
 * every row look the same, and a date range that quietly reads the wrong days.
 */

describe('composeDisputeReason', () => {
  const evidence = {
    connectedSeconds: 41,
    thresholdSeconds: 60,
    billable: true,
    billableReason: 'Connected duration exceeded campaign threshold of 60s',
    amount: 32.5,
    recordingUrl: 'https://example.test/rec.wav',
    callCreatedAt: '2026-08-01T10:00:00.000Z',
  };

  it('leads with the structured reason code', () => {
    const text = composeDisputeReason('UNDER_THRESHOLD', undefined, evidence);
    expect(text.split('\n')[0]).toBe('[UNDER_THRESHOLD] Did not reach the billable threshold');
  });

  it('attaches the recording and the measurement without being asked', () => {
    const text = composeDisputeReason('UNDER_THRESHOLD', undefined, evidence);
    expect(text).toContain('connected 0:41 against a 60s threshold');
    expect(text).toContain('marked billable');
    expect(text).toContain('charged $32.50');
    expect(text).toContain('recording: https://example.test/rec.wav');
  });

  it('says so explicitly when there is no recording', () => {
    const text = composeDisputeReason('WRONG_NUMBER', undefined, {
      ...evidence,
      recordingUrl: null,
    });
    expect(text).toContain('recording: none attached');
  });

  it('keeps the note second, and optional', () => {
    const withNote = composeDisputeReason('OTHER', '  caller hung up  ', evidence);
    expect(withNote.split('\n')[1]).toBe('Note: caller hung up');
    expect(composeDisputeReason('OTHER', '   ', evidence)).not.toContain('Note:');
  });

  it('does not claim a threshold that was never configured', () => {
    const text = composeDisputeReason('OTHER', undefined, {
      ...evidence,
      thresholdSeconds: null,
    });
    expect(text).toContain('no threshold configured');
    expect(text).not.toContain('against a');
  });
});

describe('durationScale', () => {
  const call = (connectedDuration: number) =>
    ({ connectedDuration, duration: connectedDuration }) as never;

  it('never falls below three times the threshold, so the tick has room', () => {
    expect(durationScale([call(5), call(9)], 60)).toBe(180);
  });

  it('scales to the 90th percentile, not the maximum', () => {
    // One 40-minute outlier must not flatten the other nineteen rows.
    const rows = [...Array.from({ length: 19 }, () => call(90)), call(2400)];
    expect(durationScale(rows, 60)).toBe(180);
  });

  it('has a scale to draw against with no calls and no threshold', () => {
    expect(durationScale([], null)).toBe(180);
  });
});

describe('resolveRange', () => {
  it('defaults to thirty days', () => {
    expect(resolveRange({}).key).toBe('30d');
    expect(resolveRange({ range: 'nonsense' }).days).toBe(30);
  });

  it('covers the whole of the end day', () => {
    const range = resolveRange({ range: 'custom', from: '2026-08-01', to: '2026-08-03' });
    expect(range.startISO).toBe('2026-08-01T00:00:00.000Z');
    expect(range.endISO).toBe('2026-08-03T23:59:59.999Z');
    expect(range.days).toBe(3);
  });

  it('falls back rather than querying a backwards or malformed window', () => {
    expect(resolveRange({ range: 'custom', from: '2026-08-09', to: '2026-08-01' }).key).toBe('30d');
    expect(resolveRange({ range: 'custom', from: 'yesterday', to: '2026-08-01' }).key).toBe('30d');
  });
});
