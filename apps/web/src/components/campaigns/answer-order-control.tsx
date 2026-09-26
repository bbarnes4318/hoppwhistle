'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Notice, Segmented, SegmentedItem } from '@/components/domain';
import { toast } from '@/components/ui/use-toast';
import { ANSWER_ORDERS, type AnswerOrder } from '@/lib/answer-order';
import { apiClient } from '@/lib/api';

/**
 * "Who answers first", at the top of a campaign's Buyers tab.
 *
 * Three choices, one of them always true of a campaign whether or not anybody
 * chose it -- the priorities on the rows below already decide it. Choosing
 * one rewrites those priorities on the server in one transaction and keeps
 * the buyers' order among themselves, so a weighted split between buyers is
 * still the same split. `onChanged` reloads the rows so the new priorities
 * show.
 */
export function AnswerOrderControl({
  campaignId,
  value,
  disabled,
  onChanged,
}: {
  campaignId: string;
  /** What the campaign's metadata says; null when nobody has chosen yet. */
  value: AnswerOrder | null;
  disabled?: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [current, setCurrent] = useState<AnswerOrder | null>(value);
  const [saving, setSaving] = useState<AnswerOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCurrent(value), [value]);

  async function choose(next: AnswerOrder): Promise<void> {
    if (next === current || saving) return;
    setSaving(next);
    setError(null);
    try {
      const response = await apiClient.put(
        `/api/v1/campaigns/${encodeURIComponent(campaignId)}/answer-order`,
        { answerOrder: next }
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      setCurrent(next);
      toast.success('Who answers first saved', ANSWER_ORDERS.find(o => o.value === next)?.label);
      onChanged();
    } finally {
      setSaving(null);
    }
  }

  const detail = ANSWER_ORDERS.find(order => order.value === current)?.detail;

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-rule bg-surface p-4 shadow-card"
      aria-labelledby="answer-order-heading"
      data-testid="answer-order"
    >
      <div>
        <h3 id="answer-order-heading" className="t-title text-ink">
          Who answers first
        </h3>
        <p className="t-body text-ink-2">
          {detail ?? 'Choose whether a call goes to your agents or your buyers first.'}
        </p>
      </div>
      <Segmented
        role="radiogroup"
        aria-label="Who answers first"
        className="flex w-full flex-col items-stretch md:inline-flex md:w-auto md:flex-row md:self-start"
      >
        {ANSWER_ORDERS.map(order => (
          <SegmentedItem
            key={order.value}
            role="radio"
            aria-checked={current === order.value}
            active={current === order.value}
            disabled={disabled || saving !== null}
            onClick={() => void choose(order.value)}
            className="justify-start md:justify-center"
            data-answer-order={order.value}
          >
            {saving === order.value ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {order.label}
          </SegmentedItem>
        ))}
      </Segmented>
      {error ? <Notice tone="error" title={error} /> : null}
    </section>
  );
}
