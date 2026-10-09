'use client';

import { FEEDBACK_URGENCY_LABELS } from '@hopwhistle/shared';
import { CornerDownRight, Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react';
import * as React from 'react';

import { Notice, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { useBrand } from '@/hooks/use-brand';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  categoryLabel,
  wantPhrase,
  longDate,
  productAreaLabel,
  relativeTime,
  shortDate,
  type FeedbackDetail,
  type FeedbackThreadEntry,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackStatusChip, InterestButton, StageTrack, StatusTimeline } from './feedback-bits';

/**
 * One request, opened: what was asked, where it stands, every stage it has
 * reached, and everything the product team has said about it.
 *
 * Opening it marks its latest update read. The submitter (and their agency's
 * administrators) can answer the product team from the foot of the drawer;
 * when the team has asked a question, the drawer leads with it.
 */
export function FeedbackDetailDrawer({
  id,
  onClose,
  onChanged,
  onOpenOther,
}: {
  id: string | null;
  onClose: () => void;
  /** Something about this request changed: interest, a reply, read state. */
  onChanged: () => void;
  onOpenOther: (id: string) => void;
}) {
  const [detail, setDetail] = React.useState<FeedbackDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [voting, setVoting] = React.useState(false);
  const replyRef = React.useRef<HTMLTextAreaElement>(null);

  const load = React.useCallback(async (feedbackId: string) => {
    const response = await apiClient.get<Envelope<FeedbackDetail>>(
      `/api/v1/feedback/${feedbackId}`
    );
    const data = payload(response);
    if (response.error || !data) {
      setError(
        response.error?.code === 'NOT_FOUND'
          ? 'This request is not available to you. It may be private to the person who sent it.'
          : (response.error?.message ?? 'Could not load this request.')
      );
      return null;
    }
    setError(null);
    setDetail(data);
    return data;
  }, []);

  React.useEffect(() => {
    setDetail(null);
    setError(null);
    setReply('');
    if (!id) return;
    let cancelled = false;
    void load(id).then(data => {
      if (cancelled || !data) return;
      if (data.unread) {
        void apiClient.post(`/api/v1/feedback/${id}/read`, {}).then(() => onChanged());
      }
    });
    return () => {
      cancelled = true;
    };
    // onChanged is the parent's refresh; re-reading on its identity is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  async function toggleInterest() {
    if (!detail) return;
    setVoting(true);
    try {
      const response = detail.viewerInterested
        ? await apiClient.delete<Envelope<{ interestCount: number }>>(
            `/api/v1/feedback/${detail.id}/vote`
          )
        : await apiClient.post<Envelope<{ interestCount: number }>>(
            `/api/v1/feedback/${detail.id}/vote`,
            {}
          );
      const data = payload(response);
      if (response.error || !data) {
        toast.error('That did not go through', response.error?.message);
        return;
      }
      setDetail({
        ...detail,
        viewerInterested: !detail.viewerInterested,
        interestCount: data.interestCount,
      });
      onChanged();
    } finally {
      setVoting(false);
    }
  }

  async function sendReply() {
    if (!detail || !reply.trim()) return;
    setSending(true);
    try {
      const response = await apiClient.post<Envelope<FeedbackDetail>>(
        `/api/v1/feedback/${detail.id}/replies`,
        { body: reply.trim() }
      );
      const data = payload(response);
      if (response.error || !data) {
        toast.error('Your reply was not sent', response.error?.message);
        return;
      }
      setDetail(data);
      setReply('');
      toast.success('Reply sent to the product team');
      onChanged();
    } finally {
      setSending(false);
    }
  }

  const open = id !== null;
  const area = detail ? productAreaLabel(detail.productArea) : null;
  const closed =
    detail &&
    (detail.status === 'SHIPPED' || detail.status === 'NOT_PLANNED' || detail.status === 'MERGED');
  const openQuestion = detail?.needsReply
    ? [...detail.thread].reverse().find(entry => entry.kind === 'QUESTION')
    : undefined;

  return (
    <SheetDrawer
      open={open}
      onOpenChange={next => (next ? null : onClose())}
      size="xl"
      title={detail?.title ?? (error ? 'Request unavailable' : 'Loading…')}
      description={
        detail
          ? [`#${detail.number}`, categoryLabel(detail.category), area].filter(Boolean).join(' · ')
          : undefined
      }
      footer={
        detail?.canReply ? (
          <div className="space-y-2">
            <Textarea
              ref={replyRef}
              value={reply}
              onChange={event => setReply(event.target.value)}
              placeholder={
                detail.needsReply
                  ? 'Answer the product team’s question…'
                  : 'Add more detail for the product team…'
              }
              rows={2}
              maxLength={5000}
              className="min-h-[64px] resize-none"
              aria-label="Reply to the product team"
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void sendReply();
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="t-meta text-ink-3">
                Only you, your agency’s administrators and the product team see replies.
              </span>
              <Button
                size="sm"
                onClick={() => void sendReply()}
                disabled={sending || !reply.trim()}
              >
                {sending ? (
                  <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Send reply
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <div className="p-5">
          <Notice tone="error" title={error} />
        </div>
      ) : !detail ? (
        <DrawerSkeleton />
      ) : (
        <div data-feedback-detail={detail.id}>
          {/* Where it stands */}
          <section className="border-b border-rule px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <FeedbackStatusChip status={detail.status} />
              <StageTrack status={detail.status} />
              {detail.status === 'SHIPPED' && detail.shippedAt ? (
                <span className="t-body text-ink-2">Shipped {longDate(detail.shippedAt)}</span>
              ) : !closed ? (
                <span className="t-body text-ink-2">
                  <span className="text-ink-3">Target:</span> {detail.target.label}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="t-meta text-ink-3">
                {detail.fromProductTeam ? (
                  <span className="inline-flex items-center gap-1 text-brand-ink">
                    <Sparkles aria-hidden className="h-3 w-3" />
                    Added by the product team
                  </span>
                ) : detail.isMine ? (
                  `You sent this on ${shortDate(detail.createdAt)}`
                ) : detail.submittedBy ? (
                  `Sent by ${detail.submittedBy} on ${shortDate(detail.createdAt)}`
                ) : (
                  `Sent ${shortDate(detail.createdAt)}`
                )}
                {' · '}
                <span className="tabular-nums">{wantPhrase(detail.interestCount)}</span>
              </p>
              {detail.canVote || detail.isMine ? (
                <InterestButton
                  size="md"
                  interested={detail.viewerInterested}
                  count={detail.interestCount}
                  isMine={detail.isMine}
                  busy={voting}
                  onToggle={() => void toggleInterest()}
                />
              ) : null}
            </div>
            {detail.mergedInto ? (
              <button
                type="button"
                onClick={() => detail.mergedInto && onOpenOther(detail.mergedInto.id)}
                className="mt-3 flex w-full items-center gap-2 rounded-control border border-rule bg-sunken/60 px-3 py-2 text-left t-body text-ink-2 hover:text-ink"
              >
                <CornerDownRight aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />
                <span>
                  Combined with a similar request,{' '}
                  <span className="font-medium text-ink">
                    #{detail.mergedInto.number} {detail.mergedInto.title}
                  </span>
                  . You’re following that one now.
                </span>
              </button>
            ) : null}
          </section>

          {openQuestion ? (
            <section className="border-b border-rule bg-ringing-tint/50 px-5 py-4">
              <p className="flex items-center gap-1.5 t-label text-ringing-ink">
                <MessageCircleQuestion aria-hidden className="h-4 w-4" />
                The product team needs more information
              </p>
              <p className="mt-1.5 whitespace-pre-line t-body text-ink">{openQuestion.body}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => replyRef.current?.focus()}
              >
                Answer below
              </Button>
            </section>
          ) : null}

          <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_250px]">
            <div className="min-w-0 md:border-r md:border-rule">
              {/* The request itself */}
              {detail.description ? (
                <section className="border-b border-rule px-5 py-4">
                  <h3 className="t-label mb-2 text-ink-3">
                    {detail.ownTenant ? 'The request' : 'About this'}
                  </h3>
                  <p className="whitespace-pre-line t-body text-ink">{detail.description}</p>
                  {detail.originalTitle ? (
                    <p className="mt-2 t-meta text-ink-3">
                      Originally sent as &ldquo;{detail.originalTitle}&rdquo;
                    </p>
                  ) : null}
                  {detail.urgency ? (
                    <p className="mt-2 t-meta text-ink-3">
                      Impact: {FEEDBACK_URGENCY_LABELS[detail.urgency]}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {/* What the product team has said */}
              <section className="px-5 py-4">
                <h3 className="t-label mb-3 text-ink-3">Updates</h3>
                {detail.thread.length === 0 ? (
                  <p className="t-body text-ink-3">
                    {closed
                      ? 'No updates were posted on this request.'
                      : 'No updates yet. When the product team posts one, it appears here and you’ll see a “New update” marker on the request.'}
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {[...detail.thread].reverse().map(entry => (
                      <ThreadEntry key={entry.id} entry={entry} />
                    ))}
                  </ol>
                )}
              </section>
            </div>

            {/* Every stage it has reached */}
            <section className="border-t border-rule px-5 py-4 md:border-t-0">
              <h3 className="t-label mb-3 text-ink-3">Progress</h3>
              <StatusTimeline events={detail.timeline} current={detail.status} />
            </section>
          </div>
        </div>
      )}
    </SheetDrawer>
  );
}

/**
 * One entry in the thread. The product team's posts are drawn as official
 * updates -- the agency's mark, "Product Team", a heading -- so they never read
 * like just another comment.
 */
function ThreadEntry({ entry }: { entry: FeedbackThreadEntry }) {
  const { brand } = useBrand();
  const fromTeam = entry.kind !== 'USER_REPLY';
  const question = entry.kind === 'QUESTION';
  return (
    <li
      className={cn(
        'rounded-control border px-3.5 py-3',
        question
          ? 'border-ringing/40 bg-ringing-tint/40'
          : fromTeam
            ? 'border-brand/30 bg-brand-tint/40'
            : 'border-rule bg-surface'
      )}
      data-thread-kind={entry.kind}
    >
      <div className="flex items-center gap-2">
        {fromTeam ? (
          brand ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 20px brand mark, from /public
            <img src={brand.markSmall} alt="" className="h-5 w-5 shrink-0 rounded-[5px]" />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-brand text-brand-fg">
              <Sparkles aria-hidden className="h-3 w-3" />
            </span>
          )
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken t-meta font-semibold text-ink-2">
            {(entry.author ?? '?').charAt(0)}
          </span>
        )}
        <span className="t-meta font-semibold text-ink">
          {fromTeam ? 'Product Team' : entry.author}
        </span>
        {fromTeam ? (
          <span className="rounded-full bg-surface px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.04em] text-brand-ink ring-1 ring-brand/30">
            {question ? 'Question' : 'Official'}
          </span>
        ) : null}
        <span
          className="ml-auto shrink-0 t-meta text-ink-3"
          title={new Date(entry.createdAt).toLocaleString()}
        >
          {relativeTime(entry.createdAt)}
        </span>
      </div>
      {entry.headline ? (
        <p className="mt-2 t-body font-semibold text-ink">
          {entry.headline}{' '}
          <span className="font-normal text-ink-3">— {longDate(entry.createdAt)}</span>
        </p>
      ) : null}
      <p className={cn('whitespace-pre-line t-body text-ink', entry.headline ? 'mt-1' : 'mt-2')}>
        {entry.body}
      </p>
    </li>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true">
      <div className="h-5 w-1/3 animate-pulse rounded bg-sunken" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-sunken" />
      <div className="h-24 w-full animate-pulse rounded bg-sunken" />
      <div className="h-16 w-full animate-pulse rounded bg-sunken" />
    </div>
  );
}
