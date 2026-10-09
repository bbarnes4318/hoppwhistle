'use client';

import { CheckCircle2, CornerDownRight, MessageCircleQuestion, Sparkles } from 'lucide-react';

import {
  categoryLabel,
  interestPhrase,
  longDate,
  productAreaLabel,
  relativeTime,
  shortDate,
  type FeedbackItem,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackStatusChip, InterestButton, StageTrack, UnreadMarker } from './feedback-bits';

function Dot() {
  return (
    <span aria-hidden className="text-ink-3/70">
      ·
    </span>
  );
}

/**
 * One request in a list: what it is, where it stands, when it is targeted for,
 * the product team's latest word on it, and "I want this too".
 *
 * The whole row opens the request; the interest button is its own control and
 * does not.
 */
export function FeedbackRow({
  item,
  onOpen,
  onToggleInterest,
  busy,
}: {
  item: FeedbackItem;
  onOpen: (item: FeedbackItem) => void;
  onToggleInterest: (item: FeedbackItem) => void;
  busy?: boolean;
}) {
  const area = productAreaLabel(item.productArea);
  const closed =
    item.status === 'SHIPPED' || item.status === 'NOT_PLANNED' || item.status === 'MERGED';
  return (
    <li className="group relative" data-feedback-row={item.id}>
      <div
        // The whole row opens the request for a mouse; the title is the
        // control a keyboard or a screen reader uses, so nothing interactive
        // is nested inside another control.
        onClick={() => onOpen(item)}
        className={cn(
          'flex cursor-pointer flex-col gap-3 px-5 py-3.5 transition-colors duration-150 sm:flex-row sm:items-start sm:gap-5',
          'hover:bg-sunken/60 focus-within:bg-sunken/60',
          'min-[1440px]:px-6'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 t-body font-medium text-ink group-hover:text-brand-ink">
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  onOpen(item);
                }}
                className="text-left focus-visible:underline focus-visible:outline-none"
              >
                {item.title}
              </button>
            </h3>
            {item.unread ? <UnreadMarker /> : null}
            {item.needsReply ? (
              <span className="inline-flex items-center gap-1 t-meta font-medium text-ringing-ink">
                <MessageCircleQuestion aria-hidden className="h-3.5 w-3.5" />
                Your answer needed
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 t-meta text-ink-3">
            <span>{categoryLabel(item.category)}</span>
            {area ? (
              <>
                <Dot />
                <span>{area}</span>
              </>
            ) : null}
            {item.fromProductTeam ? (
              <>
                <Dot />
                <span className="inline-flex items-center gap-1 text-brand-ink">
                  <Sparkles aria-hidden className="h-3 w-3" />
                  From the product team
                </span>
              </>
            ) : item.isMine ? (
              <>
                <Dot />
                <span>You sent this {shortDate(item.createdAt)}</span>
              </>
            ) : item.submittedBy ? (
              <>
                <Dot />
                <span>From {item.submittedBy}</span>
              </>
            ) : null}
            <Dot />
            <span className="tabular-nums">{interestPhrase(item.interestCount)} interested</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <FeedbackStatusChip status={item.status} />
            <StageTrack status={item.status} />
            {item.status === 'SHIPPED' && item.shippedAt ? (
              <span className="t-meta text-ink-2">Shipped {longDate(item.shippedAt)}</span>
            ) : !closed ? (
              <span className="t-meta text-ink-2">
                <span className="text-ink-3">Target:</span> {item.target.label}
              </span>
            ) : null}
            {item.mergedInto ? (
              <span className="inline-flex items-center gap-1 t-meta text-ink-2">
                <CornerDownRight aria-hidden className="h-3 w-3" />
                Now part of #{item.mergedInto.number} {item.mergedInto.title}
              </span>
            ) : null}
          </div>

          {item.latestUpdate?.body ? (
            <p className="mt-2 line-clamp-2 border-l-2 border-brand/60 pl-2.5 t-meta text-ink-2">
              <span className="font-medium text-ink">
                {item.latestUpdate.headline ?? 'Product team update'}
              </span>
              <span className="text-ink-3"> · {relativeTime(item.latestUpdate.createdAt)}</span>
              <span className="block sm:inline"> — {item.latestUpdate.body}</span>
            </p>
          ) : item.summary ? (
            <p className="mt-2 line-clamp-1 t-meta text-ink-3">{item.summary}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center sm:pt-0.5">
          {closed && !item.isMine ? (
            item.viewerInterested ? (
              <span className="t-meta text-ink-3">You wanted this</span>
            ) : null
          ) : (
            <InterestButton
              interested={item.viewerInterested}
              count={item.interestCount}
              isMine={item.isMine}
              busy={busy}
              onToggle={() => onToggleInterest(item)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** One of the viewer's own requests, in the narrow My Feedback column. */
export function MyFeedbackRow({
  item,
  onOpen,
}: {
  item: FeedbackItem;
  onOpen: (item: FeedbackItem) => void;
}) {
  const closed =
    item.status === 'SHIPPED' || item.status === 'NOT_PLANNED' || item.status === 'MERGED';
  return (
    <li data-my-feedback={item.id}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="block w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 t-body font-medium text-ink">{item.title}</span>
          {item.unread ? (
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand"
              aria-label="New update"
            />
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <FeedbackStatusChip status={item.status} />
          {!closed && item.target.kind !== 'NONE' ? (
            <span className="t-meta text-ink-2">Target: {item.target.label}</span>
          ) : null}
        </div>
        {item.needsReply ? (
          <p className="mt-1.5 inline-flex items-center gap-1 t-meta font-medium text-ringing-ink">
            <MessageCircleQuestion aria-hidden className="h-3.5 w-3.5" />
            The product team asked you a question
          </p>
        ) : item.latestUpdate?.body ? (
          <p className="mt-1.5 line-clamp-2 t-meta text-ink-2">
            {item.unread ? <span className="font-medium text-brand-ink">New update · </span> : null}
            &ldquo;{item.latestUpdate.body}&rdquo;
          </p>
        ) : null}
        <p className="mt-1 t-meta text-ink-3">Submitted {shortDate(item.createdAt)}</p>
      </button>
    </li>
  );
}

/** A release: what shipped, when, and how many people asked for it. */
export function ShippedCard({
  item,
  onOpen,
}: {
  item: FeedbackItem;
  onOpen: (item: FeedbackItem) => void;
}) {
  return (
    <li data-shipped={item.id}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="group block w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-sunken/60 focus-visible:bg-sunken/60 focus-visible:outline-none"
      >
        <div className="flex items-start gap-2.5">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-live" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="t-body font-medium text-ink group-hover:text-brand-ink">
                {item.title}
              </span>
              {item.unread ? <UnreadMarker label="New" /> : null}
            </div>
            <p className="mt-0.5 t-meta text-ink-3">
              {item.shippedAt ? `Shipped ${longDate(item.shippedAt)}` : 'Shipped'}
              {item.interestCount > 0
                ? ` · Asked for by ${interestPhrase(item.interestCount)}`
                : ''}
            </p>
            {item.latestUpdate?.body ? (
              <p className="mt-1 line-clamp-2 t-meta text-ink-2">{item.latestUpdate.body}</p>
            ) : null}
            <span className="mt-1 inline-block t-meta font-medium text-brand-ink">
              View what changed →
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}
