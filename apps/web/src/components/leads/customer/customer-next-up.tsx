'use client';

/**
 * Overview's "what's next": the open tasks, most pressing first, and the
 * last few calls -- each with the way into its full tab.
 */

import { ArrowRight } from 'lucide-react';
import * as React from 'react';

import { Panel } from '@/components/domain';
import type { InsuranceLeadDetail } from '@/lib/api/leads';

import { CustomerCallList } from './customer-calls';
import { TaskList } from './customer-tasks';
import type { LeadTasks } from './use-lead-record';

function PanelLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

export function CustomerNextUp({
  lead,
  tasks,
  onOpenTasks,
  onOpenCalls,
}: {
  lead: InsuranceLeadDetail;
  tasks: LeadTasks;
  onOpenTasks: () => void;
  onOpenCalls: () => void;
}): JSX.Element {
  const calls = lead.calls ?? [];
  return (
    <Panel className="min-w-0 overflow-hidden" aria-label="Next up">
      <section className="px-5 pb-2 pt-3.5" aria-labelledby="next-tasks-title">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="next-tasks-title"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3"
          >
            Open tasks
          </h2>
          <PanelLink onClick={onOpenTasks}>Add or view all</PanelLink>
        </div>
        <TaskList
          list={lead.tasks ?? []}
          tasks={tasks}
          compact
          limit={3}
          emptyText="No open tasks."
        />
      </section>
      <section
        className="border-t border-rule px-5 pb-2 pt-3.5"
        aria-labelledby="recent-calls-title"
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id="recent-calls-title"
            className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3"
          >
            Recent calls
          </h2>
          {calls.length ? <PanelLink onClick={onOpenCalls}>All {calls.length}</PanelLink> : null}
        </div>
        <CustomerCallList calls={calls} limit={3} />
      </section>
    </Panel>
  );
}
