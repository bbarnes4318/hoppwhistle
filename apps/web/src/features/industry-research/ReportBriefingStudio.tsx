'use client';

import type { StructuredReport } from '@hopwhistle/shared';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { researchApi } from './api';
import { BRIEFING_MODES, buildBriefingScript, type BriefingMode } from './ui/report-story';

type AudioState = 'idle' | 'preparing' | 'playing';
type AvatarState =
  | { state: 'idle' | 'loading' | 'disabled' | 'error'; reason?: string }
  | { state: 'live'; url: string; token: string };

const MODE_HINT: Record<BriefingMode, string> = {
  executive: 'The verdict, the strongest reason for and against, and your first move.',
  opportunity: 'Why the top-ranked path stands out and what it takes to win it.',
  risk: 'How this fails, the hardest risks, and the lines you should not cross.',
  execution: 'Where to start and how to prove demand before spending.',
};

/**
 * AI Briefing Studio — an intentional part of the report (not a bolted-on
 * widget). Four briefings are generated deterministically from the report; each
 * plays as spoken audio with a transcript, and the live Protoface avatar can
 * present it as a talking-head video. Everything is rv-styled so it reads as
 * part of the document.
 */
export function ReportBriefingStudio({ report, runId }: { report: StructuredReport; runId: string }) {
  const [mode, setMode] = useState<BriefingMode>('executive');
  const [audio, setAudio] = useState<AudioState>('idle');
  const [showTranscript, setShowTranscript] = useState(true);
  const [avatar, setAvatar] = useState<AvatarState>({ state: 'idle' });
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Resolve TTS support AFTER mount so the server and first client render match
  // (avoids a hydration mismatch on the audio controls).
  const [ttsSupported, setTtsSupported] = useState(false);
  useEffect(() => {
    setTtsSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);
  const script = useMemo(() => buildBriefingScript(report, mode), [report, mode]);
  const meta = BRIEFING_MODES.find(m => m.id === mode)!;
  const seconds = Math.max(20, Math.round(script.split(/\s+/).length / 2.6));

  useEffect(
    () => () => {
      if (ttsSupported) window.speechSynthesis.cancel();
    },
    [ttsSupported]
  );
  useEffect(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setAudio('idle');
    setAvatar({ state: 'idle' });
  }, [mode, ttsSupported]);

  const play = () => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    setAudio('preparing');
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(vc => /en-US/i.test(vc.lang) && /natural|neural|samantha|google/i.test(vc.name)) ??
      voices.find(vc => /en/i.test(vc.lang));
    if (preferred) u.voice = preferred;
    u.onstart = () => setAudio('playing');
    u.onend = () => setAudio('idle');
    u.onerror = () => setAudio('idle');
    utterRef.current = u;
    setTimeout(() => window.speechSynthesis.speak(u), 120);
  };
  const stop = () => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setAudio('idle');
  };

  const loadAvatar = async () => {
    if (avatar.state === 'loading' || avatar.state === 'live') return; // prevent concurrent sessions
    if (ttsSupported) window.speechSynthesis.cancel();
    setAudio('idle');
    setAvatar({ state: 'loading' });
    try {
      const res = await researchApi.avatarSession(runId, mode, script);
      if (!res.enabled || !res.url || !res.token) setAvatar({ state: 'disabled', reason: res.reason });
      else setAvatar({ state: 'live', url: res.url, token: res.token });
    } catch (e) {
      setAvatar({ state: 'error', reason: String((e as Error)?.message ?? e) });
    }
  };

  return (
    <div className="rv-card" style={{ padding: 'var(--rv-5)' }}>
      <div className="rv-briefing-grid">
        {/* Mode selector */}
        <div>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>Choose a briefing</div>
          <div className="rv-stack-gap" style={{ gap: 'var(--rv-2)' }}>
            {BRIEFING_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className="rv-mode-btn"
                data-active={mode === m.id}
              >
                <div style={{ fontSize: 13, fontWeight: 650 }}>{m.label}</div>
                <div className="rv-micro rv-muted" style={{ marginTop: 2 }}>{m.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Player */}
        <div style={{ minWidth: 0 }}>
          <div className="rv-panel" style={{ padding: 'var(--rv-4)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div className="rv-h3">{meta.label}</div>
              <span className="rv-micro rv-muted rv-num">
                {audio === 'preparing' ? 'Preparing…' : audio === 'playing' ? 'Playing…' : `~${seconds}s`}
              </span>
            </div>
            <p className="rv-small rv-dim" style={{ margin: '4px 0 var(--rv-3)' }}>
              What you'll hear: {MODE_HINT[mode]}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ttsSupported ? (
                audio === 'idle' ? (
                  <button className="rv-btn rv-btn-primary" onClick={play}>▶ Play audio</button>
                ) : (
                  <>
                    <button className="rv-btn" onClick={stop}>■ Stop</button>
                    <button className="rv-btn rv-btn-ghost" onClick={play} disabled={audio === 'preparing'}>↻ Replay</button>
                  </>
                )
              ) : (
                <span className="rv-micro rv-muted">Audio playback isn't supported here — read the transcript.</span>
              )}
              <button
                className="rv-btn"
                onClick={loadAvatar}
                disabled={avatar.state === 'loading' || avatar.state === 'live'}
              >
                ◉ {avatar.state === 'loading' ? 'Starting…' : 'Play video avatar'}
              </button>
              <button
                className="rv-btn rv-btn-ghost"
                onClick={() => setShowTranscript(s => !s)}
                aria-expanded={showTranscript}
                style={{ marginLeft: 'auto' }}
              >
                {showTranscript ? 'Hide transcript' : 'Show transcript'}
              </button>
            </div>

            {showTranscript && (
              <p className="rv-small" style={{ marginTop: 'var(--rv-3)', lineHeight: 1.7, color: 'var(--rv-ink)' }}>
                {script}
              </p>
            )}
          </div>

          {/* Avatar stage */}
          <div style={{ marginTop: 'var(--rv-3)' }}>
            {avatar.state === 'live' && <AvatarVideo url={avatar.url} token={avatar.token} onClose={() => setAvatar({ state: 'idle' })} />}
            {avatar.state === 'disabled' && (
              <div className="rv-callout" style={{ fontSize: 12 }}>
                <span className="rv-eyebrow" style={{ flexShrink: 0 }}>Video</span>
                <p className="rv-micro rv-muted" style={{ margin: 0 }}>
                  {avatar.reason ?? 'The video avatar is not configured on this environment.'} The audio briefing and transcript work regardless.
                </p>
              </div>
            )}
            {avatar.state === 'error' && (
              <div className="rv-callout rv-callout-neg" style={{ fontSize: 12 }}>
                <span className="rv-eyebrow rv-neg" style={{ flexShrink: 0 }}>Video</span>
                <div>
                  <p className="rv-micro" style={{ margin: 0 }}>Couldn't start the video briefing. {avatar.reason}</p>
                  <button className="rv-btn rv-btn-ghost" style={{ marginTop: 6 }} onClick={loadAvatar}>Retry</button>
                </div>
              </div>
            )}
            <p className="rv-micro rv-muted" style={{ marginTop: 'var(--rv-2)' }}>
              The avatar presents one briefing at a time (the plan allows a single live session).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Live Protoface avatar video (rv-styled) — joins the LiveKit room the API set
 *  up and attaches the avatar's lip-synced video + audio tracks. */
function AvatarVideo({ url, token, onClose }: { url: string; token: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  useEffect(() => {
    const room = new Room({ adaptiveStream: true });
    let cancelled = false;
    const onSub = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current);
        setStatus('live');
      } else if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current);
        audioRef.current.play().catch(() => undefined);
      }
    };
    room.on(RoomEvent.TrackSubscribed, onSub);
    room.on(RoomEvent.Disconnected, () => !cancelled && setStatus(s => (s === 'live' ? s : 'error')));
    room.connect(url, token).catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      room.off(RoomEvent.TrackSubscribed, onSub);
      room.disconnect();
    };
  }, [url, token]);

  return (
    <div className="rv-panel" style={{ padding: 'var(--rv-3)' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 360, aspectRatio: '1 / 1', margin: '0 auto', borderRadius: 'var(--rv-r)', overflow: 'hidden', background: 'var(--rv-surface-3)' }}>
        <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <audio ref={audioRef} autoPlay />
        {status !== 'live' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--rv-ink-3)', fontSize: 13 }}>
            {status === 'connecting' ? 'Connecting to the presenter…' : 'The avatar could not connect.'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--rv-2)' }}>
        <button className="rv-btn rv-btn-ghost" onClick={onClose} aria-label="Stop video briefing">Stop video</button>
      </div>
    </div>
  );
}
