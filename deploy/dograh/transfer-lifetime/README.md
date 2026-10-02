# Dograh transferred-call lifetime fix

## Incident

On affected AI-to-agent handoffs, the Hopwhistle/FreeSWITCH leg is not the first
leg to clear. The upstream Dograh/Asterisk/FracTEL leg clears and FreeSWITCH then
propagates the disconnect to the agent. Changing the browser softphone,
FreeSWITCH bridge timeout, extension registration, inbound routing, or FracTEL
gateway failover would therefore treat the symptom and risk unrelated call paths.

Dograh 1.42.0 also has a five-minute AI pipeline duration default and its ARI
hangup strategy unconditionally deletes the original Asterisk channel. A
successfully transferred caller must no longer be owned by that AI lifecycle.
A late max-duration, transport-close, or duplicate pipeline teardown callback
must never be allowed to delete the live caller-to-agent bridge.

## Fix

This build-time source patch changes only
`api/services/telephony/providers/ari/strategies.py` inside the Dograh API image:

1. After Asterisk confirms the human destination was added to the live bridge,
   Dograh stamps `HOPWHISTLE_TRANSFER_HANDOFF_COMMITTED=<destination-channel>`
   directly on the live caller channel through ARI and persists
   `transfer_handoff_committed=true` on the workflow run for auditing.
2. Before Dograh's AI hangup strategy sends `DELETE /ari/channels/<caller>`, it
   reads that channel variable. A committed handoff is acknowledged but the
   caller channel is left alone.
3. If Dograh cannot verify ownership because the ARI read fails, it fails safely
   and refuses to delete the caller rather than risking a live human call.
4. A failed or unanswered transfer never receives the channel marker, so normal
   failure cleanup and AI hangup behavior remain unchanged.

The ownership marker is attached to the Asterisk channel itself. It has no TTL,
does not depend on Redis or database retention, and disappears automatically
when the real caller channel ends. Participant hangup is still handled by
Asterisk/ARI's existing transferred-leg teardown, so when either the prospect or
agent actually hangs up, the peer leg is cleaned up normally.

No Hopwhistle FreeSWITCH, RTP, SIP registration, caller-ID, routing, dialer,
recording, FracTEL gateway, or STIR/SHAKEN code is changed.

## Build the immutable image

Build from the exact image already running in production; do not guess a Dograh
tag.

```bash
cd /path/to/hoppwhistle
CURRENT_IMAGE=$(docker inspect dograh-api-1 --format '{{.Config.Image}}')

docker build \
  --build-arg DOGRAH_BASE_IMAGE="$CURRENT_IMAGE" \
  -t hopwhistle/dograh-api:transfer-lifetime-v1 \
  -f deploy/dograh/transfer-lifetime/Dockerfile \
  deploy/dograh/transfer-lifetime
```

The build fails closed if the reviewed Dograh source anchors are absent. It also
runs the patch verifier and Python compilation inside the image.

## Production rollout

Do not restart the Dograh API while it owns active AI calls.

```bash
cd /opt/dograh

# Pause new Dograh campaign dispatch first, then verify there are no active
# caller/external-media channels before recreating the API container.
docker ps --format '{{.Names}}' | grep -E 'dograh.*asterisk'
# Use the returned Asterisk container name below:
docker exec <asterisk-container> asterisk -rx 'core show channels count'

# In docker-compose.override.yaml, change only services.api.image:
#   image: hopwhistle/dograh-api:transfer-lifetime-v1

docker compose config >/tmp/dograh-compose.rendered.yaml
docker compose up -d --no-deps api
```

Verify the running source, without touching a call:

```bash
docker exec dograh-api-1 python \
  /opt/hopwhistle/patch_transfer_lifetime.py --root /app --check

docker exec dograh-api-1 grep -n \
  'HOPWHISTLE_TRANSFER_LIFETIME_FIX_V1\|Suppressed late AI hangup' \
  /app/api/services/telephony/providers/ari/strategies.py
```

## Required canary

Use one controlled prospect phone and one controlled Hopwhistle agent.

1. Let Dograh answer and complete a normal transfer.
2. Confirm the Dograh WebSocket/external-media channel leaves the bridge.
3. Keep the human call connected for at least 12 minutes.
4. Confirm two-way audio remains clean throughout.
5. Hang up from the prospect side and confirm the agent leg clears immediately.
6. Repeat and hang up from the agent side.
7. Confirm failed/no-answer transfers still return to the existing failure path.

During the canary, this log is expected after handoff:

```text
[ARI Transfer] Human handoff committed ... late AI hangup is disabled
```

This line should appear only if a stale AI teardown actually tries to fire:

```text
[ARI Hangup] Suppressed late AI hangup for transferred caller ...
```

Any ownership-read failure is intentionally conservative and produces:

```text
[ARI Hangup] Suppressed caller deletion because handoff ownership could not be verified ...
```

## Rollback

Change `services.api.image` back to the exact previous image and recreate only
the API service:

```bash
cd /opt/dograh
docker compose up -d --no-deps api
```

The change is source-only and adds no database migration. Existing transfer,
routing, and FreeSWITCH configuration are unchanged.
