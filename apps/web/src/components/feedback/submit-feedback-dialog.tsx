'use client';

import {
  FEEDBACK_URGENCY_LABELS,
  FEEDBACK_URGENCIES,
  type FeedbackCategory,
  type FeedbackUrgency,
} from '@hopwhistle/shared';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Frown,
  Lightbulb,
  Loader2,
  MessageCircle,
  TrendingUp,
  Workflow,
} from 'lucide-react';
import * as React from 'react';

import { Notice } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  areaForRoute,
  clientContext,
  interestPhrase,
  wantPhrase,
  lastRoute,
  productAreaLabel,
  type FeedbackDetail,
  type FeedbackItem,
  type ProductArea,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackStatusChip, InterestButton, useDebounced } from './feedback-bits';

interface Kind {
  value: FeedbackCategory;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** The six kinds, in the words someone would use for them. */
export const FEEDBACK_KINDS: Kind[] = [
  { value: 'IDEA', label: 'Idea', blurb: 'I have an idea for something new.', icon: Lightbulb },
  {
    value: 'IMPROVEMENT',
    label: 'Improvement',
    blurb: 'Something could work better.',
    icon: TrendingUp,
  },
  {
    value: 'PROBLEM',
    label: 'Problem',
    blurb: 'Something isn’t working the way I expect.',
    icon: AlertTriangle,
  },
  {
    value: 'WORKFLOW',
    label: 'Workflow',
    blurb: 'This process takes too many steps.',
    icon: Workflow,
  },
  { value: 'COMPLAINT', label: 'Complaint', blurb: 'Something is frustrating me.', icon: Frown },
  { value: 'OTHER', label: 'Other', blurb: 'Something else on my mind.', icon: MessageCircle },
];

const TITLE_PLACEHOLDER: Record<FeedbackCategory, string> = {
  IDEA: 'What would you like us to build?',
  IMPROVEMENT: 'What would you like us to improve?',
  PROBLEM: 'What isn’t working?',
  WORKFLOW: 'Which process takes too many steps?',
  COMPLAINT: 'What is frustrating you?',
  OTHER: 'What’s on your mind?',
};

type Stage =
  | { step: 'kind' }
  | { step: 'details' }
  | { step: 'sent'; item: FeedbackDetail }
  | { step: 'joined'; item: FeedbackItem };

/**
 * Submit Feedback: a kind, then a title and the details, and that is all that
 * is required. Where the person was, their role and their agency are not asked:
 * the server knows the last two, and the page they came from is remembered for
 * them.
 *
 * While they type a title, requests like it that already exist are offered
 * with "I want this too", so the thirtieth copy of an idea becomes one more
 * person behind the first.
 */
export function SubmitFeedbackDialog({
  open,
  onOpenChange,
  areas,
  productName,
  onSubmitted,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areas: ProductArea[];
  productName: string;
  onSubmitted: () => void;
  onView: (id: string) => void;
}) {
  const [stage, setStage] = React.useState<Stage>({ step: 'kind' });
  const [kind, setKind] = React.useState<FeedbackCategory | null>(null);
  const [title, setTitle] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [area, setArea] = React.useState<string>('');
  const [urgency, setUrgency] = React.useState<FeedbackUrgency | null>(null);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [similar, setSimilar] = React.useState<FeedbackItem[]>([]);
  const [joining, setJoining] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<string | null>(null);

  // A fresh form each time it opens, with the area the person came from. Only
  // on opening: the page refreshes behind the dialog once it is sent, and that
  // must not take the confirmation away.
  const areasRef = React.useRef(areas);
  areasRef.current = areas;
  React.useEffect(() => {
    if (!open) return;
    const from = lastRoute();
    setSource(from);
    setStage({ step: 'kind' });
    setKind(null);
    setTitle('');
    setDetails('');
    setUrgency(null);
    setError(null);
    setSimilar([]);
    setArea(areaForRoute(from, areasRef.current) ?? '');
  }, [open]);

  const query = useDebounced(title.trim(), 350);
  React.useEffect(() => {
    if (stage.step !== 'details' || query.length < 4) {
      setSimilar([]);
      return;
    }
    let cancelled = false;
    void apiClient
      .get<Envelope<FeedbackItem[]>>(`/api/v1/feedback/similar?q=${encodeURIComponent(query)}`)
      .then(response => {
        if (!cancelled) setSimilar(payload(response) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [query, stage.step]);

  const titleOk = title.trim().length >= 3;
  const detailsOk = details.trim().length >= 10;

  async function submit() {
    if (!kind || !titleOk || !detailsOk) {
      setError(
        !titleOk
          ? 'Give your feedback a short title.'
          : 'Tell us a little more: at least a sentence helps the product team understand it.'
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await apiClient.post<Envelope<FeedbackDetail>>('/api/v1/feedback', {
        category: kind,
        title: title.trim(),
        description: details.trim(),
        productArea: area || null,
        urgency,
        sourceRoute: source,
        clientContext: clientContext(),
      });
      const data = payload(response);
      if (response.error || !data) {
        setError(response.error?.message ?? 'Your feedback was not sent. Please try again.');
        return;
      }
      setStage({ step: 'sent', item: data });
      onSubmitted();
    } finally {
      setSending(false);
    }
  }

  async function joinExisting(item: FeedbackItem) {
    if (item.viewerInterested || item.isMine) {
      setStage({ step: 'joined', item });
      return;
    }
    setJoining(item.id);
    try {
      const response = await apiClient.post<Envelope<{ interestCount: number }>>(
        `/api/v1/feedback/${item.id}/vote`,
        {}
      );
      const data = payload(response);
      if (response.error && response.error.code !== 'ALREADY_INTERESTED') {
        setError(response.error.message);
        return;
      }
      setStage({
        step: 'joined',
        item: {
          ...item,
          viewerInterested: true,
          interestCount: data?.interestCount ?? item.interestCount + 1,
        },
      });
      onSubmitted();
    } finally {
      setJoining(null);
    }
  }

  const sourceLabel = source ? productAreaLabel(areaForRoute(source, areas)) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[640px] gap-0 overflow-y-auto p-0">
        {stage.step === 'sent' || stage.step === 'joined' ? (
          <Confirmation
            stage={stage}
            onView={id => {
              onOpenChange(false);
              onView(id);
            }}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <>
            <div className="border-b border-rule px-6 pb-4 pt-5">
              <DialogTitle className="t-section text-ink">
                {stage.step === 'kind' ? 'What kind of feedback?' : 'Tell us about it'}
              </DialogTitle>
              <DialogDescription className="mt-1 t-body text-ink-2">
                {stage.step === 'kind'
                  ? `It goes straight to the product team behind ${productName}, and you can follow what happens to it.`
                  : 'Plain words are perfect. No technical terms needed.'}
              </DialogDescription>
            </div>

            {stage.step === 'kind' ? (
              <div
                className="grid grid-cols-1 gap-2.5 p-6 sm:grid-cols-2 md:grid-cols-3"
                role="list"
              >
                {FEEDBACK_KINDS.map(option => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="listitem"
                      data-kind={option.value}
                      onClick={() => {
                        setKind(option.value);
                        setStage({ step: 'details' });
                      }}
                      className={cn(
                        'group flex items-start gap-3 rounded-card border border-rule bg-surface p-3.5 text-left shadow-card transition-[border-color,background-color] duration-150',
                        'hover:border-brand-ink/40 hover:bg-brand-tint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'md:flex-col md:gap-2.5'
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block t-body font-semibold text-ink">{option.label}</span>
                        <span className="mt-0.5 block t-meta text-ink-2">{option.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <form
                className="space-y-4 px-6 py-5"
                onSubmit={event => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <button
                  type="button"
                  onClick={() => setStage({ step: 'kind' })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-1 t-meta font-medium text-brand-ink hover:bg-brand-tint/70"
                >
                  <ArrowLeft aria-hidden className="h-3 w-3" />
                  {FEEDBACK_KINDS.find(k => k.value === kind)?.label} · change
                </button>

                <div className="space-y-1.5">
                  <Label htmlFor="feedback-title">Title</Label>
                  <Input
                    id="feedback-title"
                    autoFocus
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    placeholder={kind ? TITLE_PLACEHOLDER[kind] : TITLE_PLACEHOLDER.IMPROVEMENT}
                    maxLength={140}
                  />
                </div>

                {similar.length > 0 ? (
                  <div
                    className="rounded-card border border-brand/30 bg-brand-tint/40 p-3"
                    data-similar=""
                  >
                    <p className="t-meta font-semibold text-ink">Similar requests already exist</p>
                    <p className="t-meta text-ink-2">
                      If one of these is what you mean, add your support instead — it counts for
                      more than a new copy.
                    </p>
                    <ul className="mt-2 divide-y divide-rule rounded-control border border-rule bg-surface">
                      {similar.map(item => (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => {
                                onOpenChange(false);
                                onView(item.id);
                              }}
                              className="block truncate text-left t-body font-medium text-ink hover:text-brand-ink"
                            >
                              {item.title}
                            </button>
                            <span className="flex items-center gap-2 t-meta text-ink-3">
                              <FeedbackStatusChip
                                status={item.status}
                                className="h-5 text-[11px]"
                              />
                              {wantPhrase(item.interestCount)}
                            </span>
                          </div>
                          <InterestButton
                            interested={item.viewerInterested}
                            count={item.interestCount}
                            isMine={item.isMine}
                            busy={joining === item.id}
                            onToggle={() => void joinExisting(item)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="feedback-details">Details</Label>
                  <Textarea
                    id="feedback-details"
                    value={details}
                    onChange={event => setDetails(event.target.value)}
                    placeholder="What are you trying to accomplish, what happens today, and what would make it better?"
                    rows={4}
                    maxLength={5000}
                    className="min-h-[96px]"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="feedback-area">
                      Area <span className="font-normal text-ink-3">(optional)</span>
                    </Label>
                    <Select
                      value={area || 'none'}
                      onValueChange={value => setArea(value === 'none' ? '' : value)}
                    >
                      <SelectTrigger id="feedback-area" className="h-9">
                        <SelectValue placeholder="Choose an area" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not sure</SelectItem>
                        {areas.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium leading-none text-ink">
                      How much does it affect you?{' '}
                      <span className="font-normal text-ink-3">(optional)</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Impact">
                      {FEEDBACK_URGENCIES.map(value => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={urgency === value}
                          onClick={() => setUrgency(urgency === value ? null : value)}
                          className={cn(
                            'h-9 rounded-control border px-2.5 text-[12px] font-medium transition-colors duration-150',
                            urgency === value
                              ? 'border-brand-ink bg-brand-tint text-brand-ink'
                              : 'border-rule-strong bg-surface text-ink-2 hover:text-ink'
                          )}
                        >
                          {FEEDBACK_URGENCY_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {error ? <Notice tone="error" title={error} /> : null}

                <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center">
                  <p className="t-meta text-ink-3">
                    {sourceLabel
                      ? `We’ll note you came from ${sourceLabel}, and your browser details, so you don’t have to.`
                      : 'We’ll attach your role and browser details so you don’t have to.'}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={sending}>
                      {sending ? (
                        <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : null}
                      Submit feedback
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Confirmation({
  stage,
  onView,
  onDone,
}: {
  stage: { step: 'sent'; item: FeedbackDetail } | { step: 'joined'; item: FeedbackItem };
  onView: (id: string) => void;
  onDone: () => void;
}) {
  const sent = stage.step === 'sent';
  return (
    <div className="px-6 py-8 text-center" data-confirmation={stage.step}>
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-live-tint">
        <CheckCircle2 aria-hidden className="h-6 w-6 text-live" />
      </span>
      <DialogTitle className="mt-4 t-section text-ink">
        {sent ? 'Feedback received' : 'You’re behind this one now'}
      </DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-[420px] t-body text-ink-2">
        {sent
          ? 'Your request has been sent to the product team. You can follow its status and any updates here in Feedback & Roadmap.'
          : `"${stage.item.title}" now has ${interestPhrase(stage.item.interestCount)} behind it. You’ll see a “New update” marker whenever the product team posts on it.`}
      </DialogDescription>
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="outline" onClick={() => onView(stage.item.id)}>
          View {sent ? 'feedback' : 'request'}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
