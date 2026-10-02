'use client';

import { Check, Copy, Loader2, Mail, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Notice } from '@/components/domain';
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
import { Label } from '@/components/ui/label';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * Inviting an agency's owner: one dialog, every screen that can do it.
 *
 * The owner of an agency is the first person inside it, so nobody there can
 * invite them. Two kinds of operator can, through two routes that mint the same
 * single-use activation grant and email it the same way:
 *
 *   `network`   a white-label agency inviting the owner of a downline agency
 *               it onboarded -- `POST /api/v1/network/agencies/:id/owner`.
 *   `platform`  a NetEnroll platform admin inviting the owner of any agency --
 *               `POST /api/v1/platform/onboarding/agencies/:id/owner`.
 *
 * ── The link is a fallback, not the flow ─────────────────────────────────────
 *
 * The invitation is emailed. The grant's token cannot be read back, so when the
 * message did not go (no mail server, or the send failed) the link in the answer
 * is the only copy there will ever be. The dialog reads `emailed` and shows one
 * of two things: a confirmation, or the link with a copy button and a plain
 * statement that nobody was contacted. Saying nothing would leave an operator
 * believing the owner had been written to.
 */

export type InviteOwnerScope = 'network' | 'platform';

export interface InviteOwnerAgency {
  tenantId: string;
  name: string;
  /** The owner's address if one was already invited, else the agency's contact. */
  email?: string | null;
  /** Whether an invitation is already out, which changes the wording. */
  alreadyInvited?: boolean;
}

interface InviteOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agency: InviteOwnerAgency | null;
  scope: InviteOwnerScope;
  onInvited?: () => void;
}

interface OwnerGrant {
  activationToken: string;
  activationLink?: string;
  email: string;
  expiresAt?: string;
  emailed: boolean;
  emailFailureReason?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function endpointFor(scope: InviteOwnerScope, tenantId: string): string {
  const id = encodeURIComponent(tenantId);
  return scope === 'platform'
    ? `/api/v1/platform/onboarding/agencies/${id}/owner`
    : `/api/v1/network/agencies/${id}/owner`;
}

/** The link to hand over by hand when the email did not go. */
function linkFor(grant: OwnerGrant): string {
  if (grant.activationLink) return grant.activationLink;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({ activation: grant.activationToken, email: grant.email });
  return `${origin}/login?${params.toString()}`;
}

export function InviteOwnerDialog({
  open,
  onOpenChange,
  agency,
  scope,
  onInvited,
}: InviteOwnerDialogProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OwnerGrant | null>(null);
  const [copied, setCopied] = useState(false);

  // Each time the dialog opens, start from this agency's address.
  useEffect(() => {
    if (open) {
      setEmail(agency?.email ?? '');
      setError(null);
      setResult(null);
      setCopied(false);
    }
  }, [open, agency?.tenantId, agency?.email]);

  const trimmed = email.trim().toLowerCase();
  const valid = EMAIL_PATTERN.test(trimmed);
  const resending = agency?.alreadyInvited === true;

  async function submit(): Promise<void> {
    if (!agency) return;
    if (!valid) {
      setError('Enter a valid email address.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post<Envelope<OwnerGrant>>(
        endpointFor(scope, agency.tenantId),
        { email: trimmed }
      );
      const grant = payload(response);
      if (response.error || !grant) {
        // The client reports a refusal as `{ error }` rather than throwing, so
        // the server's own reason (the address already has an account, or the
        // agency has no profile yet) has to be read here.
        setError(response.error?.message || 'The invitation could not be sent.');
        return;
      }
      setResult(grant);
      onInvited?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invitation could not be sent.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(linkFor(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused. The link is on screen and selectable.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-ink-2" aria-hidden />
            {resending ? 'Resend the owner invitation' : 'Invite the owner'}
          </DialogTitle>
          <DialogDescription>
            {agency
              ? `${agency.name}'s owner gets an email with a link to create their sign-in. The link works once and expires in seven days.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          result.emailed ? (
            <Notice
              tone="info"
              icon={Mail}
              title={`Invitation sent to ${result.email}`}
              data-invite-result="emailed"
            >
              <p className="t-body">
                They can sign in as soon as they open the link. Use Resend if it does not arrive.
              </p>
            </Notice>
          ) : (
            <Notice
              tone="warning"
              title={`${result.email} has NOT been emailed${
                result.emailFailureReason === 'not_configured'
                  ? ' — no mail server is configured.'
                  : ' — the message could not be sent.'
              }`}
              data-invite-result="link"
            >
              <p className="t-body">
                Send them this link yourself. It is shown once and cannot be recovered.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  readOnly
                  value={linkFor(result)}
                  className="font-mono text-xs"
                  aria-label="Activation link"
                  onFocus={event => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyLink()}
                  aria-label="Copy activation link"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </Notice>
          )
        ) : (
          <form
            className="space-y-2"
            onSubmit={event => {
              event.preventDefault();
              void submit();
            }}
          >
            <Label htmlFor="owner-invite-email">Owner&rsquo;s email address</Label>
            <Input
              id="owner-invite-email"
              type="email"
              autoComplete="off"
              autoFocus
              placeholder="owner@theiragency.com"
              value={email}
              onChange={event => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'owner-invite-error' : undefined}
            />
            {error ? (
              <p id="owner-invite-error" role="alert" className="t-meta text-dropped-ink">
                {error}
              </p>
            ) : null}
          </form>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving || !email.trim()}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {resending ? 'Resend invitation' : 'Send invitation'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
