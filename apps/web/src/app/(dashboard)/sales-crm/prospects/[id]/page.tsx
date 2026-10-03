'use client';

import {
  Archive,
  ArrowLeft,
  CalendarClock,
  FileSignature,
  Mail,
  Pencil,
  PhoneCall,
  RotateCcw,
  Send,
  StickyNote,
  Trophy,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { ProspectFormDialog } from '@/components/sales-crm/prospect-form-dialog';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { STATUS_LABELS, STATUS_TONES, type AgreementStatus } from '@/lib/agreements';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  ACTIVITY_LABELS,
  SELECT_CLASS,
  STAGES,
  STAGE_LABELS,
  STAGE_TONES,
  TYPE_LABELS,
  fromLocalInput,
  personName,
  shortDate,
  shortDateTime,
  toLocalInput,
  type PersonRef,
  type Prospect,
  type ProspectStage,
  type SalesContext,
  type SalesMember,
} from '@/lib/sales-crm';
import { cn } from '@/lib/utils';

/**
 * One B2B prospect: who they are, where they stand, what happened, and the
 * agreements sent to them -- with each agreement's lifecycle written onto the
 * timeline by the server as it happens. "Send agreement" opens the workspace's
 * own agreement suite with this prospect filled in.
 */

interface Activity {
  id: string;
  type: string;
  body: string | null;
  detail: Record<string, unknown> | null;
  occurredAt: string;
  agreementEnvelopeId: string | null;
  actor: PersonRef | null;
}

interface LinkedAgreement {
  id: string;
  reference: string;
  status: AgreementStatus;
  includesMsa: boolean;
  includesCpa: boolean;
  includesCpl: boolean;
  sentAt: string;
  viewedAt: string | null;
  signedAt: string | null;
  completedAt: string | null;
  voidedAt: string | null;
  changesRequestedAt: string | null;
  expiresAt: string;
  signerName: string;
  signerEmail: string;
}

interface ProspectDetail extends Prospect {
  activities: Activity[];
  agreements: LinkedAgreement[];
}

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  NOTE: StickyNote,
  CALL: PhoneCall,
  EMAIL: Mail,
  FOLLOW_UP: CalendarClock,
};

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-1.5 text-sm last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function kinds(a: LinkedAgreement): string[] {
  return [a.includesMsa && 'MSA', a.includesCpa && 'CPA', a.includesCpl && 'CPL'].filter(
    Boolean
  ) as string[];
}

function ProspectView({ context }: { context: SalesContext }): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [prospect, setProspect] = useState<ProspectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<SalesMember[]>([]);
  const [editing, setEditing] = useState(false);
  const [entryType, setEntryType] = useState<'NOTE' | 'CALL' | 'EMAIL'>('NOTE');
  const [entry, setEntry] = useState('');
  const [entryFollowUp, setEntryFollowUp] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const response = await apiClient.get<Envelope<ProspectDetail>>(`/api/v1/sales/prospects/${id}`);
    const data = payload(response);
    setError(response.error ? response.error.message : null);
    setProspect(data ?? null);
    if (data) setFollowUp(toLocalInput(data.nextFollowUpAt));
  }, [id]);

  useEffect(() => {
    void load();
    void apiClient
      .get<Envelope<SalesMember[]>>('/api/v1/sales/members')
      .then(response => setMembers(payload(response) ?? []));
  }, [load]);

  async function act(
    name: string,
    run: () => Promise<{ error?: { message: string } }>
  ): Promise<boolean> {
    setBusy(name);
    const response = await run();
    setBusy(null);
    if (response.error) {
      setError(response.error.message);
      return false;
    }
    setError(null);
    await load();
    return true;
  }

  if (!prospect) {
    return (
      <div className="page-canvas">
        {error ? (
          <EmptyState
            variant="error"
            headline="Prospect not found"
            body={error}
            action={{ label: 'Back to the Sales CRM', href: '/sales-crm' }}
          />
        ) : (
          <div className="py-12 text-center text-ink-3">Loading prospect</div>
        )}
      </div>
    );
  }

  const write = context.can.write && !prospect.archivedAt;
  const setStage = (stage: ProspectStage, reason?: string) =>
    act(`stage-${stage}`, () =>
      apiClient.post(`/api/v1/sales/prospects/${prospect.id}/stage`, { stage, lostReason: reason })
    );

  return (
    <div className="page-canvas">
      <PageHeader
        title={prospect.displayName}
        description={[
          TYPE_LABELS[prospect.type],
          prospect.state,
          prospect.source && `Source: ${prospect.source}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STAGE_TONES[prospect.stage]}>{STAGE_LABELS[prospect.stage]}</Badge>
            {prospect.archivedAt && <Badge variant="secondary">Archived</Badge>}
            {prospect.followUpState === 'OVERDUE' && (
              <Badge variant="destructive">Follow-up overdue</Badge>
            )}
          </div>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/sales-crm">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Sales CRM
              </Link>
            </Button>
            {write && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Edit
              </Button>
            )}
            {write &&
              (context.can.sendAgreements ? (
                <Button asChild>
                  <Link href={`/sales-crm/agreements/new?prospectId=${prospect.id}`}>
                    <Send className="mr-1.5 h-4 w-4" />
                    Send agreement
                  </Link>
                </Button>
              ) : (
                <Button
                  disabled
                  title={
                    context.suite.templatesMessage ??
                    (context.suite.missingSetting
                      ? `Complete the agreement settings: ${context.suite.missingSetting} is empty.`
                      : 'The agreement suite is not ready.')
                  }
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  Send agreement
                </Button>
              ))}
          </>
        }
      />

      {error && <p className="text-sm text-dropped-ink">{error}</p>}
      {write && !context.can.sendAgreements && (
        <p className="text-xs text-ink-3">
          Agreements cannot be sent yet:{' '}
          {context.suite.templatesMessage ??
            (context.suite.missingSetting
              ? `${context.suite.missingSetting} is empty in the agreement settings.`
              : 'the suite is disabled.')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {write && (
            <Panel>
              <PanelHeader>
                <PanelTitle>Record activity</PanelTitle>
              </PanelHeader>
              <PanelBody className="space-y-3">
                <div className="flex gap-1 rounded-control bg-sunken p-1" role="tablist">
                  {(['NOTE', 'CALL', 'EMAIL'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={entryType === t}
                      onClick={() => setEntryType(t)}
                      className={cn(
                        'rounded-control px-3 py-1.5 text-xs font-medium text-ink-2',
                        entryType === t && 'bg-surface text-ink shadow-card'
                      )}
                    >
                      {t === 'NOTE' ? 'Note' : t === 'CALL' ? 'Log a call' : 'Log an email'}
                    </button>
                  ))}
                </div>
                <Textarea
                  rows={3}
                  value={entry}
                  placeholder={
                    entryType === 'NOTE'
                      ? 'What you learned, what was agreed…'
                      : entryType === 'CALL'
                        ? 'Who you spoke with and the outcome'
                        : 'What was sent or received'
                  }
                  onChange={e => setEntry(e.target.value)}
                  aria-label="Activity"
                />
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor="entry-follow" className="mb-1 block text-[11px] text-ink-3">
                      Set next follow-up (optional)
                    </label>
                    <Input
                      id="entry-follow"
                      type="datetime-local"
                      value={entryFollowUp}
                      onChange={e => setEntryFollowUp(e.target.value)}
                    />
                  </div>
                  <Button
                    disabled={!entry.trim() || busy !== null}
                    onClick={() =>
                      void act('entry', () =>
                        apiClient.post(`/api/v1/sales/prospects/${prospect.id}/activities`, {
                          type: entryType,
                          body: entry.trim(),
                          ...(entryFollowUp
                            ? { nextFollowUpAt: fromLocalInput(entryFollowUp) }
                            : {}),
                        })
                      ).then(ok => {
                        if (ok) {
                          setEntry('');
                          setEntryFollowUp('');
                        }
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
                <p className="text-[11px] text-ink-3">
                  Calls and emails are recorded as you describe them; nothing here places a call or
                  sends an email.
                </p>
              </PanelBody>
            </Panel>
          )}

          <Panel>
            <PanelHeader>
              <PanelTitle>Timeline</PanelTitle>
            </PanelHeader>
            <PanelBody>
              {prospect.activities.length === 0 ? (
                <p className="text-sm text-ink-3">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {prospect.activities.map(a => {
                    const Icon =
                      ACTIVITY_ICON[a.type] ??
                      (a.type.startsWith('AGREEMENT') || a.type === 'CHANGES_REQUESTED'
                        ? FileSignature
                        : CalendarClock);
                    const agreementEvent =
                      a.type.startsWith('AGREEMENT') || a.type === 'CHANGES_REQUESTED';
                    return (
                      <li key={a.id} className="flex gap-3">
                        <div
                          className={cn(
                            'mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sunken text-ink-2',
                            agreementEvent && 'bg-brand-tint text-brand-ink',
                            (a.type === 'AGREEMENT_VOIDED' ||
                              a.type === 'AGREEMENT_EXPIRED' ||
                              a.type === 'CHANGES_REQUESTED') &&
                              'bg-ringing-tint text-ringing-ink'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
                            <span className="font-medium text-ink-2">
                              {ACTIVITY_LABELS[a.type] ?? a.type}
                            </span>
                            <span>{shortDateTime(a.occurredAt)}</span>
                            {a.actor && <span>· {personName(a.actor)}</span>}
                            {!a.actor && agreementEvent && <span>· from the agreement</span>}
                          </div>
                          {a.body && (
                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{a.body}</p>
                          )}
                          {typeof a.detail?.note === 'string' && (
                            <p className="mt-1 border-l-2 border-rule-strong pl-2 text-xs text-ink-2">
                              {a.detail.note}
                            </p>
                          )}
                          {a.agreementEnvelopeId && (
                            <Link
                              href={`/sales-crm/agreements/${a.agreementEnvelopeId}`}
                              className="text-xs text-brand-ink underline"
                            >
                              Open agreement
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>Pipeline</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-3">
              {write ? (
                <>
                  <div>
                    <label htmlFor="stage" className="mb-1 block text-[11px] text-ink-3">
                      Stage
                    </label>
                    <select
                      id="stage"
                      className={`${SELECT_CLASS} w-full`}
                      value={prospect.stage}
                      onChange={e => {
                        const next = e.target.value as ProspectStage;
                        if (next === 'LOST') setLostOpen(true);
                        else void setStage(next);
                      }}
                    >
                      {STAGES.map(s => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={prospect.stage === 'WON' || busy !== null}
                      onClick={() => void setStage('WON')}
                    >
                      <Trophy className="mr-1.5 h-3.5 w-3.5" />
                      Mark won
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={prospect.stage === 'LOST' || busy !== null}
                      onClick={() => setLostOpen(true)}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Mark lost
                    </Button>
                  </div>
                  <div>
                    <label htmlFor="follow" className="mb-1 block text-[11px] text-ink-3">
                      Next follow-up
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="follow"
                        type="datetime-local"
                        value={followUp}
                        onChange={e => setFollowUp(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          busy !== null || followUp === toLocalInput(prospect.nextFollowUpAt)
                        }
                        onClick={() =>
                          void act('follow', () =>
                            apiClient.patch(`/api/v1/sales/prospects/${prospect.id}`, {
                              nextFollowUpAt: fromLocalInput(followUp),
                            })
                          )
                        }
                      >
                        Set
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="owner" className="mb-1 block text-[11px] text-ink-3">
                      Assigned to
                    </label>
                    <select
                      id="owner"
                      className={`${SELECT_CLASS} w-full`}
                      value={prospect.assignedUserId ?? ''}
                      onChange={e =>
                        void act('assign', () =>
                          apiClient.patch(`/api/v1/sales/prospects/${prospect.id}`, {
                            assignedUserId: e.target.value || null,
                          })
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>
                          {personName(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <Row label="Stage">{STAGE_LABELS[prospect.stage]}</Row>
                  <Row label="Follow-up">{shortDateTime(prospect.nextFollowUpAt)}</Row>
                  <Row label="Assigned">
                    {prospect.assignedUser ? personName(prospect.assignedUser) : '—'}
                  </Row>
                </>
              )}
              {prospect.stage === 'LOST' && prospect.lostReason && (
                <Row label="Lost because">{prospect.lostReason}</Row>
              )}
              <Row label="Last contact">{shortDateTime(prospect.lastContactedAt)}</Row>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Agreements</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-3">
              {prospect.agreements.length === 0 ? (
                <p className="text-sm text-ink-3">No agreements sent to this prospect yet.</p>
              ) : (
                prospect.agreements.map(a => (
                  <div key={a.id} className="rounded-control border border-rule p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/sales-crm/agreements/${a.id}`}
                        className="font-mono text-xs font-medium text-ink underline"
                      >
                        {a.reference}
                      </Link>
                      <Badge variant={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                    </div>
                    <div className="mt-1 flex gap-1">
                      {kinds(a).map(k => (
                        <Badge key={k} variant="outline" className="t-meta">
                          {k}
                        </Badge>
                      ))}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                      <dt className="text-ink-3">Sent</dt>
                      <dd>{shortDate(a.sentAt)}</dd>
                      <dt className="text-ink-3">Viewed</dt>
                      <dd>{shortDate(a.viewedAt)}</dd>
                      <dt className="text-ink-3">Signed</dt>
                      <dd>{shortDate(a.signedAt)}</dd>
                      <dt className="text-ink-3">Completed</dt>
                      <dd>{shortDate(a.completedAt)}</dd>
                    </dl>
                    <div className="mt-1 text-xs text-ink-3">
                      To {a.signerName} · {a.signerEmail}
                    </div>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>Contact</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <Row label="Company">{prospect.companyName ?? '—'}</Row>
              <Row label="Contact">
                {prospect.primaryContactName ??
                  ([prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || '—')}
              </Row>
              <Row label="Email">
                {prospect.email ? (
                  <a className="underline" href={`mailto:${prospect.email}`}>
                    {prospect.email}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Phone">{prospect.phone ?? '—'}</Row>
              <Row label="Website">{prospect.website ?? '—'}</Row>
              <Row label="Address">{prospect.address ?? '—'}</Row>
              {prospect.tags.length > 0 && (
                <Row label="Tags">
                  <div className="flex flex-wrap gap-1">
                    {prospect.tags.map(t => (
                      <Badge key={t} variant="outline" className="t-meta">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </Row>
              )}
              {prospect.summary && (
                <Row label="Summary">
                  <span className="whitespace-pre-wrap">{prospect.summary}</span>
                </Row>
              )}
            </PanelBody>
          </Panel>

          {context.can.manage && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void act('archive', () =>
                  apiClient.post(
                    `/api/v1/sales/prospects/${prospect.id}/${prospect.archivedAt ? 'restore' : 'archive'}`
                  )
                )
              }
            >
              {prospect.archivedAt ? (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Archive className="mr-1.5 h-3.5 w-3.5" />
              )}
              {prospect.archivedAt ? 'Restore prospect' : 'Archive prospect'}
            </Button>
          )}
        </div>
      </div>

      <ProspectFormDialog
        open={editing}
        onOpenChange={setEditing}
        prospect={prospect}
        members={members}
        onSaved={() => void load()}
      />

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
            <DialogDescription>Say why, so the pipeline report means something.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={lostReason}
            onChange={e => setLostReason(e.target.value)}
            aria-label="Lost reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!lostReason.trim() || busy !== null}
              onClick={() =>
                void setStage('LOST', lostReason.trim()).then(ok => {
                  if (ok) {
                    setLostOpen(false);
                    setLostReason('');
                  }
                })
              }
            >
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ProspectPage(): JSX.Element {
  return <SalesGate>{context => <ProspectView context={context} />}</SalesGate>;
}
