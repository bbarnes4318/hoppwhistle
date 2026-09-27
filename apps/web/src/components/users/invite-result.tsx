'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Notice } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * What `POST /api/v1/auth/activation-grants` answers, and what an invite
 * screen shows afterwards.
 *
 * Every way an agency adds a person -- a team member, a buyer's portal login, a
 * publisher's -- goes through that one route now; the temporary-password
 * route is gone (410). The grant is emailed. When it was not (no mail server,
 * or the send failed) the link in this answer is the only copy there will ever
 * be, so it is put on screen with a copy button and a plain statement that
 * nobody was contacted. Same rule as the "Add an agent" dialog.
 */
export interface ActivationGrant {
  activationToken: string;
  activationLink: string;
  email: string;
  role: string;
  buyerId: string | null;
  publisherId: string | null;
  expiresAt: string;
  emailed: boolean;
  emailFailureReason: 'not_configured' | 'send_failed' | null;
}

export const ACTIVATION_GRANTS_PATH = '/api/v1/auth/activation-grants';

export function InviteResult({ grant }: { grant: ActivationGrant }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(grant.activationLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused; the link is on screen and selectable.
    }
  }

  if (grant.emailed) {
    return (
      <Notice tone="info" title={`Invite sent to ${grant.email}`} data-invite-result="emailed">
        <p className="t-body">
          The link works once, until{' '}
          {new Date(grant.expiresAt).toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
          .
        </p>
      </Notice>
    );
  }

  return (
    <Notice
      tone="warning"
      title={`${grant.email} has NOT been emailed${
        grant.emailFailureReason === 'not_configured'
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
          value={grant.activationLink}
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
  );
}
