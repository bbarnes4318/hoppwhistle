'use client';

import { Check, Copy, Loader2, Mail, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { apiClient } from '@/lib/api';
import {
  JURISDICTIONS,
  REGIONS,
  jurisdictionsInRegion,
  searchJurisdictions,
} from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * Adding an agent to the agency.
 *
 * ── Why this is not the generic invite dialog ────────────────────────────────
 *
 * `components/users/invite-user-dialog.tsx` offers five roles and a buyer
 * picker, because it is the NetEnroll-side screen for creating any kind of
 * account. An agency can invite exactly one thing -- an AGENT -- and the server
 * refuses anything else with a 403 that explains an additional owner is
 * arranged with NetEnroll. Offering a role select here would be offering four
 * choices that come back refused.
 *
 * ── The token is a fallback, not the flow ────────────────────────────────────
 *
 * The invitation is emailed. It used to be that the endpoint returned a token
 * and a comment saying "send it to the invitee", and nothing sent it -- so an
 * owner copied a token into a text message.
 *
 * It still comes back, because when SMTP is unconfigured or the send fails the
 * token is the only copy of a grant that cannot be retrieved again, and
 * hand-delivery is the only way through. So this dialog reads `emailed` and
 * shows one of two things: a confirmation, or the link with a copy button and
 * a plain statement that the agent has NOT been emailed. Saying nothing would
 * leave an owner believing the agent had been contacted.
 */

interface InviteAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: () => void;
}

interface GrantResponse {
  activationToken: string;
  /**
   * The server's link, on the agency's own portal host (its domain, or its
   * white-label parent's, or agents.netenroll.com). Preferred over this
   * page's origin, which is only the host the owner happens to be using.
   */
  activationLink?: string;
  email: string;
  expiresAt: string;
  emailed: boolean;
  emailFailureReason: string | null;
}

/** The link an owner hand-delivers when the email did not go. */
function invitationLink(grant: GrantResponse): string {
  if (grant.activationLink) return grant.activationLink;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({ activation: grant.activationToken, email: grant.email });
  return `${origin}/login?${params.toString()}`;
}

export function InviteAgentDialog({
  open,
  onOpenChange,
  onInvited,
}: InviteAgentDialogProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrantResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const visible = useMemo(() => searchJurisdictions(query), [query]);

  function toggle(code: string): void {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleRegion(region: (typeof REGIONS)[number]): void {
    setSelected(prev => {
      const codes = jurisdictionsInRegion(region).map(j => j.code);
      const next = new Set(prev);
      const allOn = codes.every(code => next.has(code));
      for (const code of codes) {
        if (allOn) next.delete(code);
        else next.add(code);
      }
      return next;
    });
  }

  function reset(): void {
    setSelected(new Set());
    setQuery('');
    setEmail('');
    setError(null);
    setResult(null);
    setCopied(false);
  }

  async function submit(): Promise<void> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('An email address is required.');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one state the agent is licensed in.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post<GrantResponse>('/api/v1/auth/activation-grants', {
        email: trimmed,
        role: 'AGENT',
        licensedStates: [...selected].sort(),
      });
      const data = response.data;
      if (!data) {
        // The client reports a refusal as `{ error }` rather than throwing, so
        // the server's own reason (e.g. the email already has an account) has
        // to be read here or the owner only sees the generic line.
        setError(response.error?.message || 'The invitation could not be created.');
        return;
      }
      setResult(data);
      onInvited?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The invitation could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(invitationLink(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure context, or permission). The link is on
      // screen and selectable, so this is a convenience that failed, not a
      // dead end.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add an agent
          </DialogTitle>
          <DialogDescription>
            They will be emailed a link to set up their account. Choose the states they are licensed
            in — they are only sent calls from those states — then assign them a campaign.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            {result.emailed ? (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium">Invitation sent to {result.email}</p>
                  <p className="text-muted-foreground">
                    The link works once, until{' '}
                    {new Date(result.expiresAt).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    .
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">
                  {result.email} has NOT been emailed
                  {result.emailFailureReason === 'not_configured'
                    ? ' — no mail server is configured.'
                    : ' — the message could not be sent.'}
                </p>
                <p className="text-muted-foreground">
                  Send them this link yourself. It is shown once and cannot be recovered.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={invitationLink(result)}
                    className="font-mono text-xs"
                    onFocus={event => event.currentTarget.select()}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-email">Email address</Label>
              <Input
                id="agent-email"
                type="email"
                autoComplete="off"
                placeholder="agent@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Licensed states</Label>
                <span className="text-sm tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{selected.size}</span> of{' '}
                  {JURISDICTIONS.length}
                </span>
              </div>
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search by name or code…"
                aria-label="Search states"
              />
              <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                {REGIONS.map(region => {
                  const items = visible.filter(j => j.region === region);
                  if (items.length === 0) return null;
                  const allOn = jurisdictionsInRegion(region).every(j => selected.has(j.code));
                  return (
                    <div key={region}>
                      <div className="mb-1 flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          {region}
                        </h4>
                        <button
                          type="button"
                          onClick={() => toggleRegion(region)}
                          className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {allOn ? 'Clear region' : 'Select region'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {items.map(j => {
                          const on = selected.has(j.code);
                          return (
                            <button
                              key={j.code}
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              aria-label={`${j.name} (${j.code})`}
                              onClick={() => toggle(j.code)}
                              className={cn(
                                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                                on
                                  ? 'border-primary/40 bg-primary/10 text-foreground'
                                  : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted'
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">{j.name}</span>
                              <span className="shrink-0 font-mono text-[10px]">{j.code}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                }}
              >
                Add another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={saving || !email.trim() || selected.size === 0}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Send invitation
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
