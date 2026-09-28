import { Ban, Building2, PhoneMissed, User } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * EntityBadge — who a call went to, in every table and drawer.
 *
 *   Agent       green dot, person icon     one of your agents answered
 *   Buyer       blue dot, building icon    a buyer took it
 *   Unanswered  amber dot                  nobody picked up
 *   Blocked     grey dot                   a gate stopped it (DNC, a cap)
 *
 * The same four colours as "Where your calls went" and the Today chart, so an
 * agent and a buyer can be told apart at a glance anywhere a call is named.
 * The dot and the icon both carry the kind: colour is never the only signal.
 */

export type Entity = 'agent' | 'buyer' | 'unanswered' | 'blocked';

const ENTITY: Record<
  Entity,
  { dot: string; ink: string; tint: string; icon: typeof User; noun: string }
> = {
  agent: {
    dot: 'bg-entity-agent',
    ink: 'text-entity-agent-ink',
    tint: 'bg-entity-agent-tint',
    icon: User,
    noun: 'Agent',
  },
  buyer: {
    dot: 'bg-entity-buyer',
    ink: 'text-entity-buyer-ink',
    tint: 'bg-entity-buyer-tint',
    icon: Building2,
    noun: 'Buyer',
  },
  unanswered: {
    dot: 'bg-entity-unanswered',
    ink: 'text-entity-unanswered-ink',
    tint: 'bg-entity-unanswered-tint',
    icon: PhoneMissed,
    noun: 'Unanswered',
  },
  blocked: {
    dot: 'bg-entity-blocked',
    ink: 'text-entity-blocked-ink',
    tint: 'bg-entity-blocked-tint',
    icon: Ban,
    noun: 'Blocked',
  },
};

/** The dot colour class for an entity, for legends and charts that draw their own. */
export function entityDotClass(kind: Entity): string {
  return ENTITY[kind].dot;
}

export interface EntityBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  kind: Entity;
  /** The agent's or buyer's name. Unanswered and Blocked say so without one. */
  name?: string | null;
  /** `inline` (default) for a table cell; `chip` on a tint for a drawer header. */
  variant?: 'inline' | 'chip';
}

export function EntityBadge({
  kind,
  name,
  variant = 'inline',
  className,
  ...props
}: EntityBadgeProps) {
  const entity = ENTITY[kind];
  const Icon = entity.icon;
  const text = name?.trim() || entity.noun;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle',
        variant === 'chip' && ['h-[22px] rounded-full px-2.5 t-meta font-medium', entity.tint],
        className
      )}
      data-entity={kind}
      title={name ? `${entity.noun}: ${name}` : entity.noun}
      {...props}
    >
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', entity.dot)} />
      <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', entity.ink)} />
      <span className={cn('min-w-0 truncate', variant === 'chip' ? entity.ink : 'text-ink')}>
        <span className="sr-only">{`${entity.noun}: `}</span>
        {text}
      </span>
    </span>
  );
}

/**
 * Which entity a call went to, and its name, from the columns a call row
 * carries. Blocked first (nobody was offered it), then an agent, then a buyer
 * -- the order Today's chart counts them in.
 */
export function entityOfCall(call: {
  blocked?: boolean | null;
  answeredByUserId?: string | null;
  agentName?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
}): { kind: Entity; name: string | null } {
  if (call.blocked) return { kind: 'blocked', name: null };
  if (call.answeredByUserId || call.agentName)
    return { kind: 'agent', name: call.agentName ?? null };
  if (call.buyerId || call.buyerName) return { kind: 'buyer', name: call.buyerName ?? null };
  return { kind: 'unanswered', name: null };
}
