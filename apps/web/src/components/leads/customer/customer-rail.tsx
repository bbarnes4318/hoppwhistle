'use client';

/**
 * The Overview's operating rail: one tonal column beside the coverage, read
 * top to bottom as "what's open, who we spoke to, where the sale stands,
 * how to reach them". One region, divided by hairlines -- not a stack of
 * cards.
 */

import { ArrowRight, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import * as React from 'react';

import { StatusChip } from '@/components/domain';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import { cn, formatPhoneNumber } from '@/lib/utils';

import { CustomerCallList } from './customer-calls';
import { TaskList } from './customer-tasks';
import { addressLines, formatDateTime, priorityLabel, stageLabel, stageTone } from './format';
import type { LeadSectionId } from './lead-fields';
import type { LeadTasks } from './use-lead-record';
import { TextAction } from './workspace';

function RailSection({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  id: string;
}): JSX.Element {
  return (
    <section aria-labelledby={id} className="border-b border-rule px-6 py-5 last:border-b-0">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id={id} className="text-[14px] font-semibold text-ink">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[13px] text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[14px] font-medium text-ink">{children}</dd>
    </div>
  );
}

export function CustomerRail({
  lead,
  assignee,
  tasks,
  onOpenTasks,
  onAddTask,
  onOpenCalls,
  onEdit,
  className,
}: {
  lead: InsuranceLeadDetail;
  assignee: string | null;
  tasks: LeadTasks;
  onOpenTasks: () => void;
  onAddTask: () => void;
  onOpenCalls: () => void;
  onEdit: (section?: LeadSectionId) => void;
  className?: string;
}): JSX.Element {
  const calls = lead.calls ?? [];
  const address = addressLines(lead);
  const followUpDue = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) < new Date() : false;
  const openCount = (lead.tasks ?? []).filter(t => t.status === 'OPEN').length;

  return (
    <aside aria-label="Customer status" className={cn('min-w-0 bg-paper', className)}>
      <RailSection
        id="rail-tasks"
        title="Open tasks"
        action={
          openCount ? (
            <TextAction onClick={onOpenTasks}>
              All tasks <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </TextAction>
          ) : (
            <TextAction icon={Plus} onClick={onAddTask}>
              Add task
            </TextAction>
          )
        }
      >
        <TaskList
          list={lead.tasks ?? []}
          tasks={tasks}
          compact
          limit={3}
          empty={<p className="text-[13.5px] text-ink-3">No open tasks on this customer.</p>}
        />
      </RailSection>

      <RailSection
        id="rail-calls"
        title="Recent conversations"
        action={
          calls.length ? (
            <TextAction onClick={onOpenCalls}>
              All {calls.length} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </TextAction>
          ) : null
        }
      >
        <CustomerCallList calls={calls} limit={3} />
      </RailSection>

      <RailSection
        id="rail-status"
        title="Sales status"
        action={
          <TextAction icon={Pencil} onClick={() => onEdit('crm')} aria-label="Edit sales status">
            Edit
          </TextAction>
        }
      >
        <dl>
          <Row label="Stage">
            <StatusChip
              size="sm"
              value={lead.leadStage ?? 'NEW'}
              label={stageLabel(lead.leadStage)}
              tone={stageTone(lead.leadStage)}
            />
          </Row>
          <Row label="Priority">{priorityLabel(lead.priority) ?? 'Normal'}</Row>
          <Row label="Follow-up">
            {lead.nextFollowUpAt ? (
              <span className={followUpDue ? 'text-dropped-ink' : undefined}>
                {formatDateTime(lead.nextFollowUpAt)}
              </span>
            ) : (
              <span className="font-normal text-ink-3">None set</span>
            )}
          </Row>
          <Row label="Owner">
            {assignee ?? <span className="font-normal text-ink-3">Unassigned</span>}
          </Row>
          <Row label="Source">
            {lead.source ?? <span className="font-normal text-ink-3">Unknown</span>}
          </Row>
        </dl>
      </RailSection>

      <RailSection
        id="rail-contact"
        title="Contact"
        action={
          <TextAction icon={Pencil} onClick={() => onEdit()}>
            Edit customer
          </TextAction>
        }
      >
        <ul className="space-y-2 text-[14px]">
          <li className="flex items-start gap-3">
            <Phone aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-3" />
            {lead.phone ? (
              <span className="tabular-nums text-ink">{formatPhoneNumber(lead.phone)}</span>
            ) : (
              <span className="text-ink-3">No phone on record</span>
            )}
          </li>
          <li className="flex items-start gap-3">
            <Mail aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-3" />
            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="min-w-0 truncate text-ink hover:underline"
              >
                {lead.email}
              </a>
            ) : (
              <span className="text-ink-3">No email on record</span>
            )}
          </li>
          <li className="flex items-start gap-3">
            <MapPin aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-3" />
            {address.length ? (
              <span className="text-ink">
                {address.map(line => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-ink-3">No address on record</span>
            )}
          </li>
        </ul>
      </RailSection>
    </aside>
  );
}
