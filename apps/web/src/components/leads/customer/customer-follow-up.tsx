'use client';

/**
 * Notes & tasks as a follow-up workspace: the next action across the top --
 * what it is, when, and the button to move it -- then the work beneath it in
 * two columns on the same sheet: the tasks queue, and the notes stream.
 */

import { CalendarPlus, Check, Loader2, Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { cn } from '@/lib/utils';

import { CustomerNotes } from './customer-notes';
import { AddTaskForm, TaskList } from './customer-tasks';
import { dueLabel, formatDateTime, openTasks } from './format';
import type { NextAction } from './next-action';
import type { LeadTasks } from './use-lead-record';
import { Kicker, TextAction } from './workspace';

/**
 * The follow-up plan across the top of the tab: when we next speak to them
 * (and the button to set or move it), beside the task that comes first (and
 * the button to finish it). The command center above already names the one
 * next action; this is the plan behind it.
 */
function FollowUpPlan({
  lead,
  next,
  tasks,
  onScheduleFollowUp,
  onAddTask,
}: {
  lead: InsuranceLeadDetail;
  next: NextAction;
  tasks: LeadTasks;
  onScheduleFollowUp: () => void;
  onAddTask: () => void;
}): JSX.Element {
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const followUpDue = followUp ? followUp < new Date() : false;
  const first = openTasks(lead).open[0] ?? null;
  const pending = Boolean(first && tasks.pendingId === first.id);
  const firstDue = first?.dueAt ? dueLabel(first.dueAt) : null;

  return (
    <section
      aria-label="Follow-up plan"
      className="grid border-b border-rule bg-paper md:grid-cols-2 md:divide-x md:divide-rule"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-7 py-5">
        <div className="min-w-0">
          <Kicker className={followUpDue ? 'text-dropped-ink' : undefined}>Next follow-up</Kicker>
          <p
            className={cn(
              'mt-1.5 text-[18px] font-semibold leading-6',
              !followUp ? 'text-ink-2' : followUpDue ? 'text-dropped-ink' : 'text-ink'
            )}
          >
            {followUp ? formatDateTime(lead.nextFollowUpAt) : 'Not scheduled'}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {followUp
              ? followUpDue
                ? 'This follow-up has passed.'
                : 'When to speak to them next.'
              : "Set one so this customer doesn't fall through."}
          </p>
        </div>
        <Button
          variant={!followUp || followUpDue ? 'default' : 'outline'}
          onClick={onScheduleFollowUp}
        >
          <CalendarPlus aria-hidden className="h-4 w-4" />
          {followUp ? 'Reschedule' : 'Schedule follow-up'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule px-7 py-5 md:border-t-0">
        <div className="min-w-0">
          <Kicker className={firstDue?.overdue ? 'text-dropped-ink' : undefined}>First task</Kicker>
          <p
            className={cn(
              'mt-1.5 truncate text-[18px] font-semibold leading-6',
              first ? 'text-ink' : 'text-ink-2'
            )}
          >
            {first ? first.title : 'No open tasks'}
          </p>
          <p
            className={cn(
              'mt-0.5 truncate text-[13px]',
              firstDue?.overdue ? 'font-medium text-dropped-ink' : 'text-ink-3'
            )}
          >
            {first
              ? [
                  firstDue?.text ?? 'No due date',
                  first.priority !== 'NORMAL' ? `${first.priority.toLowerCase()} priority` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Add one for anything you promised them.'}
          </p>
        </div>
        {first ? (
          <Button
            variant={next.kind === 'task' && next.task?.id === first.id ? 'default' : 'outline'}
            disabled={pending}
            onClick={() => void tasks.complete(first.id)}
            aria-label={`Complete "${first.title}"`}
          >
            {pending ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Check aria-hidden className="h-4 w-4" />
            )}
            Mark done
          </Button>
        ) : (
          <Button variant="outline" onClick={onAddTask}>
            <Plus aria-hidden className="h-4 w-4" />
            Add task
          </Button>
        )}
      </div>
    </section>
  );
}

export function CustomerFollowUp({
  lead,
  next,
  tasks,
  addingTask,
  onAddingTask,
  onScheduleFollowUp,
  onSaved,
}: {
  lead: InsuranceLeadDetail;
  next: NextAction;
  tasks: LeadTasks;
  addingTask: boolean;
  onAddingTask: (adding: boolean) => void;
  onScheduleFollowUp: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { open, overdue } = openTasks(lead);
  const list = lead.tasks ?? [];

  return (
    <div>
      <FollowUpPlan
        lead={lead}
        next={next}
        tasks={tasks}
        onScheduleFollowUp={onScheduleFollowUp}
        onAddTask={() => onAddingTask(true)}
      />
      <div className="grid min-h-[420px] lg:grid-cols-2 lg:divide-x lg:divide-rule">
        <section aria-labelledby="tasks-title" className="min-w-0">
          <div className="flex min-h-[56px] items-center justify-between gap-3 px-7 pt-4">
            <h2
              id="tasks-title"
              className="flex items-baseline gap-2.5 text-[15px] font-semibold text-ink"
            >
              Tasks
              <span className="text-[13px] font-medium text-ink-3">
                {open.length ? `${open.length} open` : 'None open'}
                {overdue ? ` · ${overdue} overdue` : ''}
              </span>
            </h2>
            {addingTask ? null : (
              <TextAction icon={Plus} onClick={() => onAddingTask(true)}>
                Add task
              </TextAction>
            )}
          </div>
          {addingTask ? (
            <div className="mx-7 mt-3 rounded-[10px] border border-rule bg-paper">
              <AddTaskForm tasks={tasks} autoFocus onClose={() => onAddingTask(false)} />
            </div>
          ) : null}
          <div className="pb-4 pt-2">
            <TaskList
              list={list}
              tasks={tasks}
              empty={
                addingTask ? null : (
                  <button
                    type="button"
                    onClick={() => onAddingTask(true)}
                    className="mx-7 flex w-[calc(100%-3.5rem)] items-center gap-3 rounded-[10px] border border-dashed border-rule-strong px-4 py-3.5 text-left text-[14px] text-ink-3 transition-colors hover:border-brand-ink hover:bg-brand-tint hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    Add a task — a callback, a document to send, anything you promised
                  </button>
                )
              }
            />
          </div>
        </section>
        <CustomerNotes lead={lead} onSaved={onSaved} />
      </div>
    </div>
  );
}
