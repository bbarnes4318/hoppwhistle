'use client';

import { Laptop, Loader2, LogOut, MonitorSmartphone, Smartphone } from 'lucide-react';
import * as React from 'react';

import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
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
import { apiClient } from '@/lib/api';

import { describeDevice, formatDateTime, type DeviceDescription } from './account-identity';

/**
 * Where this login is signed in, and the way to end it everywhere else.
 *
 * There is no session table to list: a session is a signed token, revoked by
 * moving the account's token version on (`lib/token-version.ts` in the API).
 * So the panel is honest about what it knows -- this device, and when its
 * session lapses -- and offers the one thing that can be done about the rest:
 * `POST /api/auth/me/sessions/revoke` signs every other device out and hands
 * this tab a fresh token, stored the same way a password change stores one.
 *
 * Signing out of this device is a full page load, for the reason the topbar's
 * sign-out gives: in-memory session state must not outlive the session.
 */
export function SessionsPanel({
  sessionExpiresAt,
  readOnly = false,
}: {
  sessionExpiresAt: string | null;
  /** A read-only role preview: the server refuses the revoke, so say so here. */
  readOnly?: boolean;
}): JSX.Element {
  const [device, setDevice] = React.useState<DeviceDescription | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // Read after mount so the server and the client render the same thing.
  React.useEffect(() => {
    setDevice(describeDevice(navigator.userAgent));
  }, []);

  const expires = formatDateTime(sessionExpiresAt);
  const DeviceIcon = device?.mobile ? Smartphone : Laptop;

  async function revokeOthers(): Promise<void> {
    setRevoking(true);
    setError(null);
    setDone(false);
    try {
      const response = await apiClient.post<{ ok: boolean; token: string }>(
        '/api/auth/me/sessions/revoke',
        {}
      );
      if (response.error || !response.data?.token) {
        setError(response.error?.message ?? 'Your other devices were not signed out. Try again.');
        return;
      }
      apiClient.setToken(response.data.token);
      setDone(true);
      setConfirming(false);
    } catch {
      setError('Your other devices were not signed out. Try again.');
    } finally {
      setRevoking(false);
    }
  }

  function signOutHere(): void {
    apiClient.clearToken();
    window.location.replace('/login');
  }

  return (
    <Panel data-sessions>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-ink-3" aria-hidden />
          Sessions
        </PanelTitle>
        <PanelDescription>
          Sessions renew automatically while you use the portal. Sign out anywhere you no longer use
          or recognize.
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="grid gap-4">
        <div className="flex flex-col gap-4 rounded-card border border-rule p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
              <DeviceIcon aria-hidden className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {device ? `${device.browser} on ${device.os}` : 'This browser'}
                </span>
                <Badge variant="success">This device</Badge>
              </div>
              <p className="t-meta mt-0.5 text-ink-3">
                {expires ? `Active now · Session valid until ${expires}` : 'Active now'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={signOutHere}
            className="self-start sm:self-auto"
          >
            <LogOut aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>

        <div className="flex flex-col gap-4 rounded-card border border-rule p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">All other devices</p>
            <p className="t-meta mt-0.5 text-ink-3">
              Ends every other session on this account, on every browser and phone. You stay signed
              in here.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={readOnly}
            className="self-start text-dropped-ink sm:self-auto"
          >
            Sign out other devices
          </Button>
        </div>

        {readOnly ? (
          <p className="t-meta text-ink-3">Not available in a read-only preview.</p>
        ) : null}
        {done ? <Notice tone="info" title="Every other device has been signed out." /> : null}
        {error && !confirming ? <Notice tone="error" title={error} /> : null}
      </PanelBody>

      <Dialog open={confirming} onOpenChange={open => !revoking && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of all other devices?</DialogTitle>
            <DialogDescription>
              Anyone signed in to this account on another browser or phone will have to sign in
              again. This device stays signed in. Your password is not changed.
            </DialogDescription>
          </DialogHeader>
          {error ? <Notice tone="error" title={error} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void revokeOthers()} disabled={revoking}>
              {revoking ? <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign out other devices
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
