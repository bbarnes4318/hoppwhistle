'use client';

import { AlertTriangle, Loader2, Plus, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Panel, PanelBody } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  STATUS_LABELS,
  STATUS_TONES,
  etDateTime,
  kindsOf,
  type EnvelopeSummary,
} from '@/lib/agreements';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Agreements: every MSA and campaign agreement sent for electronic signature.
 *
 * Platform admins only -- the route is in STAFF_ONLY_ROUTES and every API call
 * behind it is `requirePlatformAdmin`.
 */

const TABS: Array<{ key: string; label: string; status: string }> = [
  { key: 'all', label: 'All', status: '' },
  { key: 'awaiting', label: 'Awaiting signature', status: 'SENT,VIEWED' },
  { key: 'completed', label: 'Completed', status: 'COMPLETED' },
  { key: 'changes', label: 'Changes requested', status: 'CHANGES_REQUESTED' },
  { key: 'closed', label: 'Voided/Expired', status: 'VOIDED,EXPIRED' },
];

interface ListResponse {
  items: EnvelopeSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AgreementsPage(): JSX.Element {
  const router = useRouter();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    void apiClient
      .get<Envelope<{ missing: string | null }>>('/api/v1/platform/agreements/settings')
      .then(response => setMissing(payload(response)?.missing ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const status = TABS.find(t => t.key === tab)?.status ?? '';
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    const response = await apiClient.get<Envelope<ListResponse>>(
      `/api/v1/platform/agreements?${params.toString()}`
    );
    setError(response.error ? response.error.message : null);
    setList(payload(response) ?? null);
    setLoading(false);
  }, [tab, page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="page-canvas">
      <PageHeader
        title="Agreements"
        description="Send the Master Services Agreement and campaign agreements for electronic signature."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/admin/agreements/settings">
                <Settings className="mr-1.5 h-4 w-4" />
                Settings
              </Link>
            </Button>
            {missing ? (
              <Button disabled title="Complete the agreement settings first">
                <Plus className="mr-1.5 h-4 w-4" />
                New agreement
              </Button>
            ) : (
              <Button asChild>
                <Link href="/admin/agreements/new">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New agreement
                </Link>
              </Button>
            )}
          </>
        }
      />

      {missing && (
        <Panel className="border-ringing bg-ringing-tint">
          <PanelBody className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-ringing-ink" />
            <p className="flex-1 text-sm text-ringing-ink">
              Agreement settings are incomplete: {missing} is empty. Nothing can be sent until it is
              filled in.
            </p>
            <Button size="sm" asChild>
              <Link href="/admin/agreements/settings">Complete settings</Link>
            </Button>
          </PanelBody>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-control bg-sunken p-1" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={cn(
                'rounded-control px-3 py-1.5 text-xs font-medium text-ink-2',
                tab === t.key && 'bg-surface text-ink shadow-card'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form
          className="relative ml-auto w-full max-w-xs"
          onSubmit={event => {
            event.preventDefault();
            setPage(1);
            setQuery(q.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-3" />
          <Input
            value={q}
            onChange={event => setQ(event.target.value)}
            onBlur={() => setQuery(q.trim())}
            placeholder="Agency, signer or reference"
            className="pl-8"
            aria-label="Search agreements"
          />
        </form>
      </div>

      {error && <p className="text-sm text-dropped-ink">{error}</p>}

      <Panel>
        <PanelBody className="overflow-x-auto p-0 min-[1440px]:p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Agency</th>
                <th className="px-3 py-2 font-medium">Documents</th>
                <th className="px-3 py-2 font-medium">Signer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
                <th className="px-3 py-2 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-3">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading agreements
                  </td>
                </tr>
              )}
              {!loading && list?.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-3">
                    No agreements here yet.
                  </td>
                </tr>
              )}
              {!loading &&
                list?.items.map(row => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-rule last:border-0 hover:bg-sunken"
                    onClick={() => router.push(`/admin/agreements/${row.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/admin/agreements/${row.id}`} onClick={e => e.stopPropagation()}>
                        {row.reference}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.agencyLegalName}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {kindsOf(row).map(kind => (
                          <Badge key={kind} variant="outline" className="t-meta">
                            {kind}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.signerName}</div>
                      <div className="text-xs text-ink-3">{row.signerEmail}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">
                      {etDateTime(row.sentAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">
                      {etDateTime(row.lastActivityAt ?? row.sentAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">
                      {etDateTime(row.completedAt)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-ink-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
