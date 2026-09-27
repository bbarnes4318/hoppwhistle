'use client';

import { Download, FileText, Loader2 } from 'lucide-react';
import * as React from 'react';

import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusChip,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { apiClient, payload, type Envelope } from '@/lib/api';
import { formatDisplayDate } from '@/lib/format-time';
import { readSessionToken } from '@/lib/session-token';

/**
 * Monthly statements for one party: the months there is one for, each with a
 * PDF and a CSV.
 *
 * "Month to date" is always first and is built on request from the live
 * figures; every other month was closed on the 1st and never changes. The API
 * decides who may read which party (`routes/statements.ts`), so this panel
 * sends what it was given and shows whatever comes back -- including the
 * reason when a statement cannot be produced.
 *
 * With no party it asks for "mine": a buyer's own, a publisher's own, or the
 * acting agency's.
 */

export type StatementPartyType = 'BUYER' | 'PUBLISHER' | 'AGENCY' | 'CHILD_AGENCY';

export interface StatementMonthEntry {
  month: string;
  label: string;
  live: boolean;
  createdAt: string | null;
}

interface StatementList {
  party: { partyType: StatementPartyType; partyId: string; tenantId: string };
  months: StatementMonthEntry[];
}

export function statementQuery(partyType?: StatementPartyType, partyId?: string): string {
  const params = new URLSearchParams();
  if (partyType) params.set('partyType', partyType);
  if (partyId) params.set('partyId', partyId);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The file path for one month's statement. */
export function statementFilePath(
  month: string,
  format: 'pdf' | 'csv',
  partyType?: StatementPartyType,
  partyId?: string
): string {
  return `/api/v1/statements/${month}.${format}${statementQuery(partyType, partyId)}`;
}

/** The file name the API suggested, or a plain one. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

async function download(path: string, fallbackName: string): Promise<void> {
  const token = readSessionToken();
  const response = await fetch(`${window.location.origin}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = 'The statement could not be downloaded.';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Not JSON: keep the plain message.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFrom(response.headers.get('content-disposition'), fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function StatementsPanel({
  partyType,
  partyId,
  title = 'Statements',
  description = 'A statement for every closed month, and this month so far.',
}: {
  partyType?: StatementPartyType;
  partyId?: string;
  title?: string;
  description?: string;
}): JSX.Element {
  const [months, setMonths] = React.useState<StatementMonthEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setMonths(null);
    setError(null);
    void apiClient
      .get<Envelope<StatementList>>(`/api/v1/statements${statementQuery(partyType, partyId)}`)
      .then(response => {
        if (cancelled) return;
        if (response.error) {
          setError(response.error.message || 'Statements could not be loaded.');
          return;
        }
        setMonths(payload(response)?.months ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [partyType, partyId]);

  const fetchFile = async (entry: StatementMonthEntry, format: 'pdf' | 'csv') => {
    const key = `${entry.month}.${format}`;
    setBusy(key);
    setDownloadError(null);
    try {
      await download(
        statementFilePath(entry.month, format, partyType, partyId),
        `statement-${entry.month}.${format}`
      );
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="min-w-0" data-testid="statements-panel">
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        <PanelDescription>{description}</PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        {error ? (
          <div className="p-4">
            <Notice tone="error" title={error} />
          </div>
        ) : months === null ? (
          <div className="flex items-center gap-2 p-4 t-body text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading statements
          </div>
        ) : months.length === 0 ? (
          <EmptyState headline="No statements yet." icon={FileText} />
        ) : (
          <ul className="divide-y divide-rule" aria-label="Statement months">
            {months.map(entry => (
              <li
                key={entry.month}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 t-body font-medium text-ink">
                    {entry.label}
                    {entry.live ? (
                      <StatusChip value="OPEN" label="Still open" tone="ringing" size="sm" />
                    ) : null}
                  </div>
                  {entry.createdAt ? (
                    <div className="t-meta text-ink-3">
                      Closed {formatDisplayDate(entry.createdAt)}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(['pdf', 'csv'] as const).map(format => (
                    <Button
                      key={format}
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void fetchFile(entry, format)}
                      aria-label={`Download ${entry.label} ${format.toUpperCase()}`}
                    >
                      {busy === `${entry.month}.${format}` ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Download {format.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {downloadError ? (
          <div className="px-4 pb-4">
            <Notice tone="error" title={downloadError} />
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
