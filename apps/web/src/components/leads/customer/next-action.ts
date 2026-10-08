/**
 * "What should I do next?" -- answered from the record, never invented.
 *
 * In order, the first that holds:
 *   1. an overdue task                        -> do it (overdue)
 *   2. a follow-up whose time has passed      -> follow up (overdue)
 *   3. the soonest open task                  -> do it
 *   4. a follow-up still to come              -> follow up then
 *   5. a chosen plan with no application      -> write the application
 *   6. a final expense customer never quoted  -> quote them
 *   7. otherwise                              -> nothing is scheduled
 *
 * Pure, so the rule is tested without a browser.
 */

import type { InsuranceLeadDetail, InsuranceTask } from '@/lib/api/leads';
import type { FexQuoteSummary } from '@/lib/fex/api';

import { dueLabel, formatDateTime, openTasks } from './format';

export type NextActionKind = 'task' | 'follow-up' | 'application' | 'quote' | 'none';

export interface NextAction {
  kind: NextActionKind;
  /** The action, in a few words: "Follow up", "Write the application". */
  title: string;
  /** When, or from what: "Due today", "Oct 9, 2:00 PM", "From the selected Trinity plan". */
  detail: string | null;
  overdue: boolean;
  task?: InsuranceTask;
}

export function deriveNextAction(
  lead: InsuranceLeadDetail,
  opts: {
    featured: FexQuoteSummary | null;
    written: boolean;
    /** The customer's quotes have loaded and there are none. */
    neverQuoted: boolean;
    now?: Date;
  }
): NextAction {
  const now = opts.now ?? new Date();
  const { open } = openTasks(lead, now);
  const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const followUpValid = followUp && !Number.isNaN(followUp.getTime()) ? followUp : null;

  const taskAction = (task: InsuranceTask): NextAction => {
    const due = task.dueAt ? dueLabel(task.dueAt, now) : null;
    return {
      kind: 'task',
      title: task.title,
      detail: due?.text ?? 'No due date',
      overdue: due?.overdue ?? false,
      task,
    };
  };
  const followUpAction = (at: Date): NextAction => ({
    kind: 'follow-up',
    title: at < now ? 'Follow-up is overdue' : 'Follow up',
    detail: formatDateTime(at.toISOString()),
    overdue: at < now,
  });

  const first = open[0];
  if (first?.dueAt && dueLabel(first.dueAt, now).overdue) return taskAction(first);
  if (followUpValid && followUpValid < now) return followUpAction(followUpValid);
  if (first) return taskAction(first);
  if (followUpValid) return followUpAction(followUpValid);
  if (opts.featured && !opts.featured.applicationId && !opts.written) {
    return {
      kind: 'application',
      title: 'Write the application',
      detail: opts.featured.selectedCarrier
        ? `From the ${opts.featured.selectedCarrier} plan`
        : 'From the selected plan',
      overdue: false,
    };
  }
  if (lead.vertical === 'FE' && opts.neverQuoted) {
    return { kind: 'quote', title: 'Quote this customer', detail: null, overdue: false };
  }
  return { kind: 'none', title: 'Nothing scheduled', detail: null, overdue: false };
}
