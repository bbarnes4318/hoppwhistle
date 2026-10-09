'use client';

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TIMELINE_LABELS,
  FEEDBACK_URGENCY_LABELS,
  FEEDBACK_VISIBILITIES,
  FEEDBACK_VISIBILITY_LABELS,
  normaliseTargetDate,
  weekStart,
  type FeedbackStatus,
  type FeedbackTargetKind,
} from '@hopwhistle/shared';
import { CornerDownRight, Loader2, Lock, Search } from 'lucide-react';
import * as React from 'react';

import { Notice, Segmented, SegmentedItem, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
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
import { toast } from '@/components/ui/use-toast';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  categoryLabel,
  interestPhrase,
  productAreaLabel,
  relativeTime,
  shortDate,
  statusLabel,
  type ProductArea,
  type StaffFeedbackDetail,
  type StaffFeedbackRow,
  type StaffSummary,
} from '@/lib/product-feedback';
import { cn } from '@/lib/utils';

import { FeedbackStatusChip } from '../feedback-bits';

/** The target presets: what a person would say, turned into a kind and a day. */
const TARGET_PRESETS = [
  { value: 'NONE', label: 'No timeline yet' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'NEXT_WEEK', label: 'Next week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'NEXT_MONTH', label: 'Next month' },
  { value: 'WEEK', label: 'A week…' },
  { value: 'QUARTER', label: 'A quarter…' },
  { value: 'MONTH', label: 'A month…' },
  { value: 'DATE', label: 'A specific date…' },
] as const;
type TargetPreset = (typeof TARGET_PRESETS)[number]['value'];

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shiftIso(iso: string, days: number, months = 0): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d + days));
  return date.toISOString().slice(0, 10);
}

/** A preset and the date chosen beside it, as what the API stores. */
export function targetFromPreset(
  preset: TargetPreset,
  date: string
): { kind: FeedbackTargetKind; date: string | null } {
  const today = todayIso();
  switch (preset) {
    case 'NONE':
      return { kind: 'NONE', date: null };
    case 'THIS_WEEK':
      return { kind: 'WEEK', date: weekStart(today) };
    case 'NEXT_WEEK':
      return { kind: 'WEEK', date: shiftIso(weekStart(today), 7) };
    case 'THIS_MONTH':
      return { kind: 'MONTH', date: `${today.slice(0, 7)}-01` };
    case 'NEXT_MONTH':
      return { kind: 'MONTH', date: shiftIso(`${today.slice(0, 7)}-01`, 0, 1) };
    case 'WEEK':
      return { kind: 'WEEK', date: normaliseTargetDate('WEEK', date || today) };
    case 'QUARTER':
      return { kind: 'QUARTER', date: normaliseTargetDate('QUARTER', date || today) };
    case 'MONTH':
      return { kind: 'MONTH', date: normaliseTargetDate('MONTH', date || today) };
    case 'DATE':
      return { kind: 'DATE', date: date || null };
  }
}

/** What the composer says to the agency alongside a status change. */
const MESSAGE_PROMPT: Partial<
  Record<FeedbackStatus, { label: string; required: boolean; placeholder: string }>
> = {
  NEEDS_INFO: {
    label: 'Your question for the submitter',
    required: true,
    placeholder:
      'When this happens, are you entering the medication manually or selecting it from search?',
  },
  NOT_PLANNED: {
    label: 'Why it isn’t planned (shown to the agency)',
    required: false,
    placeholder:
      'We reviewed this request, but it would conflict with… We are exploring another way to…',
  },
  SHIPPED: {
    label: 'What changed (shown on Recently Shipped)',
    required: false,
    placeholder: 'Medication questions now stay in view and no longer jump below the fold.',
  },
  PLANNED: {
    label: 'Planning update (optional)',
    required: false,
    placeholder: 'We are combining this with the upcoming CRM follow-up workflow.',
  },
  IN_PROGRESS: {
    label: 'Development update (optional)',
    required: false,
    placeholder: 'Development has started on the redesigned medication search.',
  },
};

interface Draft {
  status: FeedbackStatus;
  priority: StaffFeedbackDetail['priority'];
  visibility: StaffFeedbackDetail['visibility'];
  category: StaffFeedbackDetail['category'];
  productArea: string;
  owner: string;
  publicTitle: string;
  publicSummary: string;
  targetPreset: TargetPreset;
  targetDate: string;
  message: string;
}

function draftFrom(detail: StaffFeedbackDetail): Draft {
  // Stored as a kind and a day, shown as the dated preset of that kind, so an
  // untouched target never reads as a change.
  const preset = detail.target.kind as TargetPreset;
  return {
    status: detail.status,
    priority: detail.priority,
    visibility: detail.visibility,
    category: detail.category,
    productArea: detail.productArea ?? 'none',
    owner: detail.assignedTo?.id ?? 'none',
    publicTitle: detail.publicTitle ?? '',
    publicSummary: detail.publicSummary ?? '',
    targetPreset: preset,
    targetDate: detail.target.date ?? '',
    message: '',
  };
}

/**
 * One request, as the product team works it: triage on top, then what was
 * asked and by whom, who else wants it, the whole thread -- internal notes
 * included -- and every status change with who made it.
 */
export function StaffFeedbackDrawer({
  id,
  summary,
  areas,
  onClose,
  onChanged,
  onOpenOther,
}: {
  id: string | null;
  summary: StaffSummary | null;
  areas: ProductArea[];
  onClose: () => void;
  onChanged: () => void;
  onOpenOther: (id: string) => void;
}) {
  const [detail, setDetail] = React.useState<StaffFeedbackDetail | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [commentKind, setCommentKind] = React.useState<'PUBLIC_UPDATE' | 'INTERNAL_NOTE'>(
    'PUBLIC_UPDATE'
  );
  const [headline, setHeadline] = React.useState('');
  const [body, setBody] = React.useState('');
  const [posting, setPosting] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);

  const accept = React.useCallback((data: StaffFeedbackDetail) => {
    setDetail(data);
    setDraft(draftFrom(data));
    setSaveError(null);
  }, []);

  React.useEffect(() => {
    setDetail(null);
    setDraft(null);
    setError(null);
    setBody('');
    setHeadline('');
    setMergeOpen(false);
    if (!id) return;
    let cancelled = false;
    void apiClient
      .get<Envelope<StaffFeedbackDetail>>(`/api/v1/admin/product-feedback/${id}`)
      .then(response => {
        if (cancelled) return;
        const data = payload(response);
        if (response.error || !data) {
          setError(response.error?.message ?? 'Could not load this request.');
          return;
        }
        accept(data);
      });
    return () => {
      cancelled = true;
    };
  }, [id, accept]);

  const merged = detail?.status === 'MERGED';
  const statusChanged = !!detail && !!draft && draft.status !== detail.status;
  const prompt = statusChanged && draft ? MESSAGE_PROMPT[draft.status] : undefined;

  function changes(): Record<string, unknown> | null {
    if (!detail || !draft) return null;
    const out: Record<string, unknown> = {};
    if (draft.status !== detail.status) out.status = draft.status;
    if (draft.priority !== detail.priority) out.priority = draft.priority;
    if (draft.visibility !== detail.visibility) out.visibility = draft.visibility;
    if (draft.category !== detail.category) out.category = draft.category;
    const area = draft.productArea === 'none' ? null : draft.productArea;
    if (area !== detail.productArea) out.productArea = area;
    const owner = draft.owner === 'none' ? null : draft.owner;
    if (owner !== (detail.assignedTo?.id ?? null)) out.assignedToUserId = owner;
    if ((draft.publicTitle.trim() || null) !== detail.publicTitle)
      out.publicTitle = draft.publicTitle.trim() || null;
    if ((draft.publicSummary.trim() || null) !== detail.publicSummary) {
      out.publicSummary = draft.publicSummary.trim() || null;
    }
    const target = targetFromPreset(draft.targetPreset, draft.targetDate);
    if (target.kind !== detail.target.kind || target.date !== detail.target.date) {
      if (target.kind === 'NONE' || target.date) out.target = target;
    }
    if (draft.message.trim()) out.message = { body: draft.message.trim() };
    return out;
  }

  const pending = changes();
  const dirty = !!pending && Object.keys(pending).length > 0;

  async function save() {
    if (!detail || !pending || !dirty) return;
    if (prompt?.required && !draft?.message.trim()) {
      setSaveError('Write the question you need answered: it is what the submitter will see.');
      messageRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const response = await apiClient.patch<Envelope<StaffFeedbackDetail>>(
        `/api/v1/admin/product-feedback/${detail.id}`,
        pending
      );
      const data = payload(response);
      if (response.error || !data) {
        setSaveError(response.error?.message ?? 'The change was not saved.');
        return;
      }
      accept(data);
      toast.success('Saved', pending.status ? `Now ${statusLabel(data.status, true)}.` : undefined);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function post() {
    if (!detail || !body.trim()) return;
    setPosting(true);
    try {
      const response = await apiClient.post<Envelope<StaffFeedbackDetail>>(
        `/api/v1/admin/product-feedback/${detail.id}/comments`,
        {
          kind: commentKind,
          headline: commentKind === 'PUBLIC_UPDATE' ? headline.trim() || null : null,
          body: body.trim(),
        }
      );
      const data = payload(response);
      if (response.error || !data) {
        toast.error('Not posted', response.error?.message);
        return;
      }
      accept(data);
      setBody('');
      setHeadline('');
      toast.success(
        commentKind === 'PUBLIC_UPDATE' ? 'Update posted to the agency' : 'Internal note added'
      );
      onChanged();
    } finally {
      setPosting(false);
    }
  }

  function quick(status: FeedbackStatus) {
    if (!draft) return;
    setDraft({ ...draft, status });
    window.setTimeout(() => messageRef.current?.focus(), 50);
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));

  return (
    <SheetDrawer
      open={id !== null}
      onOpenChange={next => (next ? null : onClose())}
      size="xl"
      title={detail ? detail.title : error ? 'Request unavailable' : 'Loading…'}
      description={
        detail
          ? [`#${detail.number}`, detail.tenant?.name ?? 'Product team', detail.submittedBy?.name]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      footer={
        detail && !merged ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="t-meta text-ink-3">
              {dirty
                ? 'Unsaved changes. The agency sees status, target and messages.'
                : 'Up to date.'}
            </span>
            <div className="flex gap-2">
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => accept(detail)}>
                  Discard
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? (
                  <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save changes
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
      ) : !detail || !draft ? (
        <div className="space-y-3 p-5" aria-busy="true">
          <div className="h-9 animate-pulse rounded bg-sunken" />
          <div className="h-9 animate-pulse rounded bg-sunken" />
          <div className="h-32 animate-pulse rounded bg-sunken" />
        </div>
      ) : (
        <div data-staff-feedback={detail.id}>
          {merged && detail.mergedInto ? (
            <div className="border-b border-rule p-5">
              <button
                type="button"
                onClick={() => detail.mergedInto && onOpenOther(detail.mergedInto.id)}
                className="flex w-full items-center gap-2 rounded-control border border-rule bg-sunken/60 px-3 py-2 text-left t-body text-ink-2 hover:text-ink"
              >
                <CornerDownRight aria-hidden className="h-4 w-4" />
                Merged into #{detail.mergedInto.number} {detail.mergedInto.title}. Triage that one.
              </button>
            </div>
          ) : (
            <section className="space-y-4 border-b border-rule px-5 py-4" aria-label="Triage">
              <div className="flex flex-wrap gap-1.5">
                <QuickAction
                  onClick={() => quick('UNDER_REVIEW')}
                  active={draft.status === 'UNDER_REVIEW'}
                >
                  Review
                </QuickAction>
                <QuickAction
                  onClick={() => quick('NEEDS_INFO')}
                  active={draft.status === 'NEEDS_INFO'}
                >
                  Request info
                </QuickAction>
                <QuickAction onClick={() => quick('PLANNED')} active={draft.status === 'PLANNED'}>
                  Plan
                </QuickAction>
                <QuickAction
                  onClick={() => quick('IN_PROGRESS')}
                  active={draft.status === 'IN_PROGRESS'}
                >
                  Start
                </QuickAction>
                <QuickAction onClick={() => quick('SHIPPED')} active={draft.status === 'SHIPPED'}>
                  Mark shipped
                </QuickAction>
                <QuickAction
                  onClick={() => quick('NOT_PLANNED')}
                  active={draft.status === 'NOT_PLANNED'}
                >
                  Not planned
                </QuickAction>
                <QuickAction onClick={() => setMergeOpen(open => !open)} active={mergeOpen}>
                  Merge…
                </QuickAction>
              </div>

              {mergeOpen ? (
                <MergePicker
                  sourceId={detail.id}
                  onMerged={data => {
                    accept(data);
                    setMergeOpen(false);
                    onChanged();
                  }}
                />
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <Select
                    value={draft.status}
                    onValueChange={v => set('status', v as FeedbackStatus)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_STATUSES.filter(s => s !== 'MERGED').map(s => (
                        <SelectItem key={s} value={s}>
                          {statusLabel(s, true)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Priority (internal)">
                  <Select
                    value={draft.priority}
                    onValueChange={v => set('priority', v as Draft['priority'])}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_PRIORITIES.map(p => (
                        <SelectItem key={p} value={p}>
                          {FEEDBACK_PRIORITY_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Target">
                  <div className="flex gap-2">
                    <Select
                      value={draft.targetPreset}
                      onValueChange={v => set('targetPreset', v as TargetPreset)}
                    >
                      <SelectTrigger className="h-9 min-w-0 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_PRESETS.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {draft.targetPreset === 'WEEK' ||
                    draft.targetPreset === 'QUARTER' ||
                    draft.targetPreset === 'MONTH' ||
                    draft.targetPreset === 'DATE' ? (
                      <Input
                        type="date"
                        value={draft.targetDate}
                        onChange={e => set('targetDate', e.target.value)}
                        className="h-9 w-[150px]"
                        aria-label="Target date"
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 t-meta text-ink-3">
                    Shown as “Target: {detail.target.label}” today. Never a promise.
                  </p>
                </Field>
                <Field label="Owner">
                  <Select value={draft.owner} onValueChange={v => set('owner', v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {(summary?.owners ?? []).map(o => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Kind">
                  <Select
                    value={draft.category}
                    onValueChange={v => set('category', v as Draft['category'])}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>
                          {categoryLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Product area">
                  <Select value={draft.productArea} onValueChange={v => set('productArea', v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {withCurrent(areas, detail.productArea).map(a => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Who can see it">
                <Select
                  value={draft.visibility}
                  onValueChange={v => {
                    set('visibility', v as Draft['visibility']);
                    // Publishing starts from the submitter's title, for the team
                    // to reword before every agency reads it.
                    if (v === 'PUBLIC' && !draft.publicTitle.trim())
                      set('publicTitle', detail.title);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEEDBACK_VISIBILITIES.map(v => (
                      <SelectItem
                        key={v}
                        value={v}
                        disabled={detail.tenant === null && v !== 'PUBLIC'}
                      >
                        {FEEDBACK_VISIBILITY_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.visibility === 'PUBLIC' ? (
                  <p className="mt-1 t-meta text-ink-3">
                    Every agency sees the roadmap title and summary below — never the submitter’s
                    own words or name.
                  </p>
                ) : null}
              </Field>

              {draft.visibility === 'PUBLIC' || detail.publicTitle || detail.publicSummary ? (
                <div className="grid gap-3">
                  <Field label="Roadmap title">
                    <Input
                      value={draft.publicTitle}
                      onChange={e => set('publicTitle', e.target.value)}
                      placeholder={detail.title}
                      maxLength={140}
                    />
                  </Field>
                  <Field label="Roadmap summary">
                    <Textarea
                      value={draft.publicSummary}
                      onChange={e => set('publicSummary', e.target.value)}
                      placeholder="One or two sentences every agency can read."
                      rows={2}
                      maxLength={5000}
                    />
                  </Field>
                </div>
              ) : null}

              {statusChanged ? (
                <Field label={prompt?.label ?? 'Message to the agency (optional)'}>
                  <Textarea
                    ref={messageRef}
                    value={draft.message}
                    onChange={e => set('message', e.target.value)}
                    placeholder={
                      prompt?.placeholder ?? 'Posted as a public update with this change.'
                    }
                    rows={3}
                    maxLength={5000}
                    className={cn(prompt?.required && !draft.message.trim() && 'border-ringing')}
                  />
                </Field>
              ) : null}
              {saveError ? <Notice tone="error" title={saveError} /> : null}
            </section>
          )}

          {/* What was asked, and by whom */}
          <section className="border-b border-rule px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <FeedbackStatusChip status={detail.status} staff />
              <span className="t-meta text-ink-3">
                {categoryLabel(detail.category)}
                {detail.productArea ? ` · ${productAreaLabel(detail.productArea)}` : ''}
                {detail.urgency ? ` · ${FEEDBACK_URGENCY_LABELS[detail.urgency]}` : ''}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-line t-body text-ink">{detail.description}</p>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 t-meta">
              <dt className="text-ink-3">Agency</dt>
              <dd className="text-ink">{detail.tenant?.name ?? 'Added by the product team'}</dd>
              <dt className="text-ink-3">Submitted by</dt>
              <dd className="text-ink">
                {detail.submittedBy
                  ? `${detail.submittedBy.name} (${detail.submittedBy.email})`
                  : '—'}
                {detail.submittedByRole ? ` · ${detail.submittedByRole.toLowerCase()}` : ''}
              </dd>
              <dt className="text-ink-3">Submitted</dt>
              <dd className="text-ink">{new Date(detail.createdAt).toLocaleString()}</dd>
              {detail.sourceRoute ? (
                <>
                  <dt className="text-ink-3">Came from</dt>
                  <dd className="font-mono text-[12px] text-ink">{detail.sourceRoute}</dd>
                </>
              ) : null}
              {detail.clientContext?.sample ? (
                <>
                  <dt className="text-ink-3">Source</dt>
                  <dd className="font-medium text-ringing-ink">
                    Sample data ({detail.clientContext.sample}), not a real request
                  </dd>
                </>
              ) : detail.clientContext ? (
                <>
                  <dt className="text-ink-3">Browser</dt>
                  <dd className="break-words text-ink-2">
                    {[
                      detail.clientContext.viewport,
                      detail.clientContext.timezone,
                      detail.clientContext.userAgent,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-3">Interest</dt>
              <dd className="text-ink">
                {interestPhrase(detail.interestCount)}
                {detail.interestByTenant.length > 0
                  ? ` — ${detail.interestByTenant.map(t => `${t.count} at ${t.tenantName}`).join(', ')}`
                  : ''}
              </dd>
              {detail.mergedFrom.length > 0 ? (
                <>
                  <dt className="text-ink-3">Merged in</dt>
                  <dd className="text-ink">
                    {detail.mergedFrom.map((m, i) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onOpenOther(m.id)}
                        className="text-brand-ink hover:underline"
                      >
                        {i > 0 ? ', ' : ''}#{m.number} {m.title}
                        {m.tenantName ? ` (${m.tenantName})` : ''}
                      </button>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          {/* The thread, internal notes included */}
          <section className="border-b border-rule px-5 py-4">
            <h3 className="t-label mb-3 text-ink-3">Thread</h3>
            {detail.thread.length === 0 ? (
              <p className="mb-3 t-meta text-ink-3">Nothing posted yet.</p>
            ) : (
              <ol className="mb-4 space-y-2.5">
                {detail.thread.map(entry => (
                  <li
                    key={entry.id}
                    data-thread-kind={entry.kind}
                    className={cn(
                      'rounded-control border px-3 py-2.5',
                      entry.kind === 'INTERNAL_NOTE'
                        ? 'border-dashed border-ringing/50 bg-ringing-tint/30'
                        : entry.kind === 'USER_REPLY'
                          ? 'border-rule bg-surface'
                          : 'border-brand/30 bg-brand-tint/40'
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 t-meta">
                      <span className="font-semibold text-ink">{entry.author ?? 'Unknown'}</span>
                      <span className="text-ink-3">
                        {entry.kind === 'INTERNAL_NOTE' ? (
                          <span className="inline-flex items-center gap-1 font-medium text-ringing-ink">
                            <Lock aria-hidden className="h-3 w-3" /> Internal note
                          </span>
                        ) : entry.kind === 'USER_REPLY' ? (
                          'Agency reply'
                        ) : entry.kind === 'QUESTION' ? (
                          'Question to the agency'
                        ) : (
                          'Public update'
                        )}
                      </span>
                      <span className="ml-auto text-ink-3">{relativeTime(entry.createdAt)}</span>
                    </div>
                    {entry.headline ? (
                      <p className="mt-1 t-body font-semibold text-ink">{entry.headline}</p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-line t-body text-ink">{entry.body}</p>
                  </li>
                ))}
              </ol>
            )}
            <div className="space-y-2 rounded-card border border-rule bg-sunken/40 p-3">
              <Segmented aria-label="Post as">
                <SegmentedItem
                  active={commentKind === 'PUBLIC_UPDATE'}
                  onClick={() => setCommentKind('PUBLIC_UPDATE')}
                  disabled={merged}
                >
                  Public update
                </SegmentedItem>
                <SegmentedItem
                  active={commentKind === 'INTERNAL_NOTE'}
                  onClick={() => setCommentKind('INTERNAL_NOTE')}
                >
                  <Lock aria-hidden className="h-3 w-3" /> Internal note
                </SegmentedItem>
              </Segmented>
              {commentKind === 'PUBLIC_UPDATE' ? (
                <Input
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  placeholder="Heading, e.g. Development update"
                  maxLength={80}
                  className="h-9 bg-surface"
                />
              ) : null}
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={
                  commentKind === 'PUBLIC_UPDATE'
                    ? 'Everybody who can see this request reads it, and the submitter is emailed.'
                    : 'Only the product team ever sees internal notes.'
                }
                rows={3}
                maxLength={5000}
                className="bg-surface"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={commentKind === 'INTERNAL_NOTE' ? 'outline' : 'default'}
                  onClick={() => void post()}
                  disabled={posting || !body.trim()}
                >
                  {posting ? (
                    <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {commentKind === 'PUBLIC_UPDATE' ? 'Post update' : 'Add note'}
                </Button>
              </div>
            </div>
          </section>

          {/* Every status change, with who made it */}
          <section className="px-5 py-4">
            <h3 className="t-label mb-2 text-ink-3">History</h3>
            <ol className="space-y-1.5">
              {detail.timeline.map((event, index) => (
                <li key={index} className="flex items-baseline justify-between gap-3 t-meta">
                  <span className="text-ink">
                    {FEEDBACK_TIMELINE_LABELS[event.status]}
                    {event.from ? (
                      <span className="text-ink-3"> (from {statusLabel(event.from, true)})</span>
                    ) : null}
                    {event.actor ? <span className="text-ink-3"> · {event.actor}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-3">{shortDate(event.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </SheetDrawer>
  );
}

function withCurrent(areas: ProductArea[], current: string | null): ProductArea[] {
  if (!current || areas.some(a => a.value === current)) return areas;
  return [...areas, { value: current, label: productAreaLabel(current) ?? current }];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="t-meta font-medium text-ink-2">{label}</Label>
      {children}
    </div>
  );
}

function QuickAction({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150',
        active
          ? 'border-brand-ink bg-brand-tint text-brand-ink'
          : 'border-rule-strong bg-surface text-ink-2 hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}

/** Find the request a duplicate belongs with, and fold it in. */
function MergePicker({
  sourceId,
  onMerged,
}: {
  sourceId: string;
  onMerged: (detail: StaffFeedbackDetail) => void;
}) {
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<StaffFeedbackRow[]>([]);
  const [merging, setMerging] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void apiClient
        .get<
          Envelope<StaffFeedbackRow[]>
        >(`/api/v1/admin/product-feedback?pageSize=6&q=${encodeURIComponent(term)}`)
        .then(response => setResults((payload(response) ?? []).filter(r => r.id !== sourceId)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, sourceId]);

  async function merge(targetId: string) {
    setMerging(targetId);
    setError(null);
    try {
      const response = await apiClient.post<Envelope<StaffFeedbackDetail>>(
        `/api/v1/admin/product-feedback/${sourceId}/merge`,
        { targetId }
      );
      const data = payload(response);
      if (response.error || !data) {
        setError(response.error?.message ?? 'Not merged.');
        return;
      }
      toast.success('Merged', 'Everyone interested now follows the other request.');
      onMerged(data);
    } finally {
      setMerging(null);
    }
  }

  return (
    <div className="rounded-card border border-rule bg-sunken/40 p-3">
      <p className="t-meta text-ink-2">
        Merge this into the request it duplicates. Its submitter and everybody interested follow
        that one from then on.
      </p>
      <div className="relative mt-2">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
        />
        <Input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by title or #number"
          className="h-9 bg-surface pl-8"
        />
      </div>
      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-rule rounded-control border border-rule bg-surface">
          {results.map(row => (
            <li key={row.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate t-body text-ink">
                  #{row.number} {row.publicTitle ?? row.title}
                </p>
                <p className="t-meta text-ink-3">
                  {statusLabel(row.status, true)} · {row.tenant?.name ?? 'Product team'} ·{' '}
                  {row.visibility === 'PUBLIC' ? 'public' : 'private'}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={merging !== null}
                onClick={() => void merge(row.id)}
              >
                {merging === row.id ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Merge into'
                )}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 t-meta text-dropped-ink">{error}</p> : null}
    </div>
  );
}
