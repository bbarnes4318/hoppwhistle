/**
 * Shared types and wording for the electronic agreements screens: the
 * platform-admin pages under /admin/agreements and the public signer and
 * client pages. The API is `apps/api/src/routes/agreements.ts`.
 */

export type AgreementStatus =
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'COMPLETED'
  | 'CHANGES_REQUESTED'
  | 'VOIDED'
  | 'EXPIRED';

export type DocumentKind = 'MSA' | 'CPA' | 'CPL';

export const STATUS_LABELS: Record<AgreementStatus, string> = {
  SENT: 'Sent',
  VIEWED: 'Viewed',
  SIGNED: 'Signed · completing',
  COMPLETED: 'Completed',
  CHANGES_REQUESTED: 'Changes requested',
  VOIDED: 'Voided',
  EXPIRED: 'Expired',
};

export type BadgeTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'info';

export const STATUS_TONES: Record<AgreementStatus, BadgeTone> = {
  SENT: 'info',
  VIEWED: 'info',
  SIGNED: 'warning',
  COMPLETED: 'success',
  CHANGES_REQUESTED: 'warning',
  VOIDED: 'secondary',
  EXPIRED: 'secondary',
};

/** Every event type, in plain words. */
export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Envelope created',
  NETENROLL_SIGNED: 'Signed by NetEnroll',
  ISSUER_SIGNED: 'Signed by issuer',
  SENT: 'Sent to signer',
  EMAIL_NOT_SENT: 'Email not sent',
  RESENT: 'Link resent',
  LINK_OPENED: 'Link opened',
  OTP_SENT: 'Verification code sent',
  OTP_VERIFIED: 'Verification code verified',
  OTP_FAILED: 'Wrong verification code',
  OTP_LOCKED: 'Verification code locked',
  CONSENT_GIVEN: 'Electronic records consent given',
  PARTY_DETAILS_SUBMITTED: 'Agency details entered',
  DOCUMENT_REVIEWED: 'Document reviewed',
  SIGNED: 'Signed by agency',
  COMPLETED: 'Completed',
  COMPLETION_FAILED: 'Completion failed',
  CHANGES_REQUESTED: 'Changes requested',
  VOIDED: 'Voided',
  EXPIRED: 'Expired',
  COPIES_SENT: 'Executed copies sent',
  DOWNLOADED: 'Executed copy downloaded',
};

export const VERTICALS = ['FE', 'MEDICARE', 'ACA'] as const;
export type Vertical = (typeof VERTICALS)[number];
export const VERTICAL_NAMES: Record<Vertical, string> = {
  FE: 'Final Expense',
  MEDICARE: 'Medicare',
  ACA: 'ACA (Health)',
};

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const DAY_SHORT: Record<string, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};

export interface EnvelopeSummary {
  id: string;
  reference: string;
  status: AgreementStatus;
  tenantId: string | null;
  agencyLegalName: string;
  inviteeOrganization: string | null;
  detailsEntered: boolean;
  partyKind: 'BUSINESS' | 'INDIVIDUAL' | null;
  includesMsa: boolean;
  includesCpa: boolean;
  includesCpl: boolean;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  ccEmails: string[];
  sentAt: string;
  viewedAt: string | null;
  signedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  voidedAt: string | null;
  changesRequestedAt: string | null;
  sealed: boolean;
  lastActivityAt?: string;
}

/** The agency's details as the signer entered them (API `partyDetailsSchema`). */
export type PartyDetails =
  | {
      kind: 'BUSINESS';
      legalName: string;
      dbaName?: string | null;
      stateOfFormation: string;
      entityType: string;
      noticeAddress: string;
      principalName: string;
      principalTitle: string;
      noticeEmail: string;
      noticePhone: string;
      billingEmail: string;
      billingPhone: string;
      signerName: string;
      signerTitle: string;
    }
  | {
      kind: 'INDIVIDUAL';
      legalName: string;
      dbaName?: string | null;
      stateOfResidence: string;
      noticeAddress: string;
      noticeEmail: string;
      noticePhone: string;
      billingEmail: string;
      billingPhone: string;
    };

export function kindsOf(
  e: Pick<EnvelopeSummary, 'includesMsa' | 'includesCpa' | 'includesCpl'>
): DocumentKind[] {
  const kinds: DocumentKind[] = [];
  if (e.includesMsa) kinds.push('MSA');
  if (e.includesCpa) kinds.push('CPA');
  if (e.includesCpl) kinds.push('CPL');
  return kinds;
}

const ET = 'America/New_York';

export function etDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function etDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: ET,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Today in Eastern Time as YYYY-MM-DD. */
export function etTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fetch a file with the signed-in session and save it. */
export async function downloadWithSession(path: string, fileName: string): Promise<string | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return body?.error?.message ?? `Download failed (${response.status}).`;
  }
  saveBlob(await response.blob(), fileName);
  return null;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Surfaces ────────────────────────────────────────────────────────────────

/**
 * Which agreement suite a screen manages, and where its API and pages live.
 *
 *   NetEnroll's own suite   /admin/agreements, /api/v1/platform/agreements
 *   a sales workspace's     /sales-crm/agreements, /api/v1/sales/agreements
 *
 * The sales API answers for the workspace the SERVER resolved from the session;
 * this object only says which door to knock on. It names no workspace.
 */
export interface AgreementSurface {
  kind: 'platform' | 'sales';
  apiBase: string;
  routeBase: string;
  settingsHref: string;
  /** "NetEnroll", "Life Leads Plus". */
  issuerName: string;
  /** "PVN LLC d/b/a NetEnroll", "Life Leads Plus LLC". */
  issuerLegalName: string;
}

export const PLATFORM_AGREEMENT_SURFACE: AgreementSurface = {
  kind: 'platform',
  apiBase: '/api/v1/platform/agreements',
  routeBase: '/admin/agreements',
  settingsHref: '/admin/agreements/settings',
  issuerName: 'NetEnroll',
  issuerLegalName: 'PVN LLC d/b/a NetEnroll',
};

export function salesAgreementSurface(
  issuerName: string,
  issuerLegalName: string
): AgreementSurface {
  return {
    kind: 'sales',
    apiBase: '/api/v1/sales/agreements',
    routeBase: '/sales-crm/agreements',
    settingsHref: '/sales-crm/settings',
    issuerName,
    issuerLegalName,
  };
}

/** The confirmation the sender ticks before signing for the issuer. */
export function authorityStatement(surface: AgreementSurface): string {
  return `I confirm I am authorized to sign these agreements on behalf of ${surface.issuerLegalName}, and I adopt the signature shown as my electronic signature.`;
}
