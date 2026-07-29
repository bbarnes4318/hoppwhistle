import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const phonePath = resolve(
  process.argv[2] || 'apps/web/src/components/phone/phone-provider.tsx'
);

let source = readFileSync(phonePath, 'utf8');

function replaceOnce(before, after, label, marker) {
  if (source.includes(marker)) return;
  const index = source.indexOf(before);
  if (index === -1) {
    throw new Error(`Unable to apply ${label}: expected source block was not found`);
  }
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  `    const attachAndPlay = (src: MediaStream) => {
      if (src.getAudioTracks().length === 0) return;
      audioEl.srcObject = src;
      audioEl.play().catch(e => console.warn('[Phone] audio.play() blocked:', e));
    };`,
  `    const attachAndPlay = (src: MediaStream) => {
      if (src.getAudioTracks().length === 0) return;
      // Real early media or answered-call audio takes precedence over the
      // browser-generated outbound ringback tone.
      stopRingtone();
      audioEl.srcObject = src;
      audioEl.play().catch(e => console.warn('[Phone] audio.play() blocked:', e));
    };`,
  'early-media ringback handoff',
  'Real early media or answered-call audio takes precedence'
);

replaceOnce(
  `      }, 500);
    }
  }, []);

  // Keep handleCallAnswered`,
  `      }, 500);
    }
  }, [stopRingtone]);

  // Keep handleCallAnswered`,
  'remote-audio callback dependencies',
  `}, [stopRingtone]);

  // Keep handleCallAnswered`
);

replaceOnce(
  `        setCurrentCall(callInfo);
        setAgentStatusState('on-call');
        setIsPhonePanelOpen(true);

        inviter.stateChange.addListener`,
  `        setCurrentCall(callInfo);
        setAgentStatusState('on-call');
        setIsPhonePanelOpen(true);

        // Always provide audible outbound ringback. If FreeSWITCH/carrier sends
        // real early media, wireRemoteAudio stops this local tone automatically.
        console.log('[Phone] Starting local outbound ringback');
        playRingtone();

        inviter.stateChange.addListener`,
  'outbound local ringback',
  'Starting local outbound ringback'
);

// Behavior-idempotent early-media wiring. Some live source versions already call
// setupRemoteAudio(inviter) after INVITE succeeds but do not contain the original
// explanatory comment. Detect the actual call rather than relying on that comment.
const inviteEarlyMediaBehavior =
  /console\.log\('\[Phone\] INVITE sent with caller ID:', chosenCallerId\);[\s\S]{0,240}?setupRemoteAudio\(inviter\);/;

if (!inviteEarlyMediaBehavior.test(source)) {
  const inviteThenPattern = /(\.then\(\(\) => \{\s*console\.log\('\[Phone\] INVITE sent with caller ID:', chosenCallerId\);)(\s*\}\))/;
  if (!inviteThenPattern.test(source)) {
    throw new Error('Unable to apply outbound early-media wiring: INVITE success block was not found');
  }
  source = source.replace(
    inviteThenPattern,
    `$1\n            // Wire immediately so SIP 183 early media is audible before answer.\n            setupRemoteAudio(inviter);$2`
  );
}

replaceOnce(
  `    [normalizedApiUrl, getApiHeaders, isRegistered, selectedCallerId]
  );

  const answerCall`,
  `    [normalizedApiUrl, getApiHeaders, isRegistered, selectedCallerId, playRingtone]
  );

  const answerCall`,
  'outbound callback dependencies',
  'selectedCallerId, playRingtone]'
);

if (!source.includes('Sent DTMF via WebRTC RTP')) {
  const dtmfPattern = /  const sendDTMF = useCallback\(\n    \(digit: string\) => \{[\s\S]*?\n    \},\n    \[playDTMFTone\]\n  \);/;
  const replacement = `  const sendDTMF = useCallback(
    (digit: string) => {
      playDTMFTone(digit);

      const session = sessionRef.current;
      if (!session || session.state !== SessionState.Established) {
        console.warn('[Phone] DTMF ignored — no established call');
        return;
      }

      // Primary path: RFC 2833 / telephone-event over the established WebRTC
      // audio sender. FreeSWITCH translates this onto the PSTN carrier leg.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdh = session.sessionDescriptionHandler as any;
        const pc = sdh?.peerConnection as RTCPeerConnection | undefined;
        const audioSender = pc
          ?.getSenders()
          .find(sender => sender.track?.kind === 'audio' && sender.dtmf?.canInsertDTMF);

        if (audioSender?.dtmf?.canInsertDTMF) {
          audioSender.dtmf.insertDTMF(digit, 250, 70);
          console.log('[Phone] Sent DTMF via WebRTC RTP:', digit);
          return;
        }
      } catch (error) {
        console.warn('[Phone] WebRTC RTP DTMF failed; trying SIP INFO:', error);
      }

      // Fallback for endpoints where telephone-event was not negotiated.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const infoResult = (session as any).info({
          requestOptions: {
            body: {
              contentDisposition: 'render',
              contentType: 'application/dtmf-relay',
              content: \`Signal=\${digit}\\r\\nDuration=250\`,
            },
          },
        });
        void Promise.resolve(infoResult)
          .then(() => console.log('[Phone] Sent DTMF via SIP INFO fallback:', digit))
          .catch((error: unknown) =>
            console.error('[Phone] SIP INFO DTMF fallback failed:', error)
          );
      } catch (error) {
        console.error('[Phone] Unable to send DTMF:', error);
      }
    },
    [playDTMFTone]
  );`;

  if (!dtmfPattern.test(source)) {
    throw new Error('Unable to apply DTMF repair: sendDTMF block was not found');
  }
  source = source.replace(dtmfPattern, replacement);
}

const requiredChecks = [
  ['outbound ringback', source.includes('Starting local outbound ringback')],
  ['WebRTC RTP DTMF', source.includes('Sent DTMF via WebRTC RTP')],
  [
    'real-media ringback handoff',
    source.includes('Real early media or answered-call audio takes precedence'),
  ],
  ['INVITE early-media wiring', inviteEarlyMediaBehavior.test(source)],
];

for (const [label, present] of requiredChecks) {
  if (!present) {
    throw new Error(`Softphone source verification failed: ${label}`);
  }
}

writeFileSync(phonePath, source);
console.log(`Permanent softphone ringback/DTMF source patch applied: ${phonePath}`);
