/**
 * How a customer's record reads: stage and priority names, dates, call
 * lengths. One place, so the header, the summary, Details and the CRM sheet
 * never word the same value two ways.
 */

import type { StatusTone } from '@/components/domain';
import type { InsuranceLeadDetail, InsuranceTask, UserSummary } from '@/lib/api/leads';
import { wholeDollars } from '@/lib/fex/api';
import { parseFace } from '@/lib/fex/prefill';

import { PRIORITY_OPTIONS, STAGE_OPTIONS } from './lead-fields';

const STAGE_LABEL = Object.fromEntries(STAGE_OPTIONS.map(o => [o.value, o.label]));
const PRIORITY_LABEL = Object.fromEntries(PRIORITY_OPTIONS.map(o => [o.value, o.label]));

/** A lead with no stage set is a new one, as the CRM grid counts it. */
export function stageLabel(stage: string | null | undefined): string {
  return stage ? (STAGE_LABEL[stage] ?? stage) : 'New';
}

export function stageTone(stage: string | null | undefined): StatusTone {
  switch (stage) {
    case 'CLOSED_WON':
      return 'live';
    case 'CLOSED_LOST':
      return 'dropped';
    case 'HOLD':
      return 'blocked';
    case 'PROPOSAL':
    case 'UNDERWRITING':
      return 'money';
    case 'CONTACTED':
      return 'ringing';
    default:
      return 'neutral';
  }
}

export function priorityLabel(priority: string | null | undefined): string | null {
  return priority ? (PRIORITY_LABEL[priority] ?? priority) : null;
}

export const PRIORITY_RANK: Record<InsuranceTask['priority'], number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

const isValid = (d: Date) => !Number.isNaN(d.getTime());

/** "Oct 7, 2026" */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isValid(d)
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
}

/** "Oct 7, 2026, 2:11 PM" */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isValid(d)
    ? d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
}

/** "2:11 PM" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Seconds as m:ss. */
export function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = Math.max(0, total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "Today", "Yesterday", "Tue, Oct 6", "Oct 6, 2025": a day heading in a list. */
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Items grouped under their day, newest day first, order within a day kept. */
export function groupByDay<T>(items: T[], at: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const d = new Date(at(item));
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map(group => [at(group[0]), group]);
}

/** The coverage the customer asked about, from whichever field holds it. */
export function requestedCoverage(lead: InsuranceLeadDetail): string | null {
  const face = parseFace(lead.faceAmount) ?? parseFace(lead.coverageAmount);
  return face !== null ? wholeDollars(face) : null;
}

/** The record's address as display lines; empty when none is on record. */
export function addressLines(lead: InsuranceLeadDetail): string[] {
  const street = [lead.address, lead.address2].filter(Boolean).join(', ');
  const place = [lead.city, [lead.state, lead.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [street, place].filter(Boolean);
}

export function userName(user: UserSummary): string {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
}

/** Who holds the customer, as the viewer can know it. */
export function assigneeLabel(
  lead: InsuranceLeadDetail,
  viewerId: string | null | undefined,
  users: UserSummary[]
): string | null {
  if (!lead.assignedToId) return null;
  if (viewerId && lead.assignedToId === viewerId) return 'You';
  const user = users.find(u => u.id === lead.assignedToId);
  return user ? userName(user) : 'Another agent';
}

export interface TaskSummary {
  open: InsuranceTask[];
  overdue: number;
}

/** Open tasks, most pressing first: overdue, then soonest due, then priority. */
export function openTasks(lead: InsuranceLeadDetail, now = new Date()): TaskSummary {
  const open = (lead.tasks ?? [])
    .filter(t => t.status === 'OPEN')
    .sort((a, b) => {
      const due = (t: InsuranceTask) => (t.dueAt ? taskDueDate(t.dueAt).getTime() : Infinity);
      if (due(a) !== due(b)) return due(a) - due(b);
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  const overdue = open.filter(t => t.dueAt && taskDueDate(t.dueAt) < now).length;
  return { open, overdue };
}

/**
 * When a task is due, in local time. A task is created with a bare date
 * ("2026-10-09"), which the server stores as UTC midnight; read as a local
 * instant that is the evening before anywhere in the Americas, so a
 * midnight-UTC due date is read as the calendar day it names.
 */
export function taskDueDate(iso: string): Date {
  const d = new Date(iso);
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59);
  }
  return d;
}

/** A due date relative to today: "Overdue · Oct 2", "Due today", "Due Oct 9". */
export function dueLabel(iso: string, now = new Date()): { text: string; overdue: boolean } {
  const due = taskDueDate(iso);
  const day = formatDay(due.toISOString());
  const sameDay = due.toDateString() === now.toDateString();
  if (due < now && !sameDay) return { text: `Overdue · ${day}`, overdue: true };
  if (sameDay) return { text: 'Due today', overdue: due < now };
  return { text: `Due ${day}`, overdue: false };
}
