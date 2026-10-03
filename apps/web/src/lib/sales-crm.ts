/**
 * The B2B Sales CRM: types and wording shared by its screens.
 *
 * Not the consumer CRM (`/insurance-leads`). The API is
 * `apps/api/src/routes/sales.ts`; every call is answered for the sales
 * workspace the server resolves from the session, so nothing here names one.
 */

import { salesAgreementSurface, type AgreementSurface } from '@/lib/agreements';
import { apiClient, payload, type Envelope } from '@/lib/api';

export type ProspectType =
  | 'INSURANCE_AGENCY'
  | 'LICENSED_AGENT'
  | 'IMO_FMO'
  | 'CALL_CENTER'
  | 'OTHER';

export type ProspectStage =
  | 'NEW'
  | 'ATTEMPTING_CONTACT'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'PROPOSAL'
  | 'AGREEMENT_SENT'
  | 'AGREEMENT_REVIEW'
  | 'AGREEMENT_SIGNED'
  | 'WON'
  | 'LOST';

export const PROSPECT_TYPES: ProspectType[] = [
  'INSURANCE_AGENCY',
  'LICENSED_AGENT',
  'IMO_FMO',
  'CALL_CENTER',
  'OTHER',
];

export const TYPE_LABELS: Record<ProspectType, string> = {
  INSURANCE_AGENCY: 'Insurance agency',
  LICENSED_AGENT: 'Licensed agent',
  IMO_FMO: 'IMO / FMO',
  CALL_CENTER: 'Call center',
  OTHER: 'Other',
};

/** Pipeline order, then the two outcomes. */
export const STAGES: ProspectStage[] = [
  'NEW',
  'ATTEMPTING_CONTACT',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'AGREEMENT_SENT',
  'AGREEMENT_REVIEW',
  'AGREEMENT_SIGNED',
  'WON',
  'LOST',
];

export const STAGE_LABELS: Record<ProspectStage, string> = {
  NEW: 'New',
  ATTEMPTING_CONTACT: 'Attempting contact',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  AGREEMENT_SENT: 'Agreement sent',
  AGREEMENT_REVIEW: 'Agreement in review',
  AGREEMENT_SIGNED: 'Agreement signed',
  WON: 'Won',
  LOST: 'Lost',
};

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info';

export const STAGE_TONES: Record<ProspectStage, BadgeVariant> = {
  NEW: 'outline',
  ATTEMPTING_CONTACT: 'outline',
  CONTACTED: 'secondary',
  QUALIFIED: 'info',
  PROPOSAL: 'info',
  AGREEMENT_SENT: 'warning',
  AGREEMENT_REVIEW: 'warning',
  AGREEMENT_SIGNED: 'success',
  WON: 'success',
  LOST: 'secondary',
};

export const ACTIVITY_LABELS: Record<string, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  FOLLOW_UP: 'Follow-up',
  STAGE_CHANGE: 'Stage change',
  AGREEMENT_SENT: 'Agreement sent',
  AGREEMENT_VIEWED: 'Agreement viewed',
  AGREEMENT_SIGNED: 'Agreement signed',
  AGREEMENT_COMPLETED: 'Agreement completed',
  AGREEMENT_VOIDED: 'Agreement voided',
  AGREEMENT_EXPIRED: 'Agreement expired',
  CHANGES_REQUESTED: 'Changes requested',
};

export interface PersonRef {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export function personName(p: PersonRef | null | undefined): string {
  if (!p) return '—';
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email;
}

export interface Prospect {
  id: string;
  type: ProspectType;
  displayName: string;
  companyName: string | null;
  primaryContactName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  state: string | null;
  address: string | null;
  source: string | null;
  stage: ProspectStage;
  assignedUserId: string | null;
  assignedUser?: PersonRef | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  summary: string | null;
  tags: string[];
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  followUpState?: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | null;
  latestAgreement?: { id: string; reference: string; status: string; sentAt: string } | null;
}

export interface SalesContext {
  workspace: { name: string; scope: 'PLATFORM' | 'TENANT' };
  access: { level: 'MANAGER' | 'MEMBER' | 'READONLY'; via: string };
  can: { write: boolean; manage: boolean; grantAccess: boolean; sendAgreements: boolean };
  suite: {
    displayName: string;
    legalName: string;
    brandTheme: string | null;
    referencePrefix: string;
    templatesConfigured: boolean;
    templatesMessage: string | null;
    missingSetting: string | null;
    enabled: boolean;
    canSend: boolean;
  };
}

export interface SalesMetrics {
  openProspects: number;
  qualified: number;
  agreementsOut: number;
  agreementsSigned: number;
  won: number;
  lost: number;
  followUpsDueToday: number;
  overdueFollowUps: number;
  byStage: Partial<Record<ProspectStage, number>>;
}

export interface SalesMember extends PersonRef {
  access: string | null;
}

/** The session's sales workspace, or the server's refusal. */
export async function fetchSalesContext(): Promise<
  | { context: SalesContext; error: null }
  | { context: null; error: { code: string; message: string } }
> {
  const response = await apiClient.get<Envelope<SalesContext>>('/api/v1/sales/context');
  const context = payload(response);
  if (context) return { context, error: null };
  return {
    context: null,
    error: response.error ?? { code: 'UNKNOWN', message: 'The Sales CRM could not be loaded.' },
  };
}

/** The agreement surface for the session's workspace. */
export function surfaceFor(context: SalesContext): AgreementSurface {
  return salesAgreementSurface(context.suite.displayName, context.suite.legalName);
}

/** `2026-10-03T14:00` in the browser's zone, for a datetime-local input. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const SELECT_CLASS =
  'h-9 rounded-control border border-rule-strong bg-surface px-2 text-sm text-ink shadow-card focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
