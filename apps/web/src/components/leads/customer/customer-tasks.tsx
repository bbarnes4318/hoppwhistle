'use client';

/**
 * A customer's tasks, worked as a queue: the most pressing open task leads
 * as the Next action (what, when, how urgent, and Complete beside it), the
 * rest of the open ones follow, and the finished ones fold away. Adding one
 * is a short composer: a title, a due day in one click, a priority, Enter.
 */

import {
  Ban,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Loader2,
  Plus,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InsuranceTask } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { dueLabel, formatDateTime, PRIORITY_RANK, taskDueDate } from './format';
import { PRIORITY_OPTIONS } from './lead-fields';
import { InlineEmpty } from './primitives';
import type { LeadTasks, NewTask } from './use-lead-record';

const PRIORITY_TONE: Record<InsuranceTask['priority'], string> = {
  URGENT: 'bg-dropped-tint text-dropped-ink',
  HIGH: 'bg-ringing-tint text-ringing-ink',
  NORMAL: 'bg-sunken text-ink-2',
  LOW: 'bg-sunken text-ink-3',
};

const priorityName = (p: InsuranceTask['priority']) =>
  PRIORITY_OPTIONS.find(o => o.value === p)?.label ?? p;

function sortOpen(tasks: InsuranceTask[]): InsuranceTask[] {
  return [...tasks].sort((a, b) => {
    const due = (t: InsuranceTask) => (t.dueAt ? taskDueDate(t.dueAt).getTime() : Infinity);
    if (due(a) !== due(b)) return due(a) - due(b);
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

function PriorityTag({ priority }: { priority: InsuranceTask['priority'] }): JSX.Element | null {
  if (priority === 'NORMAL') return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11.5px] font-semibold',
        PRIORITY_TONE[priority]
      )}
    >
      {priorityName(priority)}
    </span>
  );
}

function Due({ task, empty = 'No due date' }: { task: InsuranceTask; empty?: string }) {
  if (!task.dueAt) return <span className="text-ink-3">{empty}</span>;
  const due = dueLabel(task.dueAt);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        due.overdue ? 'font-medium text-dropped-ink' : 'text-ink-2'
      )}
    >
      <Calendar aria-hidden className="h-3.5 w-3.5" />
      {due.text}
    </span>
  );
}

/** Cancel asks first, in place: a dropped task does not come back. */
function CancelControl({ task, tasks }: { task: InsuranceTask; tasks: LeadTasks }) {
  const [confirm, setConfirm] = React.useState(false);
  const pending = tasks.pendingId === task.id;
  if (confirm) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 text-[12.5px] text-ink-2">Cancel task?</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirm(false)}>
          Keep
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-2"
          disabled={pending}
          onClick={() => {
            setConfirm(false);
            void tasks.cancel(task.id);
          }}
        >
          Cancel task
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      disabled={pending}
      aria-label={`Cancel "${task.title}"`}
      title="Cancel task"
      className="shrink-0 rounded-control p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-dropped-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Ban aria-hidden className="h-4 w-4" />
    </button>
  );
}

function CompleteCircle({ task, tasks }: { task: InsuranceTask; tasks: LeadTasks }) {
  const pending = tasks.pendingId === task.id;
  return (
    <button
      type="button"
      onClick={() => void tasks.complete(task.id)}
      disabled={pending}
      aria-label={`Complete "${task.title}"`}
      title="Mark complete"
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rule-strong text-transparent transition-colors hover:border-live hover:bg-live-tint hover:text-live-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      {pending ? (
        <Loader2 aria-hidden className="h-3 w-3 animate-spin text-ink-3" />
      ) : (
        <Check aria-hidden className="h-3 w-3" />
      )}
    </button>
  );
}

function TaskRow({
  task,
  tasks,
  compact,
}: {
  task: InsuranceTask;
  tasks: LeadTasks;
  compact?: boolean;
}): JSX.Element {
  const open = task.status === 'OPEN';

  return (
    <li className={cn('flex items-start gap-3', compact ? 'py-2' : 'px-5 py-3')}>
      {open ? (
        <CompleteCircle task={task} tasks={tasks} />
      ) : (
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
            task.status === 'COMPLETED' ? 'bg-live-tint text-live-ink' : 'bg-sunken text-ink-3'
          )}
        >
          {task.status === 'COMPLETED' ? (
            <Check className="h-3 w-3" />
          ) : (
            <Ban className="h-3 w-3" />
          )}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'text-[14px] font-medium leading-5',
              open ? 'text-ink' : 'text-ink-3 line-through'
            )}
          >
            {task.title}
          </span>
          {open ? <PriorityTag priority={task.priority} /> : null}
        </div>
        {task.description ? (
          <p className={cn('mt-0.5 text-[13px] leading-5', open ? 'text-ink-2' : 'text-ink-3')}>
            {task.description}
          </p>
        ) : null}
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {open ? (
            <Due task={task} />
          ) : task.status === 'COMPLETED' ? (
            `Completed ${formatDateTime(task.completedAt ?? task.updatedAt)}`
          ) : (
            `Cancelled ${formatDateTime(task.updatedAt)}`
          )}
        </p>
      </div>

      {open ? <CancelControl task={task} tasks={tasks} /> : null}
    </li>
  );
}

/** The open task that comes first, given the room to be acted on. */
function NextAction({ task, tasks }: { task: InsuranceTask; tasks: LeadTasks }): JSX.Element {
  const pending = tasks.pendingId === task.id;
  return (
    <section
      aria-label="Next action"
      className="mx-5 mt-4 rounded-[10px] border border-rule bg-paper px-4 py-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-brand-ink">Next action</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold leading-6 text-ink">{task.title}</span>
            <PriorityTag priority={task.priority} />
          </p>
          {task.description ? (
            <p className="mt-0.5 text-[13.5px] leading-5 text-ink-2">{task.description}</p>
          ) : null}
          <p className="mt-1.5 text-[13px]">
            <Due task={task} empty="No due date set" />
          </p>
        </div>
        <CancelControl task={task} tasks={tasks} />
      </div>
      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void tasks.complete(task.id)}
          aria-label={`Complete "${task.title}"`}
        >
          {pending ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check aria-hidden className="h-3.5 w-3.5" />
          )}
          Mark complete
        </Button>
      </div>
    </section>
  );
}

/** Finished tasks, folded away under the open ones. */
function DoneFold({
  done,
  tasks,
  compact,
}: {
  done: InsuranceTask[];
  tasks: LeadTasks;
  compact?: boolean;
}): JSX.Element | null {
  const [show, setShow] = React.useState(false);
  if (!done.length) return null;
  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        aria-expanded={show}
        className={cn(
          'flex w-full items-center gap-1.5 text-left text-[13px] font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'py-2' : 'px-5 py-3'
        )}
      >
        {show ? (
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
        )}
        Completed &amp; cancelled
        <span className="tabular-nums text-ink-3">{done.length}</span>
      </button>
      {show ? (
        <ul className="divide-y divide-rule">
          {done.map(task => (
            <TaskRow key={task.id} task={task} tasks={tasks} compact={compact} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Open tasks, most pressing first, then a fold of the finished ones. With
 * `featureNext`, the first open task leads as the Next action.
 */
export function TaskList({
  list,
  tasks,
  compact = false,
  limit,
  featureNext = false,
  empty,
}: {
  list: InsuranceTask[];
  tasks: LeadTasks;
  compact?: boolean;
  /** Open tasks shown; the rest are counted. */
  limit?: number;
  featureNext?: boolean;
  /** What shows with nothing open. */
  empty?: React.ReactNode;
}): JSX.Element {
  const open = sortOpen(list.filter(t => t.status === 'OPEN'));
  const done = list
    .filter(t => t.status !== 'OPEN')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [next, ...rest] = open;
  const rows = featureNext ? rest : open;
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <div>
      {featureNext && next ? <NextAction task={next} tasks={tasks} /> : null}
      {!open.length ? empty : null}
      {shown.length ? (
        <>
          {featureNext ? (
            <h3 className="px-5 pb-1 pt-4 text-[13px] font-semibold text-ink-2">
              Also open <span className="font-medium tabular-nums text-ink-3">{rest.length}</span>
            </h3>
          ) : null}
          <ul className="divide-y divide-rule">
            {shown.map(task => (
              <TaskRow key={task.id} task={task} tasks={tasks} compact={compact} />
            ))}
          </ul>
        </>
      ) : featureNext && next ? (
        <div className="h-4" />
      ) : null}
      {limit && rows.length > limit ? (
        <p className={cn('text-[12.5px] text-ink-3', compact ? 'pb-1' : 'px-5 pb-3')}>
          +{rows.length - limit} more open
        </p>
      ) : null}
      {!limit ? <DoneFold done={done} tasks={tasks} compact={compact} /> : null}
    </div>
  );
}

/** The "no open tasks" state, with the way to add one. */
export function NoOpenTasks({
  onAdd,
  className,
}: {
  onAdd?: () => void;
  className?: string;
}): JSX.Element {
  return (
    <InlineEmpty
      className={className}
      icon={ListChecks}
      title="No open tasks"
      body="Create a follow-up so this customer doesn't fall through."
      action={
        onAdd ? (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add task
          </Button>
        ) : null
      }
    />
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

const QUICK_DUE: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

/**
 * Add a task: the title, then a due day in one click (or any date), a
 * priority, and Enter. Escape closes it. In the CRM sheet it stays open.
 */
export function AddTaskForm({
  tasks,
  compact = false,
  autoFocus = false,
  onClose,
}: {
  tasks: LeadTasks;
  compact?: boolean;
  autoFocus?: boolean;
  /** Offered as Cancel and on Escape; absent, the form is always shown. */
  onClose?: () => void;
}): JSX.Element {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<NewTask['priority']>('NORMAL');
  const [dueAt, setDueAt] = React.useState(compact ? '' : inDays(1));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await tasks.create({ title: title.trim(), description, priority, dueAt });
    if (ok) {
      setTitle('');
      setDescription('');
      setPriority('NORMAL');
      setDueAt(compact ? '' : inDays(1));
      onClose?.();
    }
  };

  return (
    <form
      onSubmit={e => void submit(e)}
      onKeyDown={e => {
        if (e.key === 'Escape' && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn('space-y-3', compact ? '' : 'px-5 py-4')}
      aria-label="Add a task"
    >
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What needs to happen? e.g. Call back about the beneficiary"
        aria-label="Task title"
        autoFocus={autoFocus}
        required
      />
      <Input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Details (optional)"
        aria-label="Task details"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Due">
          <span className="mr-0.5 text-[12.5px] text-ink-3">Due</span>
          {QUICK_DUE.map(q => {
            const value = inDays(q.days);
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => setDueAt(value)}
                aria-pressed={dueAt === value}
                className={cn(
                  'h-7 rounded-control border px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  dueAt === value
                    ? 'border-brand-ink bg-brand-tint text-brand-ink'
                    : 'border-rule bg-surface text-ink-2 hover:bg-sunken hover:text-ink'
                )}
              >
                {q.label}
              </button>
            );
          })}
          <Input
            type="date"
            value={dueAt}
            onChange={e => setDueAt(e.target.value)}
            aria-label="Due date"
            className="h-7 w-[140px] px-2 text-[12.5px]"
          />
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Priority">
          <span className="mr-0.5 text-[12.5px] text-ink-3">Priority</span>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as NewTask['priority'])}
            aria-label="Priority"
            className="h-7 rounded-control border border-rule bg-surface px-2 text-[12.5px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PRIORITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {onClose ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={tasks.creating || !title.trim()}>
          {tasks.creating ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus aria-hidden className="h-3.5 w-3.5" />
          )}
          Add task
        </Button>
      </div>
    </form>
  );
}
