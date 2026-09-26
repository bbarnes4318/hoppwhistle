'use client';

import { Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api';
import { formatTableDateTime } from '@/lib/format-time';

import { ReturnDecisionDialog } from './return-decision-dialog';
import type { ReturnDecision, ReturnsPage, ReturnRow } from './returns-types';

/**
 * "Return requested": an open return, on the call it is about.
 *
 * Rendered in the Calls page's call detail for a white-label owner when the
 * call carries an open dispute. It reads the call's return from the same
 * endpoint the Returns tab does and decides it through the same dialog, so the
 * two screens cannot say different things about what a decision will do.
 */
export function ReturnRequestedPanel({
  callId,
  onDecided,
}: {
  callId: string;
  /** After a decision, so the call detail can reload what changed. */
  onDecided?: () => void;
}): JSX.Element | null {
  const [row, setRow] = useState<ReturnRow | null>(null);
  const [deciding, setDeciding] = useState<ReturnDecision | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<ReturnsPage>(
      `/api/v1/returns?callId=${encodeURIComponent(callId)}`
    );
    setRow(response.data?.data?.find(candidate => candidate.callId === callId) ?? null);
  }, [callId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!row || row.status !== 'OPEN') return null;

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-ringing bg-ringing-tint p-4"
      aria-label="Return requested"
      data-return-requested={callId}
    >
      <h3 className="flex items-center gap-2 t-label text-ink">
        <Undo2 className="h-4 w-4" />
        Return requested
      </h3>
      <p className="t-body text-ink">{row.reason ?? 'No reason given.'}</p>
      <p className="t-meta text-ink-3">
        {row.buyer?.name ?? 'The buyer'}
        {row.disputedBy ? ` (${row.disputedBy})` : ''}
        {row.disputedAt ? ` · ${formatTableDateTime(row.disputedAt)}` : ''}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setDeciding('DENY')}>
          Deny
        </Button>
        <Button size="sm" onClick={() => setDeciding('ACCEPT')}>
          Accept
        </Button>
      </div>

      <ReturnDecisionDialog
        subject={deciding ? row : null}
        decision={deciding ?? 'ACCEPT'}
        onOpenChange={open => {
          if (!open) setDeciding(null);
        }}
        onDecided={decided => {
          setRow(decided);
          onDecided?.();
        }}
      />
    </section>
  );
}
