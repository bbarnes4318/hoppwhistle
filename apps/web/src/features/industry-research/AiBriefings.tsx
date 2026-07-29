'use client';

import type { StructuredReport } from '@hopwhistle/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { researchApi } from './api';
import { AvatarStage } from './AvatarStage';
import { BRIEFING_MODES, buildBriefingScript, type BriefingMode } from './ui/report-story';

type AudioState = 'idle' | 'preparing' | 'playing';
type AvatarState =
  | { state: 'idle' | 'loading' | 'disabled' | 'error'; reason?: string }
  | { state: 'live'; url: string; token: string };

/**
 * AI Briefings — turns the report into short, confident spoken briefings (four
 * modes) generated from the real report data. Plays as in-browser audio with a
 * transcript. A live avatar-video mode connects to Protoface when the operator
 * has configured it (gated behind PROTOFACE_API_KEY); until then the audio +
 * transcript experience is fully functional and honestly labelled.
 */
export function AiBriefings({ report, runId }: { report: StructuredReport; runId: string }) {
  const [mode, setMode] = useState<BriefingMode>('executive');
  const [audio, setAudio] = useState<AudioState>('idle');
  const [showTranscript, setShowTranscript] = useState(true);
  const [avatar, setAvatar] = useState<AvatarState>({ state: 'idle' });
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const script = useMemo(() => buildBriefingScript(report, mode), [report, mode]);
  const modeMeta = BRIEFING_MODES.find(m => m.id === mode)!;

  // Stop any speech when the mode changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (ttsSupported) window.speechSynthesis.cancel();
    };
  }, [ttsSupported]);
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
    u.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(
        vc => /en-US/i.test(vc.lang) && /natural|neural|samantha|google/i.test(vc.name)
      ) ?? voices.find(vc => /en/i.test(vc.lang));
    if (preferred) u.voice = preferred;
    u.onstart = () => setAudio('playing');
    u.onend = () => setAudio('idle');
    u.onerror = () => setAudio('idle');
    utterRef.current = u;
    // slight delay so the "preparing" state is perceptible and voices are loaded
    setTimeout(() => window.speechSynthesis.speak(u), 120);
  };
  const stop = () => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setAudio('idle');
  };

  const loadAvatar = async () => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setAudio('idle');
    setAvatar({ state: 'loading' });
    try {
      const res = await researchApi.avatarSession(runId, mode, script);
      if (!res.enabled || !res.url || !res.token) {
        setAvatar({ state: 'disabled', reason: res.reason });
      } else {
        setAvatar({ state: 'live', url: res.url, token: res.token });
      }
    } catch (e) {
      setAvatar({ state: 'error', reason: String((e as Error)?.message ?? e) });
    }
  };

  const copy = () => navigator.clipboard?.writeText(script).catch(() => undefined);

  return (
    <div>
      {/* Mode selector */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          marginBottom: 14,
        }}
      >
        {BRIEFING_MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 5,
              cursor: 'pointer',
              border: `1px solid ${mode === m.id ? 'var(--ir-accent)' : 'var(--ir-border)'}`,
              background:
                mode === m.id
                  ? 'color-mix(in srgb, var(--ir-accent) 8%, transparent)'
                  : 'var(--ir-surface)',
              color: 'var(--ir-text)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
            <div className="ir-muted" style={{ fontSize: 11, marginTop: 2 }}>
              {m.blurb}
            </div>
          </button>
        ))}
      </div>

      {/* Player */}
      <div className="ir-panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 600 }}>{modeMeta.label}</div>
            <div className="ir-muted" style={{ fontSize: 12 }}>
              {audio === 'preparing'
                ? 'Preparing briefing…'
                : audio === 'playing'
                  ? 'Playing audio briefing…'
                  : `${Math.max(1, Math.round(script.split(/\s+/).length / 2.6))}s spoken briefing`}
            </div>
          </div>
          {ttsSupported ? (
            audio === 'idle' ? (
              <button className="ir-btn ir-btn-primary" onClick={play}>
                ▶ Play audio briefing
              </button>
            ) : (
              <>
                <button className="ir-btn" onClick={stop}>
                  ■ Stop
                </button>
                <button
                  className="ir-btn ir-btn-ghost"
                  onClick={play}
                  disabled={audio === 'preparing'}
                >
                  ↻ Replay
                </button>
              </>
            )
          ) : (
            <span className="ir-muted" style={{ fontSize: 12 }}>
              Audio playback isn’t supported in this browser — read the transcript below.
            </span>
          )}
          <button className="ir-btn ir-btn-ghost" onClick={copy} aria-label="Copy transcript">
            Copy
          </button>
          <button
            className="ir-btn ir-btn-ghost"
            onClick={() => setShowTranscript(s => !s)}
            aria-expanded={showTranscript}
          >
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
        </div>

        {audio === 'preparing' && (
          <div
            style={{
              height: 3,
              marginTop: 12,
              borderRadius: 2,
              background: 'var(--ir-border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: 'var(--ir-accent)',
                animation: 'ir-indet 1s linear infinite',
              }}
            />
          </div>
        )}

        {showTranscript && (
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, color: 'var(--ir-text)' }}>
            {script}
          </p>
        )}
      </div>

      {/* Live avatar video */}
      <div style={{ marginTop: 12 }}>
        {avatar.state === 'idle' && (
          <button className="ir-btn" onClick={loadAvatar}>
            ◉ Play video avatar briefing
          </button>
        )}
        {avatar.state === 'loading' && (
          <span className="ir-muted" style={{ fontSize: 13 }}>
            Starting the presenter…
          </span>
        )}
        {avatar.state === 'live' && (
          <AvatarStage
            url={avatar.url}
            token={avatar.token}
            onClose={() => setAvatar({ state: 'idle' })}
          />
        )}
        {avatar.state === 'disabled' && (
          <div className="ir-panel" style={{ padding: 12, borderStyle: 'dashed' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Video avatar not yet enabled</div>
            <p className="ir-muted" style={{ fontSize: 12, marginTop: 3 }}>
              {avatar.reason ?? 'The Protoface avatar isn’t configured on this environment.'} The
              audio briefing and transcript above are fully functional.
            </p>
          </div>
        )}
        {avatar.state === 'error' && (
          <div className="ir-panel" style={{ padding: 12, borderColor: 'var(--ir-negative)' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }} className="ir-neg">
              Couldn’t start the video briefing
            </div>
            {avatar.reason && (
              <p className="ir-muted" style={{ fontSize: 12, marginTop: 3 }}>
                {avatar.reason}
              </p>
            )}
            <button className="ir-btn ir-btn-ghost" style={{ marginTop: 6 }} onClick={loadAvatar}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
