import { MicOff, RefreshCw, WifiOff, X } from 'lucide-react';

import { Notice } from '@/components/domain/notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { describePhoneError } from './format';
import { FOCUS_RING, TOUCH_TARGET } from './parts';

/**
 * What is wrong with the phone, in a sentence an agent can act on, with the
 * fix beside it. Never the provider's own error text: that is written for a
 * log, and "SIP connection lost" means nothing to the person on the floor.
 */
export type ConnectionNoticeProps =
  | { kind: 'failed'; onReconnect: () => void }
  | { kind: 'retrying'; attempts: number; maxAttempts?: number }
  | { kind: 'mic-denied' }
  | { kind: 'error'; error: string; onReconnect?: () => void; onDismiss?: () => void };

export function ConnectionNotice(props: ConnectionNoticeProps): JSX.Element | null {
  switch (props.kind) {
    case 'failed':
      return (
        <Notice
          tone="error"
          icon={WifiOff}
          title="Your phone is not connected"
          role="alert"
          action={<ReconnectButton onClick={props.onReconnect} />}
        >
          Calls will not reach you until it reconnects. Check your internet connection, then
          reconnect.
        </Notice>
      );
    case 'retrying':
      return (
        <Notice tone="warning" icon={RefreshCw} title="Reconnecting your phone" role="status">
          Attempt {props.attempts} of {props.maxAttempts ?? 5}. Calls cannot reach you until it is
          back — this usually takes a few seconds.
        </Notice>
      );
    case 'mic-denied':
      return (
        <Notice tone="error" icon={MicOff} title="Your microphone is blocked" role="alert">
          Callers will not hear you. Click the lock icon at the left of the address bar, set{' '}
          <span className="font-semibold text-ink">Microphone</span> to{' '}
          <span className="font-semibold text-ink">Allow</span>, then reload this page.
        </Notice>
      );
    case 'error': {
      const copy = describePhoneError(props.error);
      if (!copy) return null;
      return (
        <Notice
          tone="error"
          title={copy.title}
          role="alert"
          action={
            <>
              {copy.reconnect && props.onReconnect ? (
                <ReconnectButton onClick={props.onReconnect} />
              ) : null}
              {props.onDismiss ? (
                <button
                  type="button"
                  onClick={props.onDismiss}
                  aria-label="Dismiss"
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-2 hover:bg-surface hover:text-ink',
                    FOCUS_RING,
                    TOUCH_TARGET
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </>
          }
        >
          {copy.body}
        </Notice>
      );
    }
  }
}

function ReconnectButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <Button variant="outline" size="sm" onClick={onClick} className="gap-1.5">
      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      Reconnect
    </Button>
  );
}
