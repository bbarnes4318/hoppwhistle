'use client';

import { Loader2, Pause, Play, RefreshCw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { dollars, duration } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Pagination,
  Panel,
  PanelBody,
  PhoneCell,
  Segmented,
  SegmentedItem,
  StatusChip,
  Toolbar,
  ToolbarActions,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { formatTableDateTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

import { ReturnDecisionDialog } from './return-decision-dialog';
import type { ReturnDecision, ReturnStatus, ReturnsPage, ReturnSubject } from './returns-types';

const STATUSES: Array<{ key: ReturnStatus; label: string }> = [
  { key: 'OPEN', label: 'Open' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'DENIED', label: 'Denied' },
];

const STATUS_CHIP: Record<ReturnStatus, { label: string; tone: 'ringing' | 'live' | 'neutral' }> = {
  OPEN: { label: 'Waiting', tone: 'ringing' },
  ACCEPTED: { label: 'Accepted', tone: 'live' },
  DENIED: { label: 'Denied', tone: 'neutral' },
};

/**
 * Returns: the calls a buyer has disputed, and the owner's decision on each.
 *
 * ── A return is a buyer's dispute ────────────────────────────────────────────
 *
 * A buyer files one from their portal (`buyer/disputes`). It waits here until
 * the owner accepts it -- the buyer is refunded or not charged, and the
 * publisher is not paid -- or denies it, and the call stands as sold. The
 * dialog says which before anything is saved; the server does the arithmetic.
 *
 * The recording is one click away on every row, because the question is almost
 * always "was that a real call".
 */
export function ReturnsView({
  onOpenCount,
}: {
  /** Told the open count after every load, for the tab's "Returns (3)". */
  onOpenCount?: (count: number) => void;
}): JSX.Element {
  const [status, setStatus] = useState<ReturnStatus>('OPEN');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReturnsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<{
    subject: ReturnSubject;
    decision: ReturnDecision;
  } | null>(null);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;
  const player = useRecordingPlayback();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ status, page: String(page) });
      const response = await apiClient.get<ReturnsPage>(`/api/v1/returns?${query.toString()}`);
      if (response.error || !response.data) {
        setError(response.error?.message ?? 'Returns could not be loaded.');
        return;
      }
      setError(null);
      setData(response.data);
      onOpenCount?.(response.data.meta.openCount);
    } finally {
      setLoading(false);
    }
  }, [status, page, onOpenCount]);

  useEffect(() => {
    if (platform.loading || withoutAgency) return;
    void load();
  }, [load, platform.loading, withoutAgency]);

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see its returns." />
      </div>
    );
  }

  const rows = data?.data ?? [];

  return (
    <div className="page-canvas">
      <PageHeader description="Calls your buyers have asked to return. Listen, then accept or deny." />

      <Toolbar aria-label="Returns filter">
        <Segmented role="group" aria-label="Return status">
          {STATUSES.map(option => (
            <SegmentedItem
              key={option.key}
              active={status === option.key}
              aria-pressed={status === option.key}
              onClick={() => {
                setStatus(option.key);
                setPage(1);
              }}
            >
              {option.label}
            </SegmentedItem>
          ))}
        </Segmented>
        <ToolbarActions>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </ToolbarActions>
      </Toolbar>

      {error ? <Notice tone="error" title={error} /> : null}

      <Panel className="min-w-0">
        <PanelBody flush className="overflow-x-auto">
          {loading && !data ? (
            <div className="flex items-center justify-center py-16 t-body text-ink-3">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading returns
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Undo2}
              headline={
                status === 'OPEN'
                  ? 'No returns are waiting for a decision.'
                  : `No ${status === 'ACCEPTED' ? 'accepted' : 'denied'} returns.`
              }
            />
          ) : (
            <>
              {/* A table from 768px; below it, one card per return, so the
                  decision buttons are never scrolled off the side of a phone. */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" aria-label="Recording" />
                      <TableHead>Call</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Publisher</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Connected</TableHead>
                      <TableHead className="text-right">Buyer paid</TableHead>
                      <TableHead className="text-right">Payout</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(row => (
                      <TableRow key={row.callId} data-return={row.callId}>
                        <TableCell>
                          {row.recordingId ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={
                                player.playingId === row.recordingId
                                  ? 'Pause recording'
                                  : 'Play recording'
                              }
                              onClick={() => void player.toggle(row.recordingId as string)}
                              disabled={player.loadingId === row.recordingId}
                            >
                              {player.loadingId === row.recordingId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : player.playingId === row.recordingId ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="t-body text-ink">
                            {formatTableDateTime(row.startedAt)}
                          </div>
                          <div className="t-meta text-ink-3">
                            {row.callerId ? (
                              <PhoneCell number={row.callerId} copyable={false} />
                            ) : (
                              '—'
                            )}
                            {row.campaignName ? ` · ${row.campaignName}` : ''}
                          </div>
                        </TableCell>
                        <TableCell>{row.buyer?.name ?? '—'}</TableCell>
                        <TableCell>{row.publisher?.name ?? '—'}</TableCell>
                        <TableCell className="max-w-[18rem]">
                          <div className="line-clamp-2 t-body text-ink-2" title={row.reason ?? ''}>
                            {row.reason ?? '—'}
                          </div>
                          <div className="t-meta text-ink-3">
                            {row.disputedBy ?? ''}
                            {row.disputedAt ? ` · ${formatTableDateTime(row.disputedAt)}` : ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.connectedDuration === null ? '—' : duration(row.connectedDuration)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(row.buyerBillableAmount)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(row.publisherPayoutAmount)}
                          {row.publisherPayoutStatus ? (
                            <div className="t-meta text-ink-3">
                              {row.publisherPayoutStatus.replace(/_/g, ' ').toLowerCase()}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusChip
                            value={row.status}
                            label={STATUS_CHIP[row.status].label}
                            tone={STATUS_CHIP[row.status].tone}
                            size="sm"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {row.status === 'OPEN' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDeciding({ subject: row, decision: 'DENY' })}
                              >
                                Deny
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => setDeciding({ subject: row, decision: 'ACCEPT' })}
                              >
                                Accept
                              </Button>
                            </div>
                          ) : (
                            <div className="t-meta text-ink-3">
                              {row.decision?.decidedBy ?? ''}
                              {row.decision?.decidedAt
                                ? ` · ${formatTableDateTime(row.decision.decidedAt)}`
                                : ''}
                              {row.decision?.note ? (
                                <div className="t-body text-ink-2">{row.decision.note}</div>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y divide-rule md:hidden" aria-label="Returns">
                {rows.map(row => (
                  <li
                    key={row.callId}
                    className="flex flex-col gap-2 p-4"
                    data-return-card={row.callId}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="t-body font-medium text-ink">
                          {row.buyer?.name ?? '—'}
                          <span className="font-normal text-ink-3"> from </span>
                          {row.publisher?.name ?? '—'}
                        </div>
                        <div className="t-meta text-ink-3">
                          {formatTableDateTime(row.startedAt)}
                          {row.campaignName ? ` · ${row.campaignName}` : ''}
                        </div>
                      </div>
                      <StatusChip
                        value={row.status}
                        label={STATUS_CHIP[row.status].label}
                        tone={STATUS_CHIP[row.status].tone}
                        size="sm"
                      />
                    </div>
                    <p className="t-body text-ink-2">{row.reason ?? '—'}</p>
                    <dl className="grid grid-cols-3 gap-2 t-meta">
                      <div>
                        <dt className="text-ink-3">Connected</dt>
                        <dd className="tabular-nums text-ink">
                          {row.connectedDuration === null ? '—' : duration(row.connectedDuration)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Buyer paid</dt>
                        <dd className="tabular-nums text-ink">
                          {dollars(row.buyerBillableAmount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Payout</dt>
                        <dd className="tabular-nums text-ink">
                          {dollars(row.publisherPayoutAmount)}
                          {row.publisherPayoutStatus
                            ? ` · ${row.publisherPayoutStatus.replace(/_/g, ' ').toLowerCase()}`
                            : ''}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex items-center gap-2">
                      {row.recordingId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void player.toggle(row.recordingId as string)}
                          disabled={player.loadingId === row.recordingId}
                        >
                          {player.playingId === row.recordingId ? (
                            <Pause className="mr-1.5 h-3.5 w-3.5" />
                          ) : (
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {player.playingId === row.recordingId ? 'Pause' : 'Listen'}
                        </Button>
                      ) : null}
                      {row.status === 'OPEN' ? (
                        <div className="ml-auto flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDeciding({ subject: row, decision: 'DENY' })}
                          >
                            Deny
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setDeciding({ subject: row, decision: 'ACCEPT' })}
                          >
                            Accept
                          </Button>
                        </div>
                      ) : row.decision ? (
                        <span className="ml-auto t-meta text-ink-3">
                          {row.decision.decidedBy ?? ''}
                          {row.decision.decidedAt
                            ? ` · ${formatTableDateTime(row.decision.decidedAt)}`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </PanelBody>
      </Panel>

      {data && data.meta.totalPages > 1 ? (
        <Pagination
          page={page}
          pageSize={data.meta.limit}
          total={data.meta.total}
          onPageChange={setPage}
          noun="returns"
          disabled={loading}
        />
      ) : null}

      {player.audio}

      <ReturnDecisionDialog
        subject={deciding?.subject ?? null}
        decision={deciding?.decision ?? 'ACCEPT'}
        onOpenChange={open => {
          if (!open) setDeciding(null);
        }}
        onDecided={() => {
          toast.success(
            deciding?.decision === 'DENY' ? 'Return denied' : 'Return accepted',
            deciding?.subject.buyer?.name ?? undefined
          );
          void load();
        }}
      />
    </div>
  );
}

/**
 * Play and pause one recording at a time, through the same signed-URL endpoint
 * the Calls page plays from.
 */
export function useRecordingPlayback() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggle(recordingId: string): Promise<void> {
    const audio = audioRef.current;
    if (audio && playingId === recordingId) {
      if (audio.paused) {
        void audio.play();
      } else {
        audio.pause();
        setPlayingId(null);
      }
      return;
    }
    setLoadingId(recordingId);
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/recordings/${encodeURIComponent(recordingId)}/url`
      );
      if (response.error || !response.data?.url) {
        toast.error(response.error?.message || 'Playback failed');
        return;
      }
      const url = response.data.url.startsWith('/')
        ? `${window.location.origin}${response.data.url}`
        : response.data.url;
      setSrc(url);
      setPlayingId(recordingId);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load();
          void audioRef.current.play();
        }
      }, 50);
    } finally {
      setLoadingId(null);
    }
  }

  const audio = (
    <audio
      ref={audioRef}
      src={src ?? undefined}
      className="hidden"
      onEnded={() => setPlayingId(null)}
      aria-hidden
    />
  );

  return { toggle, playingId, loadingId, audio };
}
