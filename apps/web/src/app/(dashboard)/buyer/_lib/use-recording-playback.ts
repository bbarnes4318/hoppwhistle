'use client';

import * as React from 'react';

import { readSessionToken } from '@/lib/session-token';

import { recordingPlaybackUrl } from '../actions';

import { recordingIdFromUrl } from './calls';

/**
 * Same-origin form of a playback URL. `/api/v1/*` is proxied by the web app
 * (next.config.js), and the API may describe itself by an internal host when
 * it is called server-side.
 */
function sameOrigin(url: string): string {
  try {
    const parsed = new URL(url, 'http://placeholder');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Resolve a call's recording URL into one an <audio> element can play.
 *
 * The URL on the call carries no credential -- it used to carry a week-long
 * login token -- so an in-app recording is exchanged, when it is actually
 * shown, for a 15-minute pass good for that one stream. A URL that is not one
 * of ours (a carrier-hosted recording) is played as it is.
 */
export function useRecordingPlayback(
  recordingUrl: string | null,
  enabled: boolean
): { src: string | null; loading: boolean; error: string | null } {
  const recordingId = recordingIdFromUrl(recordingUrl);
  const [state, setState] = React.useState<{
    src: string | null;
    loading: boolean;
    error: string | null;
  }>({ src: null, loading: false, error: null });

  React.useEffect(() => {
    if (!enabled || !recordingUrl) {
      setState({ src: null, loading: false, error: null });
      return;
    }
    if (!recordingId) {
      setState({ src: recordingUrl, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ src: null, loading: true, error: null });
    void recordingPlaybackUrl(readSessionToken() ?? '', recordingId).then(result => {
      if (cancelled) return;
      setState(
        result.ok && result.url
          ? { src: sameOrigin(result.url), loading: false, error: null }
          : { src: null, loading: false, error: result.error ?? 'Could not load this recording.' }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, recordingUrl, recordingId]);

  return state;
}
