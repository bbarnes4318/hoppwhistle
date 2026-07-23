'use client';

import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';

/**
 * Renders the live Protoface avatar video by joining the LiveKit room the API
 * created. The avatar publishes a lip-synced video + audio track; we attach the
 * video to a <video> element and play the audio.
 */
export function AvatarStage({
  url,
  token,
  onClose,
}: {
  url: string;
  token: string;
  onClose: () => void;
}) {
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
    room.on(RoomEvent.Disconnected, () => {
      if (!cancelled) setStatus(s => (s === 'live' ? s : 'error'));
    });
    room.connect(url, token).catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
      room.off(RoomEvent.TrackSubscribed, onSub);
      room.disconnect();
    };
  }, [url, token]);

  return (
    <div className="ir-panel" style={{ padding: 12 }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          aspectRatio: '1 / 1',
          margin: '0 auto',
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--ir-surface-2)',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <audio ref={audioRef} autoPlay />
        {status !== 'live' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ir-text-2)',
              fontSize: 13,
            }}
          >
            {status === 'connecting'
              ? 'Connecting to the presenter…'
              : 'The avatar could not connect.'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
        <button className="ir-btn ir-btn-ghost" onClick={onClose} aria-label="Stop video briefing">
          Stop video
        </button>
      </div>
    </div>
  );
}
