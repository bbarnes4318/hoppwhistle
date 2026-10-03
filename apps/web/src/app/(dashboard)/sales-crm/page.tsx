'use client';

import {
  AlarmClock,
  CalendarClock,
  FileSignature,
  Kanban,
  List,
  Loader2,
  Plus,
  Settings,
  Target,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState, Panel, PanelBody, StatTile, StatTileRow } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { ProspectFormDialog } from '@/components/sales-crm/prospect-form-dialog';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STATUS_LABELS, STATUS_TONES, type AgreementStatus } from '@/lib/agreements';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  PROSPECT_TYPES,
  SELECT_CLASS,
  STAGES,
  STAGE_LABELS,
  STAGE_TONES,
  TYPE_LABELS,
  personName,
  shortDateTime,
  type Prospect,
  type ProspectStage,
  type SalesContext,
  type SalesMember,
  type SalesMetrics,
} from '@/lib/sales-crm';
import { cn } from '@/lib/utils';

/**
 * The Sales CRM: the B2B pipeline of whoever is selling -- NetEnroll's own
 * team, or a white-label issuer such as Life Leads Plus -- to agencies,
 * licensed agents, IMOs/FMOs and call centers. Not the consumer CRM
 * (`/insurance-leads`).
 *
 * Which pipeline is decided by the server from the session (a platform admin
 * gets NetEnroll's, an owner or granted user their own tenant's). This page
 * names no workspace and could not choose another if it tried.
 */

interface ListResponse {
  items: Prospect[];
  total: number;
  page: number;
  pageSize: number;
}

const FOLLOW_UPS = [
  { value: '', label: 'Any follow-up' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'none', label: 'None scheduled' },
];

const OPEN_STAGES = STAGES.filter(s => s !== 'WON' && s !== 'LOST');

function FollowUp({ prospect }: { prospect: Prospect }): JSX.Element {
  if (!prospect.nextFollowUpAt) return <span className="text-ink-3">—</span>;
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs',
        prospect.followUpState === 'OVERDUE' && 'font-medium text-dropped-ink',
        prospect.followUpState === 'DUE_TODAY' && 'font-medium text-ringing-ink'
      )}
    >
      {prospect.followUpState === 'OVERDUE' && 'Overdue · '}
      {prospect.followUpState === 'DUE_TODAY' && 'Today · '}
      {shortDateTime(prospect.nextFollowUpAt)}
    </span>
  );
}

function Pipeline({ context }: { context: SalesContext }): JSX.Element {
  const router = useRouter();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [type, setType] = useState('');
  const [assigned, setAssigned] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse | null>(null);
  const [metrics, setMetrics] = useState<SalesMetrics | null>(null);
  const [members, setMembers] = useState<SalesMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(view === 'board' ? 1 : page),
      pageSize: view === 'board' ? '200' : '50',
      sort: followUp ? 'followUp' : 'updated',
    });
    if (query) params.set('q', query);
    if (view === 'list' && stage) params.set('stage', stage);
    if (view === 'board') params.set('stage', OPEN_STAGES.join(','));
    if (type) params.set('type', type);
    if (assigned) params.set('assignedUserId', assigned);
    if (followUp) params.set('followUp', followUp);
    const [response, m] = await Promise.all([
      apiClient.get<Envelope<ListResponse>>(`/api/v1/sales/prospects?${params.toString()}`),
      apiClient.get<Envelope<SalesMetrics>>('/api/v1/sales/metrics'),
    ]);
    setError(response.error ? response.error.message : null);
    setList(payload(response) ?? null);
    setMetrics(payload(m) ?? null);
    setLoading(false);
  }, [view, page, query, stage, type, assigned, followUp]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void apiClient
      .get<Envelope<SalesMember[]>>('/api/v1/sales/members')
      .then(response => setMembers(payload(response) ?? []));
  }, []);

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const filtered = Boolean(query || stage || type || assigned || followUp);
  const columns = useMemo(() => {
    const byStage = new Map<ProspectStage, Prospect[]>(OPEN_STAGES.map(s => [s, []]));
    for (const p of list?.items ?? []) byStage.get(p.stage)?.push(p);
    return byStage;
  }, [list]);

  const quick = (value: string) => () => {
    setFollowUp(followUp === value ? '' : value);
    setPage(1);
  };

  return (
    <div className="page-canvas">
      <PageHeader
        title="Sales CRM"
        description={`${context.workspace.name}'s B2B pipeline: agencies, licensed agents, IMOs/FMOs and call centers you are selling to.`}
        meta={
          context.access.level !== 'MANAGER' ? (
            <Badge variant="outline">
              {context.access.level === 'READONLY' ? 'Read only' : 'Member'} access
            </Badge>
          ) : undefined
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sales-crm/agreements">
                <FileSignature className="mr-1.5 h-4 w-4" />
                Agreements
              </Link>
            </Button>
            {context.can.manage && (
              <Button variant="outline" asChild>
                <Link href="/sales-crm/settings">
                  <Settings className="mr-1.5 h-4 w-4" />
                  Settings
                </Link>
              </Button>
            )}
            {context.can.write && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New prospect
              </Button>
            )}
          </>
        }
      />

      <StatTileRow className="lg:grid-cols-7">
        <StatTile
          size="secondary"
          label="Open prospects"
          value={metrics?.openProspects ?? '—'}
          icon={Target}
          loading={!metrics}
        />
        <StatTile
          size="secondary"
          label="Qualified"
          value={metrics?.qualified ?? '—'}
          loading={!metrics}
        />
        <StatTile
          size="secondary"
          label="Agreements out"
          value={metrics?.agreementsOut ?? '—'}
          icon={FileSignature}
          loading={!metrics}
        />
        <StatTile
          size="secondary"
          label="Agreements signed"
          value={metrics?.agreementsSigned ?? '—'}
          loading={!metrics}
        />
        <StatTile
          size="secondary"
          label="Won"
          value={metrics?.won ?? '—'}
          icon={Trophy}
          loading={!metrics}
        />
        <StatTile
          size="secondary"
          label="Due today"
          value={metrics?.followUpsDueToday ?? '—'}
          icon={CalendarClock}
          loading={!metrics}
          selected={followUp === 'today'}
          onClick={quick('today')}
          className="cursor-pointer"
        />
        <StatTile
          size="secondary"
          label="Overdue"
          value={metrics?.overdueFollowUps ?? '—'}
          icon={AlarmClock}
          loading={!metrics}
          emphasis={(metrics?.overdueFollowUps ?? 0) > 0}
          selected={followUp === 'overdue'}
          onClick={quick('overdue')}
          className="cursor-pointer"
        />
      </StatTileRow>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="w-full max-w-xs"
          onSubmit={e => {
            e.preventDefault();
            setPage(1);
            setQuery(q.trim());
          }}
        >
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            onBlur={() => setQuery(q.trim())}
            placeholder="Search company, contact, email, state"
            aria-label="Search prospects"
          />
        </form>
        {view === 'list' && (
          <select
            aria-label="Stage"
            className={SELECT_CLASS}
            value={stage}
            onChange={e => {
              setStage(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All stages</option>
            {STAGES.map(s => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Type"
          className={SELECT_CLASS}
          value={type}
          onChange={e => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          {PROSPECT_TYPES.map(t => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Assigned to"
          className={SELECT_CLASS}
          value={assigned}
          onChange={e => {
            setAssigned(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>
              {personName(m)}
            </option>
          ))}
        </select>
        <select
          aria-label="Follow-up"
          className={SELECT_CLASS}
          value={followUp}
          onChange={e => {
            setFollowUp(e.target.value);
            setPage(1);
          }}
        >
          {FOLLOW_UPS.map(f => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div
          className="ml-auto flex gap-1 rounded-control bg-sunken p-1"
          role="tablist"
          aria-label="View"
        >
          {(
            [
              ['list', 'List', List],
              ['board', 'Pipeline', Kanban],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                'inline-flex items-center gap-1 rounded-control px-3 py-1.5 text-xs font-medium text-ink-2',
                view === key && 'bg-surface text-ink shadow-card'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-dropped-ink">{error}</p>}

      {loading && !list ? (
        <div className="flex items-center justify-center py-12 text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading prospects
        </div>
      ) : list && list.items.length === 0 ? (
        <EmptyState
          variant={filtered ? 'filtered' : 'empty'}
          headline={filtered ? 'No prospects match these filters' : 'No prospects yet'}
          body={
            filtered
              ? 'Clear a filter to see more of the pipeline.'
              : 'Add the agencies, licensed agents and IMOs you are selling to, and track every call, note and agreement here.'
          }
          action={
            !filtered && context.can.write
              ? { label: 'New prospect', onClick: () => setCreating(true) }
              : undefined
          }
        />
      ) : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {OPEN_STAGES.map(s => (
            <div key={s} className="w-64 flex-none">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-ink-3">
                <span>{STAGE_LABELS[s]}</span>
                <span>{columns.get(s)?.length ?? 0}</span>
              </div>
              <div className="space-y-2">
                {(columns.get(s) ?? []).map(p => (
                  <Link
                    key={p.id}
                    href={`/sales-crm/prospects/${p.id}`}
                    className="block rounded-card border border-rule bg-surface p-3 shadow-card hover:border-rule-strong"
                  >
                    <div className="truncate text-sm font-medium text-ink">{p.displayName}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-3">
                      {TYPE_LABELS[p.type]}
                      {p.state ? ` · ${p.state}` : ''}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <FollowUp prospect={p} />
                      {p.latestAgreement && (
                        <Badge
                          variant={
                            STATUS_TONES[p.latestAgreement.status as AgreementStatus] ?? 'outline'
                          }
                          className="t-meta"
                        >
                          {p.latestAgreement.reference}
                        </Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Panel>
          <PanelBody className="overflow-x-auto p-0 min-[1440px]:p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-2 font-medium">Prospect</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                  <th className="px-3 py-2 font-medium">Next follow-up</th>
                  <th className="px-3 py-2 font-medium">Last contacted</th>
                  <th className="px-3 py-2 font-medium">Agreement</th>
                </tr>
              </thead>
              <tbody>
                {list?.items.map(p => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-rule last:border-0 hover:bg-sunken"
                    onClick={() => router.push(`/sales-crm/prospects/${p.id}`)}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/sales-crm/prospects/${p.id}`}
                        className="font-medium text-ink"
                        onClick={e => e.stopPropagation()}
                      >
                        {p.displayName}
                      </Link>
                      <div className="text-xs text-ink-3">
                        {[p.companyName ? p.primaryContactName : null, p.email, p.state]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{TYPE_LABELS[p.type]}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STAGE_TONES[p.stage]}>{STAGE_LABELS[p.stage]}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">
                      {p.assignedUser ? personName(p.assignedUser) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <FollowUp prospect={p} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">
                      {shortDateTime(p.lastContactedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {p.latestAgreement ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs">{p.latestAgreement.reference}</span>
                          <Badge
                            variant={
                              STATUS_TONES[p.latestAgreement.status as AgreementStatus] ?? 'outline'
                            }
                            className="t-meta"
                          >
                            {STATUS_LABELS[p.latestAgreement.status as AgreementStatus] ??
                              p.latestAgreement.status}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelBody>
        </Panel>
      )}

      {view === 'list' && pages > 1 && (
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

      <ProspectFormDialog
        open={creating}
        onOpenChange={setCreating}
        prospect={null}
        members={members}
        onSaved={p => router.push(`/sales-crm/prospects/${p.id}`)}
      />
    </div>
  );
}

export default function SalesCrmPage(): JSX.Element {
  return <SalesGate>{context => <Pipeline context={context} />}</SalesGate>;
}
