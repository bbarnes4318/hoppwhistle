/**
 * The call ledger's pure pieces: return badges and the Returns filter, the
 * billing chips, the recording predicate, the default columns per role, and
 * the export's file name.
 *
 * Each of these was wrong on the screen in a way a person acted on: a return
 * the agency had accepted read as "DISPUTED - Resolved"-style jargon or as a
 * bare enum; a call with no charge status read "Pending"; a call with no
 * recording offered a play button that asked the server for the CALL's id as
 * a recording; and an owner opening the ledger saw the notes column and not
 * the money.
 */
import { describe, expect, it } from 'vitest';

import {
  LOCKED_COLUMNS,
  withLockedColumns,
  AGENT_DEFAULT_COLUMNS,
  CALL_COLUMNS,
  DISPUTE_FILTER_OPTIONS,
  OWNER_DEFAULT_COLUMNS,
  answeredByOf,
  chargeStatusBadge,
  columnRoleOf,
  defaultVisibleColumns,
  directionOf,
  disputeBadge,
  exportFilename,
  localDayKey,
  payoutStatusBadge,
  returnChip,
  wentToOf,
  recordingIdOf,
  visibleColumnsFor,
  type CallsViewer,
} from '../(dashboard)/calls/call-columns';

const OWNER: CallsViewer = {
  isAgent: false,
  isAdminOrOwner: true,
  isBuyer: false,
  isPublisher: false,
};
const AGENT: CallsViewer = {
  isAgent: true,
  isAdminOrOwner: false,
  isBuyer: false,
  isPublisher: false,
};

/** The labels a role's table opens with, in table order. */
function defaultLabels(viewer: CallsViewer): string[] {
  const visible = defaultVisibleColumns(columnRoleOf(viewer));
  return visibleColumnsFor(viewer)
    .filter(col => visible[col.id])
    .map(col => col.label);
}

describe('return badges', () => {
  it('names each state of a buyer return', () => {
    expect(disputeBadge('DISPUTED')?.label).toBe('Return requested');
    expect(disputeBadge('ACCEPTED')?.label).toBe('Return accepted');
    expect(disputeBadge('DENIED')?.label).toBe('Return denied');
  });

  it('renders nothing for a call no return was requested on', () => {
    expect(disputeBadge(null)).toBeNull();
    expect(disputeBadge(undefined)).toBeNull();
    expect(disputeBadge('')).toBeNull();
  });

  it('marks the open request as waiting and the accepted one as money lost', () => {
    expect(disputeBadge('DISPUTED')?.tone).toBe('ringing');
    expect(disputeBadge('ACCEPTED')?.tone).toBe('dropped');
  });
});

describe('the Returns filter', () => {
  it('offers None, Open, Accepted, Denied and Any, as the API reads them', () => {
    expect(DISPUTE_FILTER_OPTIONS.map(o => [o.value, o.label])).toEqual([
      ['NONE', 'None'],
      ['DISPUTED', 'Open'],
      ['ACCEPTED', 'Accepted'],
      ['DENIED', 'Denied'],
      ['ANY', 'Any'],
    ]);
  });
});

describe('billing status chips', () => {
  it('renders nothing for a call with no status rather than "Pending"', () => {
    expect(chargeStatusBadge(null)).toBeNull();
    expect(payoutStatusBadge(null)).toBeNull();
  });

  it('names the charge outcomes a return or a decision can leave behind', () => {
    expect(chargeStatusBadge('REFUNDED')?.label).toBe('Refunded');
    expect(chargeStatusBadge('WAIVED')?.label).toBe('Waived');
    expect(chargeStatusBadge('NOT_BILLABLE')?.label).toBe('Not billable');
  });

  it('names a clawed-back payout', () => {
    const badge = payoutStatusBadge('CLAWED_BACK');
    expect(badge?.label).toBe('Clawed back');
    expect(badge?.tone).toBe('dropped');
  });

  it('still renders a value it does not know, humanised', () => {
    expect(chargeStatusBadge('SOMETHING_NEW')?.label).toBe('Something new');
  });
});

describe('the recording buttons', () => {
  it('act on the primary recording', () => {
    expect(recordingIdOf({ primaryRecordingId: 'rec-1' })).toBe('rec-1');
  });

  it('are not offered without one, whatever else the call carries', () => {
    // A recording URL with no recording id is still no recording to fetch;
    // the call id is never a stand-in for one.
    expect(recordingIdOf({ primaryRecordingId: null })).toBeNull();
    expect(recordingIdOf({ primaryRecordingId: '' })).toBeNull();
    const withUrlOnly = {
      id: 'call-1',
      recordingUrl: '/recordings/x.wav',
      primaryRecordingId: null,
    };
    expect(recordingIdOf(withUrlOnly)).toBeNull();
  });
});

describe('default columns', () => {
  it('opens an owner on where each call went, the recording and the money', () => {
    expect(defaultLabels(OWNER)).toEqual([
      'Time',
      'Direction',
      'Caller',
      'Campaign',
      'Went to',
      'Duration',
      'Disposition',
      'Recording',
      'Revenue',
      'Payout',
      'Profit',
    ]);
  });

  it('has no Return column: a return is a chip in the Disposition cell', () => {
    expect(CALL_COLUMNS.map(col => col.label)).not.toContain('Return');
  });

  it('keeps the rest of an owner`s columns in the picker, off', () => {
    const visible = defaultVisibleColumns('owner');
    for (const id of [
      'billable',
      'connectedDuration',
      'cost',
      'margin',
      'answeredBy',
      'did',
      'toNumber',
    ] as const) {
      expect(visible[id], id).toBe(false);
      expect(
        visibleColumnsFor(OWNER).some(col => col.id === id),
        id
      ).toBe(true);
    }
  });

  it('opens an agent on their calls, each recording, and the applications they wrote', () => {
    expect(defaultLabels(AGENT)).toEqual([
      'Time',
      'Direction',
      'Caller',
      'Campaign',
      'Duration',
      'Disposition',
      'Application',
      'Recording',
    ]);
  });

  it("keeps an agent's Recording column on, whatever their browser saved", () => {
    expect(LOCKED_COLUMNS.agent).toEqual(['recording']);
    // A layout saved before the column was locked, with it switched off.
    const stored = { ...defaultVisibleColumns('agent'), recording: false };
    expect(withLockedColumns('agent', stored).recording).toBe(true);
    // Every other choice survives.
    expect(withLockedColumns('agent', { ...stored, campaignName: false }).campaignName).toBe(false);
  });

  it('locks nothing for an owner', () => {
    expect(LOCKED_COLUMNS.owner).toEqual([]);
    const stored = { ...defaultVisibleColumns('owner'), recording: false };
    expect(withLockedColumns('owner', stored).recording).toBe(false);
  });

  it('never offers an agent the Status, Went to or money columns', () => {
    const ids = visibleColumnsFor(AGENT).map(col => col.id);
    for (const id of [
      'status',
      'wentTo',
      'answeredBy',
      'publisherName',
      'buyerName',
      // The destination is withheld by the API, and billable is buyer billing.
      'toNumber',
      'billable',
      'revenue',
      'payout',
      'cost',
      'profit',
      'margin',
    ]) {
      expect(ids, id).not.toContain(id);
    }
  });

  it('lists only columns that exist', () => {
    const ids = new Set(CALL_COLUMNS.map(col => col.id));
    for (const id of [...OWNER_DEFAULT_COLUMNS, ...AGENT_DEFAULT_COLUMNS]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe('direction', () => {
  it('reads inbound or outbound, whatever the case', () => {
    expect(directionOf({ direction: 'INBOUND' })?.label).toBe('Inbound');
    expect(directionOf({ direction: 'outbound' })?.label).toBe('Outbound');
  });

  it('is nothing for a row that carries none', () => {
    expect(directionOf({ direction: null })).toBeNull();
    expect(directionOf({})).toBeNull();
  });

  it('is offered to owners and agents, not buyers or publishers', () => {
    const offered = (viewer: typeof OWNER) =>
      visibleColumnsFor(viewer).some(col => col.id === 'direction');
    expect(offered(OWNER)).toBe(true);
    expect(offered(AGENT)).toBe(true);
    expect(offered({ ...OWNER, isAdminOrOwner: false, isBuyer: true })).toBe(false);
    expect(offered({ ...OWNER, isAdminOrOwner: false, isPublisher: true })).toBe(false);
  });
});

describe('went to', () => {
  it('is blocked, else an agent, else a buyer, else unanswered', () => {
    expect(wentToOf({ blocked: true, agentName: 'Marisol Vance' })).toEqual({
      kind: 'blocked',
      name: null,
    });
    expect(
      wentToOf({ answeredByUserId: 'u-1', agentName: 'Marisol Vance', buyerId: 'b-1' })
    ).toEqual({ kind: 'agent', name: 'Marisol Vance' });
    expect(wentToOf({ buyerId: 'b-1', buyerName: 'Acme' })).toEqual({
      kind: 'buyer',
      name: 'Acme',
    });
    // A masked buyer is still a buyer; its name is withheld, not a name.
    expect(wentToOf({ buyerId: 'b-1', buyerName: 'Masked' })).toEqual({
      kind: 'buyer',
      name: null,
    });
    expect(wentToOf({})).toEqual({ kind: 'unanswered', name: null });
  });

  it('names a return as a small chip: waiting, accepted or denied', () => {
    expect(returnChip('DISPUTED')?.label).toBe('Return: waiting');
    expect(returnChip('ACCEPTED')?.label).toBe('Return: accepted');
    expect(returnChip('DENIED')?.label).toBe('Return: denied');
    expect(returnChip(null)).toBeNull();
  });
});

describe('answered by', () => {
  it('is the agent, else the buyer the call was sold to', () => {
    expect(answeredByOf({ agentName: 'Marisol Vance', buyerName: 'Acme' })?.name).toBe(
      'Marisol Vance'
    );
    expect(answeredByOf({ agentName: null, buyerName: 'Acme' })).toEqual({
      name: 'Acme',
      kind: 'buyer',
    });
    expect(answeredByOf({ agentName: null, buyerName: 'Masked' })).toBeNull();
    expect(answeredByOf({})).toBeNull();
  });
});

describe('the export file name', () => {
  it('is the applied range', () => {
    expect(exportFilename({ from: '2026-09-01', to: '2026-09-27' })).toBe(
      'calls-2026-09-01-2026-09-27.csv'
    );
    expect(exportFilename({ from: '', to: '' })).toBe('calls-all.csv');
  });

  it('takes a preset`s local day, not its UTC instant`s', () => {
    // Late evening local time: toISOString would name the next day anywhere
    // west of UTC. The local day key must not.
    const lateEvening = new Date(2026, 8, 27, 23, 30);
    expect(localDayKey(lateEvening)).toBe('2026-09-27');
  });
});
