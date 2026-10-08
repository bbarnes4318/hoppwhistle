/**
 * The customer record's pure pieces: the PATCH a set of edits becomes, how
 * dates and tasks read, and the notes field as a history.
 */
import { describe, expect, it } from 'vitest';

import type { InsuranceActivity, InsuranceLeadDetail, InsuranceTask } from '@/lib/api/leads';
import type { FexQuoteSummary } from '@/lib/fex/api';

import { describeActivity } from '../customer/customer-activity';
import { parseNotes } from '../customer/customer-notes';
import { dispositionTone, dueLabel, openTasks, stageLabel, taskDueDate } from '../customer/format';
import { buildLeadPatch, changedEdits, sectionsFor, toLocalInput } from '../customer/lead-fields';
import { deriveNextAction } from '../customer/next-action';

const lead = (patch: Partial<InsuranceLeadDetail> = {}): InsuranceLeadDetail =>
  ({
    id: 'lead-1',
    vertical: 'FE',
    email: null,
    city: 'Knoxville',
    doNotCall: false,
    nextFollowUpAt: null,
    customFields: { gtlQuote: '41.10', height: '5-10' },
    tasks: [],
    ...patch,
  }) as unknown as InsuranceLeadDetail;

const task = (patch: Partial<InsuranceTask>): InsuranceTask => ({
  id: 't',
  tenantId: 't',
  insuranceLeadId: 'lead-1',
  assignedToId: null,
  title: 'Task',
  description: null,
  status: 'OPEN',
  priority: 'NORMAL',
  dueAt: null,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...patch,
});

describe('buildLeadPatch', () => {
  it('sends booleans as booleans and a local date-time as the instant it names', () => {
    const local = '2026-10-09T14:30';
    const patch = buildLeadPatch(lead(), { doNotCall: 'true', nextFollowUpAt: local });
    expect(patch.doNotCall).toBe(true);
    expect(patch.nextFollowUpAt).toBe(new Date(local).toISOString());
  });

  it('clears a date with null, not an empty string', () => {
    expect(buildLeadPatch(lead(), { nextFollowUpAt: '' })).toEqual({ nextFollowUpAt: null });
  });

  it('merges carrier figures back into customFields, keeping the rest of it', () => {
    expect(buildLeadPatch(lead(), { gtlQuote: '39.00', city: 'Nashville' })).toEqual({
      city: 'Nashville',
      customFields: { gtlQuote: '39.00', height: '5-10' },
    });
  });
});

describe('changedEdits', () => {
  it('drops an edit typed back to what the record holds', () => {
    expect(changedEdits(lead(), { city: 'Knoxville', email: 'a@b.co' })).toEqual({
      email: 'a@b.co',
    });
  });

  it('compares a date-time in the viewer’s own time zone', () => {
    const iso = '2026-10-09T18:30:00.000Z';
    expect(
      changedEdits(lead({ nextFollowUpAt: iso }), { nextFollowUpAt: toLocalInput(iso) })
    ).toEqual({});
  });
});

describe('sectionsFor', () => {
  it('gives each vertical its own groups', () => {
    const ids = (v: InsuranceLeadDetail['vertical']) => sectionsFor(v).map(s => s.id);
    expect(ids('FE')).toEqual(expect.arrayContaining(['finalExpense', 'compliance', 'personal']));
    expect(ids('B2B')).toContain('company');
    expect(ids('B2B')).not.toContain('personal');
    expect(ids('ACA')).not.toContain('finalExpense');
  });
});

describe('tasks and stages', () => {
  it('reads a bare due date as the calendar day it names', () => {
    const due = taskDueDate('2026-10-09T00:00:00.000Z');
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 9, 9]);
  });

  it('puts overdue first and says so', () => {
    const now = new Date(2026, 9, 8, 12);
    const { open, overdue } = openTasks(
      lead({
        tasks: [
          task({ id: 'later', dueAt: '2026-10-20T00:00:00.000Z' }),
          task({ id: 'none' }),
          task({ id: 'late', dueAt: '2026-10-02T00:00:00.000Z' }),
          task({ id: 'done', status: 'COMPLETED' }),
        ],
      }),
      now
    );
    expect(open.map(t => t.id)).toEqual(['late', 'later', 'none']);
    expect(overdue).toBe(1);
    expect(dueLabel('2026-10-02T00:00:00.000Z', now)).toEqual({
      text: 'Overdue · Oct 2, 2026',
      overdue: true,
    });
    expect(dueLabel('2026-10-08T00:00:00.000Z', now).text).toBe('Due today');
  });

  it('names a lead with no stage New', () => {
    expect(stageLabel(null)).toBe('New');
    expect(stageLabel('CLOSED_WON')).toBe('Closed won');
  });
});

describe('parseNotes', () => {
  it('reads dated entries and leaves older free text as it was', () => {
    const entries = parseNotes(
      'Oct 8, 2026, 2:05 PM · Jane Agent\nWants $10k\n\nOld imported note\nsecond line'
    );
    expect(entries).toEqual([
      { at: 'Oct 8, 2026, 2:05 PM', author: 'Jane Agent', body: 'Wants $10k' },
      { at: null, author: null, body: 'Old imported note\nsecond line' },
    ]);
    expect(parseNotes(null)).toEqual([]);
  });
});

describe('dispositionTone', () => {
  it('sorts free-text dispositions into three families', () => {
    expect(dispositionTone('NOT_INTERESTED')).toBe('bad');
    expect(dispositionTone('Do Not Call')).toBe('bad');
    expect(dispositionTone('APPLICATION_SUBMITTED')).toBe('good');
    expect(dispositionTone('Transferred')).toBe('good');
    expect(dispositionTone('NO_ANSWER')).toBe('neutral');
    expect(dispositionTone('Voicemail')).toBe('neutral');
  });
});

describe('describeActivity', () => {
  const act = (patch: Partial<InsuranceActivity>): InsuranceActivity => ({
    id: 'a',
    tenantId: 't',
    insuranceLeadId: 'lead-1',
    type: 'CALL',
    title: '',
    description: null,
    metadata: null,
    createdById: null,
    createdAt: '2026-10-07T18:05:00Z',
    ...patch,
  });

  it('reads an API call entry as a call, with its outcome', () => {
    expect(
      describeActivity(
        act({
          title: 'Call (INBOUND) - Final Expense Inbound',
          description: 'Disposition: NOT_INTERESTED',
        })
      )
    ).toEqual({
      title: 'Inbound call',
      detail: 'Final Expense Inbound',
      disposition: 'NOT_INTERESTED',
    });
  });

  it('says nothing for a call with no disposition', () => {
    expect(
      describeActivity(
        act({ title: 'Call (OUTBOUND) - Callback', description: 'Disposition: None' })
      )
    ).toEqual({ title: 'Outbound call', detail: 'Callback', disposition: null });
  });

  it('words enum values in running text', () => {
    expect(
      describeActivity(
        act({
          type: 'STATUS_CHANGE',
          title: 'Status Changed',
          description: 'Lead status changed from NEW to CLOSED_LOST.',
        })
      ).detail
    ).toBe('Lead status changed from New to Closed lost.');
  });
});

describe('deriveNextAction', () => {
  const now = new Date(2026, 9, 8, 12);
  const plan = { id: 'q', selectedCarrier: 'Trinity', applicationId: null } as FexQuoteSummary;
  const opts = { featured: null, written: false, neverQuoted: false, now };

  it('puts an overdue task first, then a passed follow-up', () => {
    const late = task({ id: 'late', title: 'Send packet', dueAt: '2026-10-02T00:00:00.000Z' });
    expect(
      deriveNextAction(lead({ tasks: [late], nextFollowUpAt: '2026-10-07T15:00:00Z' }), opts)
    ).toMatchObject({ kind: 'task', title: 'Send packet', overdue: true });
    expect(deriveNextAction(lead({ nextFollowUpAt: '2026-10-07T15:00:00Z' }), opts)).toMatchObject({
      kind: 'follow-up',
      title: 'Follow-up is overdue',
      overdue: true,
    });
  });

  it('falls back to the sale: write the application, then quote', () => {
    expect(deriveNextAction(lead(), { ...opts, featured: plan })).toMatchObject({
      kind: 'application',
      detail: 'From the Trinity plan',
    });
    expect(deriveNextAction(lead(), { ...opts, featured: plan, written: true }).kind).toBe('none');
    expect(deriveNextAction(lead(), { ...opts, neverQuoted: true }).kind).toBe('quote');
    expect(deriveNextAction(lead(), opts)).toMatchObject({
      kind: 'none',
      title: 'Nothing scheduled',
    });
  });
});
