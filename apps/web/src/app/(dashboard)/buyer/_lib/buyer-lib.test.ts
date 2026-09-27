import { describe, expect, it } from 'vitest';

import {
  acceptedByBuyer,
  decisionNoteOf,
  displayAmountOf,
  durationScale,
  recordingIdFromUrl,
} from './calls';
import { composeDisputeReason, disputeOutcome } from './dispute';
import { newYorkMonthToDate, resolveRange } from './range';
import { chargedSpend } from './spend';
import { normalizeToken } from './token';

/**
 * The pieces of buyer-page logic that are wrong silently rather than loudly: a
 * dispute that files without its evidence, a bar scale that makes every row
 * look the same, a date range that quietly reads the wrong days, and the guard
 * that keeps a write from proceeding on a token that is not one.
 */

describe('normalizeToken', () => {
  it('accepts a token and trims it', () => {
    expect(normalizeToken('  abc.def.ghi  ')).toBe('abc.def.ghi');
  });

  it('rejects everything that is not a usable token', () => {
    // Each of these would otherwise reach an Authorization header.
    for (const value of [null, undefined, '', '   ', 42, {}, [], true]) {
      expect(normalizeToken(value)).toBeNull();
    }
  });

  it('rejects a value carrying CR or LF, which could inject a header', () => {
    expect(normalizeToken('abc\r\nX-Admin: true')).toBeNull();
    expect(normalizeToken('abc\ndef')).toBeNull();
  });

  it('rejects a value too long to be a token', () => {
    expect(normalizeToken('a'.repeat(8192))).toBe('a'.repeat(8192));
    expect(normalizeToken('a'.repeat(8193))).toBeNull();
  });
});

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

describe('disputeOutcome', () => {
  it('reads an accepted return as accepted', () => {
    expect(disputeOutcome('ACCEPTED')).toEqual({
      label: 'Return accepted',
      tone: 'live',
      decided: true,
    });
  });

  it('reads a denied return as denied', () => {
    expect(disputeOutcome('DENIED')).toEqual({
      label: 'Return denied',
      tone: 'dropped',
      decided: true,
    });
  });

  it.each(['DISPUTED', 'UNDER_REVIEW', null, undefined])('reads %s as under review', status => {
    expect(disputeOutcome(status)).toEqual({
      label: 'Under review',
      tone: 'ringing',
      decided: false,
    });
  });
});

describe('acceptedByBuyer', () => {
  const call = (metadata: Record<string, unknown> | null, disposition: string | null = null) =>
    ({ metadata, disposition }) as unknown as Parameters<typeof acceptedByBuyer>[0];

  it('reads the time the accept route records', () => {
    expect(acceptedByBuyer(call({ acceptedByBuyerAt: '2026-09-01T00:00:00.000Z' }))).toBe(true);
  });

  it('still reads a call accepted the old way, as a VERIFIED disposition', () => {
    expect(acceptedByBuyer(call(null, 'VERIFIED'))).toBe(true);
  });

  it('is false for a call nobody accepted', () => {
    expect(acceptedByBuyer(call(null))).toBe(false);
    expect(acceptedByBuyer(call({ acceptedByBuyerAt: null }, 'NOT_INTERESTED'))).toBe(false);
  });
});

describe('recordingIdFromUrl', () => {
  it('finds the recording in one of our stream URLs, absolute or relative', () => {
    expect(recordingIdFromUrl('https://api.example.com/api/v1/recordings/rec-1/stream')).toBe(
      'rec-1'
    );
    expect(recordingIdFromUrl('/api/v1/recordings/rec-2/stream')).toBe('rec-2');
  });

  it('leaves any other URL alone', () => {
    expect(recordingIdFromUrl('https://carrier.example.com/audio/123.wav')).toBeNull();
    expect(recordingIdFromUrl(null)).toBeNull();
  });
});

describe('decided returns', () => {
  const call = (
    disputeStatus: string | null,
    buyerBillableAmount: number | null,
    metadata: Record<string, unknown> | null
  ) =>
    ({ disputeStatus, buyerBillableAmount, metadata }) as unknown as Parameters<
      typeof displayAmountOf
    >[0];

  it('shows an accepted return at what it was billed, not the $0 it was zeroed to', () => {
    expect(displayAmountOf(call('ACCEPTED', 0, { originalBuyerBillableAmount: '40.00' }))).toBe(40);
    expect(displayAmountOf(call('DENIED', 30, { originalBuyerBillableAmount: '30' }))).toBe(30);
  });

  it('falls back to the current amount when no original was kept', () => {
    expect(displayAmountOf(call('ACCEPTED', 0, null))).toBe(0);
    // An open dispute is not decided: its own amount is the one that stands.
    expect(displayAmountOf(call('DISPUTED', 25, { originalBuyerBillableAmount: '99' }))).toBe(25);
  });

  it("reads the agency's note, and nothing for a blank one", () => {
    expect(decisionNoteOf(call('DENIED', 30, { decisionNote: 'Connected 3 minutes' }))).toBe(
      'Connected 3 minutes'
    );
    expect(decisionNoteOf(call('DENIED', 30, { decisionNote: '  ' }))).toBeNull();
    expect(decisionNoteOf(call('DENIED', 30, null))).toBeNull();
  });
});

describe('chargedSpend', () => {
  it('counts the charged calls of either billing type, from the decimal strings', () => {
    expect(chargedSpend({ walletDebits: '120.5000', pendingInvoice: '0.0000' })).toBe(120.5);
    expect(chargedSpend({ walletDebits: '0.0000', pendingInvoice: '75.2500' })).toBe(75.25);
  });
});

describe('newYorkMonthToDate', () => {
  it('starts at midnight on the 1st in New York, in daylight time and out of it', () => {
    // 27 September, EDT (UTC-4).
    expect(newYorkMonthToDate(new Date('2026-09-27T12:00:00Z'))).toEqual({
      startISO: '2026-09-01T04:00:00.000Z',
      endISO: '2026-09-27T12:00:00.000Z',
    });
    // 15 January, EST (UTC-5).
    expect(newYorkMonthToDate(new Date('2026-01-15T12:00:00Z')).startISO).toBe(
      '2026-01-01T05:00:00.000Z'
    );
  });

  it('is still the old month in New York for the first hours of the 1st in UTC', () => {
    // 02:00 UTC on 1 October is 22:00 on 30 September in New York.
    expect(newYorkMonthToDate(new Date('2026-10-01T02:00:00Z')).startISO).toBe(
      '2026-09-01T04:00:00.000Z'
    );
  });

  it('crosses a DST change inside the month', () => {
    // March 2026: EST on the 1st, EDT from the 8th.
    expect(newYorkMonthToDate(new Date('2026-03-20T12:00:00Z')).startISO).toBe(
      '2026-03-01T05:00:00.000Z'
    );
  });
});
