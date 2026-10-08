'use client';

/**
 * A customer's tasks: what is next (open, most pressing first, each one
 * finished or dropped in a click) and what is done. Adding one is a single
 * line that opens up for the details only when the agent wants them.
 */

import { Ban, Calendar, Check, ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InsuranceTask } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { dueLabel, formatDateTime, PRIORITY_RANK, taskDueDate } from './format';
import { SELECT_CLASS } from './lead-field-inputs';
import { PRIORITY_OPTIONS } from './lead-fields';
import type { LeadTasks, NewTask } from './use-lead-record';

const PRIORITY_TONE: Record<InsuranceTask['priority'], string> = {
  URGENT: 'bg-dropped-tint text-dropped-ink',
  HIGH: 'bg-ringing-tint text-ringing-ink',
  NORMAL: 'bg-sunken text-ink-2',
  LOW: 'bg-sunken text-ink-3',
};

function sortOpen(tasks: InsuranceTask[]): InsuranceTask[] {
  return [...tasks].sort((a, b) => {
    const due = (t: InsuranceTask) => (t.dueAt ? taskDueDate(t.dueAt).getTime() : Infinity);
    if (due(a) !== due(b)) return due(a) - due(b);
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
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
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const open = task.status === 'OPEN';
  const due = task.dueAt ? dueLabel(task.dueAt) : null;
  const pending = tasks.pendingId === task.id;

  return (
    <li className={cn('flex items-start gap-3', compact ? 'py-2' : 'px-5 py-3')}>
      {open ? (
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
          {open && task.priority !== 'NORMAL' ? (
            <span
              className={cn(
                'inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-semibold',
                PRIORITY_TONE[task.priority]
              )}
            >
              {PRIORITY_OPTIONS.find(o => o.value === task.priority)?.label ?? task.priority}
            </span>
          ) : null}
        </div>
        {task.description ? (
          <p className={cn('mt-0.5 text-[13px] leading-5', open ? 'text-ink-2' : 'text-ink-3')}>
            {task.description}
          </p>
        ) : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-3">
          {open && due ? (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                due.overdue && 'font-medium text-dropped-ink'
              )}
            >
              <Calendar aria-hidden className="h-3.5 w-3.5" />
              {due.text}
            </span>
          ) : null}
          {open && !due ? <span>No due date</span> : null}
          {!open ? (
            <span>
              {task.status === 'COMPLETED'
                ? `Completed ${formatDateTime(task.completedAt ?? task.updatedAt)}`
                : `Cancelled ${formatDateTime(task.updatedAt)}`}
            </span>
          ) : null}
        </p>
      </div>

      {open ? (
        confirmCancel ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-[12.5px] text-ink-2">Cancel task?</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setConfirmCancel(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2"
              disabled={pending}
              onClick={() => {
                setConfirmCancel(false);
                void tasks.cancel(task.id);
              }}
            >
              Cancel task
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            disabled={pending}
            aria-label={`Cancel "${task.title}"`}
            title="Cancel task"
            className="shrink-0 rounded-control p-1 text-ink-3 transition-colors hover:bg-sunken hover:text-dropped-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Ban aria-hidden className="h-4 w-4" />
          </button>
        )
      ) : null}
    </li>
  );
}

/** Open tasks, then a fold of the finished ones. */
export function TaskList({
  list,
  tasks,
  compact = false,
  limit,
  emptyText = 'Nothing to do on this customer.',
}: {
  list: InsuranceTask[];
  tasks: LeadTasks;
  compact?: boolean;
  /** Open tasks shown; the rest are counted. */
  limit?: number;
  emptyText?: string;
}): JSX.Element {
  const [showDone, setShowDone] = React.useState(false);
  const open = sortOpen(list.filter(t => t.status === 'OPEN'));
  const done = list
    .filter(t => t.status !== 'OPEN')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = limit ? open.slice(0, limit) : open;

  return (
    <div>
      {open.length ? (
        <ul className="divide-y divide-rule">
          {shown.map(task => (
            <TaskRow key={task.id} task={task} tasks={tasks} compact={compact} />
          ))}
        </ul>
      ) : (
        <p className={cn('text-[13.5px] text-ink-3', compact ? 'py-2' : 'px-5 py-4')}>
          {emptyText}
        </p>
      )}
      {limit && open.length > limit ? (
        <p className={cn('text-[12.5px] text-ink-3', compact ? 'pb-1' : 'px-5 pb-3')}>
          +{open.length - limit} more open
        </p>
      ) : null}
      {!limit && done.length ? (
        <div className={cn('border-t border-rule', compact ? 'pt-1' : '')}>
          <button
            type="button"
            onClick={() => setShowDone(v => !v)}
            aria-expanded={showDone}
            className={cn(
              'flex w-full items-center gap-1.5 text-left text-[12.5px] font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              compact ? 'py-2' : 'px-5 py-2.5'
            )}
          >
            {showDone ? (
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            )}
            Completed &amp; cancelled ({done.length})
          </button>
          {showDone ? (
            <ul className="divide-y divide-rule">
              {done.map(task => (
                <TaskRow key={task.id} task={task} tasks={tasks} compact={compact} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line to add a task; the details open when it is focused. */
export function AddTaskForm({
  tasks,
  compact = false,
  autoFocus = false,
}: {
  tasks: LeadTasks;
  compact?: boolean;
  autoFocus?: boolean;
}): JSX.Element {
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<NewTask['priority']>('NORMAL');
  const [dueAt, setDueAt] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await tasks.create({ title: title.trim(), description, priority, dueAt });
    if (ok) {
      setTitle('');
      setDescription('');
      setPriority('NORMAL');
      setDueAt('');
      setExpanded(false);
    }
  };

  return (
    <form
      onSubmit={e => void submit(e)}
      className={cn('space-y-2', compact ? '' : 'px-5 py-4')}
      aria-label="Add a task"
    >
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Add a task — e.g. Call back about beneficiary"
          aria-label="Task title"
          autoFocus={autoFocus}
          required
        />
        <Button type="submit" disabled={tasks.creating || !title.trim()} className="shrink-0">
          {tasks.creating ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Plus aria-hidden className="h-4 w-4" />
          )}
          Add task
        </Button>
      </div>
      {expanded || title ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_160px]">
          <Input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Details (optional)"
            aria-label="Task details"
          />
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as NewTask['priority'])}
            aria-label="Priority"
            className={SELECT_CLASS}
          >
            {PRIORITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label} priority
              </option>
            ))}
          </select>
          <Input
            type="date"
            value={dueAt}
            onChange={e => setDueAt(e.target.value)}
            aria-label="Due date"
          />
        </div>
      ) : null}
    </form>
  );
}
