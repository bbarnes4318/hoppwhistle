#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/hopwhistle"
PHONE_FILE="$ROOT/apps/web/src/components/phone/phone-provider.tsx"
DIALPLAN_FILE="$ROOT/apps/freeswitch/conf/dialplan/default.xml"
COMPOSE_DIR="$ROOT/infra/docker"
COMPOSE_FILE="docker-compose.dev.yml"
WEB_CONTAINER="hopwhistle-web-dev"
FS_CONTAINER="hopwhistle-freeswitch-dev"
STAMP="$(date +%Y%m%d-%H%M%S)"

for required in "$PHONE_FILE" "$DIALPLAN_FILE" "$COMPOSE_DIR/$COMPOSE_FILE"; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: Required file not found: $required" >&2
    exit 1
  fi
done

cp "$PHONE_FILE" "$PHONE_FILE.bak.$STAMP"
cp "$DIALPLAN_FILE" "$DIALPLAN_FILE.bak.$STAMP"

python3 - "$PHONE_FILE" "$DIALPLAN_FILE" <<'PY'
from pathlib import Path
import re
import sys

phone_path = Path(sys.argv[1])
dialplan_path = Path(sys.argv[2])
phone = phone_path.read_text()
dialplan = dialplan_path.read_text()

# 1. Stop synthetic ringback as soon as actual remote media is available.
old_attach = """    const attachAndPlay = (src: MediaStream) => {
      if (src.getAudioTracks().length === 0) return;
      audioEl.srcObject = src;
      audioEl.play().catch(e => console.warn('[Phone] audio.play() blocked:', e));
    };"""
new_attach = """    const attachAndPlay = (src: MediaStream) => {
      if (src.getAudioTracks().length === 0) return;
      // Real early media or answered-call audio takes precedence over the
      // browser-generated outbound ringback tone.
      stopRingtone();
      audioEl.srcObject = src;
      audioEl.play().catch(e => console.warn('[Phone] audio.play() blocked:', e));
    };"""
if old_attach in phone:
    phone = phone.replace(old_attach, new_attach, 1)
elif "Real early media or answered-call audio takes precedence" not in phone:
    raise SystemExit("ERROR: Could not locate remote-audio attachment block")

old_wire_end = """      }, 500);
    }
  }, []);

  // Keep handleCallAnswered"""
new_wire_end = """      }, 500);
    }
  }, [stopRingtone]);

  // Keep handleCallAnswered"""
if old_wire_end in phone:
    phone = phone.replace(old_wire_end, new_wire_end, 1)
elif "}, [stopRingtone]);\n\n  // Keep handleCallAnswered" not in phone:
    raise SystemExit("ERROR: Could not update wireRemoteAudio dependencies")

# 2. Start audible local ringback for every outbound call.
old_outbound_ui = """        setCurrentCall(callInfo);
        setAgentStatusState('on-call');
        setIsPhonePanelOpen(true);

        inviter.stateChange.addListener"""
new_outbound_ui = """        setCurrentCall(callInfo);
        setAgentStatusState('on-call');
        setIsPhonePanelOpen(true);

        // Always provide audible outbound ringback. If FreeSWITCH/carrier sends
        // real early media, wireRemoteAudio stops this local tone automatically.
        console.log('[Phone] Starting local outbound ringback');
        playRingtone();

        inviter.stateChange.addListener"""
if old_outbound_ui in phone:
    phone = phone.replace(old_outbound_ui, new_outbound_ui, 1)
elif "Starting local outbound ringback" not in phone:
    raise SystemExit("ERROR: Could not locate outbound call UI block")

# Wire the peer connection immediately after INVITE creation so 183 early media
# can be heard before the call reaches SessionState.Established.
old_invite_sent = """          .then(() => {
            console.log('[Phone] INVITE sent with caller ID:', chosenCallerId);
          })"""
new_invite_sent = """          .then(() => {
            console.log('[Phone] INVITE sent with caller ID:', chosenCallerId);
            setupRemoteAudio(inviter);
          })"""
if old_invite_sent in phone:
    phone = phone.replace(old_invite_sent, new_invite_sent, 1)
elif "setupRemoteAudio(inviter);" not in phone:
    raise SystemExit("ERROR: Could not locate outbound INVITE success block")

old_make_deps = """    [normalizedApiUrl, getApiHeaders, isRegistered, selectedCallerId]
  );

  const answerCall"""
new_make_deps = """    [normalizedApiUrl, getApiHeaders, isRegistered, selectedCallerId, playRingtone]
  );

  const answerCall"""
if old_make_deps in phone:
    phone = phone.replace(old_make_deps, new_make_deps, 1)
elif "selectedCallerId, playRingtone" not in phone:
    raise SystemExit("ERROR: Could not update makeCall dependencies")

# 3. Replace broken INFO-first DTMF behavior. The previous implementation set
# sentViaInfo=true before the asynchronous INFO request succeeded, preventing the
# RTP fallback from running. WebRTC RFC2833 is now primary; SIP INFO is fallback.
dtmf_pattern = re.compile(
    r"  const sendDTMF = useCallback\(\n"
    r"    \(digit: string\) => \{.*?\n"
    r"    \},\n"
    r"    \[playDTMFTone\]\n"
    r"  \);",
    re.S,
)
new_dtmf = """  const sendDTMF = useCallback(
    (digit: string) => {
      playDTMFTone(digit);

      const session = sessionRef.current;
      if (!session || session.state !== SessionState.Established) {
        console.warn('[Phone] DTMF ignored — no established call');
        return;
      }

      // Primary path: RFC 2833 / telephone-event over the established WebRTC
      // audio sender. This is the interoperable PSTN/IVR path and lets
      // FreeSWITCH translate the event onto the carrier leg.
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

      // Fallback path for endpoints where telephone-event was not negotiated.
      // Promise.resolve is deliberate: SIP.js info() is asynchronous, and the
      // old code incorrectly treated invocation as successful delivery.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const infoResult = (session as any).info({
          requestOptions: {
            body: {
              contentDisposition: 'render',
              contentType: 'application/dtmf-relay',
              content: `Signal=${digit}\\r\\nDuration=250`,
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
  );"""

if "Sent DTMF via WebRTC RTP" not in phone:
    phone, count = dtmf_pattern.subn(new_dtmf, phone, count=1)
    if count != 1:
        raise SystemExit(f"ERROR: Could not replace DTMF block (matches={count})")

# 4. Force the PSTN B-leg to RFC2833 so FreeSWITCH emits telephone-event to IVRs.
dtmf_dialplan_line = '        <action application="export" data="nolocal:dtmf_type=rfc2833"/>'
codec_marker = '        <action application="export" data="nolocal:absolute_codec_string=PCMU,PCMA"/>'
if dtmf_dialplan_line not in dialplan:
    if codec_marker not in dialplan:
        raise SystemExit("ERROR: Could not locate outbound PSTN codec marker")
    dialplan = dialplan.replace(
        codec_marker,
        codec_marker + "\n" + dtmf_dialplan_line,
        1,
    )

phone_path.write_text(phone)
dialplan_path.write_text(dialplan)
PY

echo "=== SOURCE PATCH VERIFICATION ==="
grep -q "Starting local outbound ringback" "$PHONE_FILE" && echo "Outbound ringback source: PRESENT"
grep -q "Sent DTMF via WebRTC RTP" "$PHONE_FILE" && echo "WebRTC RFC2833 source: PRESENT"
grep -q 'nolocal:dtmf_type=rfc2833' "$DIALPLAN_FILE" && echo "FreeSWITCH RFC2833 B-leg: PRESENT"

echo
echo "=== APPLYING FREESWITCH DIALPLAN ==="
docker cp "$DIALPLAN_FILE" "$FS_CONTAINER:/etc/freeswitch/dialplan/default.xml"
docker exec "$FS_CONTAINER" fs_cli -x 'reloadxml'

echo
echo "=== REBUILDING WEB ONLY ==="
cd "$COMPOSE_DIR"
docker compose -f "$COMPOSE_FILE" build web
docker compose -f "$COMPOSE_FILE" up -d --no-deps web
docker update --restart=unless-stopped "$WEB_CONTAINER" >/dev/null

echo
echo "=== DEPLOYMENT VERIFICATION ==="
if docker exec "$WEB_CONTAINER" sh -lc \
  'grep -Rqs "Starting local outbound ringback" /app/.next 2>/dev/null'; then
  echo "Compiled outbound ringback: PRESENT"
else
  echo "ERROR: Compiled outbound ringback marker missing" >&2
  exit 1
fi

if docker exec "$WEB_CONTAINER" sh -lc \
  'grep -Rqs "Sent DTMF via WebRTC RTP" /app/.next 2>/dev/null'; then
  echo "Compiled WebRTC RFC2833 DTMF: PRESENT"
else
  echo "ERROR: Compiled DTMF marker missing" >&2
  exit 1
fi

docker exec "$FS_CONTAINER" sh -lc \
  'grep -q "nolocal:dtmf_type=rfc2833" /etc/freeswitch/dialplan/default.xml' \
  && echo "Active FreeSWITCH RFC2833 B-leg: PRESENT"

echo
docker ps --filter "name=$WEB_CONTAINER" --filter "name=$FS_CONTAINER" \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo
echo "FIX COMPLETE"
