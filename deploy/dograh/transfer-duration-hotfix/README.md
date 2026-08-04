# Dograh transferred-call five-minute drop hotfix

## Confirmed failure mechanism

Dograh's workflow configuration defaults `max_call_duration` to **300 seconds**. Its heartbeat processor calls `end_call_with_reason(CALL_DURATION_EXCEEDED, abort_immediately=True)` when that limit is crossed.

The ARI transfer flow starts a human handoff and later ends the AI pipeline with `TRANSFER_CALL`. Without a guard, the 300-second callback can race that handoff and terminate the original Asterisk customer channel. Hopwhistle then receives the upstream SIP hangup and correctly propagates it to the connected agent. The apparent Hopwhistle five-minute disconnect is therefore downstream of Dograh's AI duration timer.

This hotfix does **not** remove the normal duration limit from calls still owned by AI. It suspends that timer only while a transfer is in progress and permanently disarms it after the destination answers. A failed or timed-out transfer re-enables the timer.

## Scope

Patched Dograh source files:

- `api/services/workflow/pipecat_engine_callbacks.py`
- `api/services/workflow/pipecat_engine_custom_tools.py`

Untouched:

- Hopwhistle FreeSWITCH dialplans and Lua routing
- FracTEL gateways and failover order
- SIP profiles, codecs, RTP, recording, caller ID, STIR/SHAKEN
- agent softphone registration and browser call handling
- Dograh campaign dispatch, caller-ID rotation, concurrency, and rate limiting

## Safe deployment

Run from the Dograh host. Do not edit the files inside the running container directly; stage copies on the host and bind-mount them, matching the existing `/opt/dograh-patches` deployment pattern.

```bash
set -euo pipefail

HOTFIX_DIR=/opt/dograh-patches/transfer-duration-hotfix
mkdir -p "$HOTFIX_DIR"

# Copy the exact source revision currently running.
docker cp dograh-api-1:/app/api/services/workflow/pipecat_engine_callbacks.py \
  "$HOTFIX_DIR/pipecat_engine_callbacks.py"
docker cp dograh-api-1:/app/api/services/workflow/pipecat_engine_custom_tools.py \
  "$HOTFIX_DIR/pipecat_engine_custom_tools.py"

# Stage this repository's patcher beside those files.
cp deploy/dograh/transfer-duration-hotfix/apply_transfer_duration_hotfix.py \
  "$HOTFIX_DIR/apply_transfer_duration_hotfix.py"

# Fail-closed dry run. This must report would_change for both files.
python3 "$HOTFIX_DIR/apply_transfer_duration_hotfix.py" \
  --callbacks-file "$HOTFIX_DIR/pipecat_engine_callbacks.py" \
  --custom-tools-file "$HOTFIX_DIR/pipecat_engine_custom_tools.py"

# Apply, creating *.bak-transfer-duration backups.
python3 "$HOTFIX_DIR/apply_transfer_duration_hotfix.py" \
  --callbacks-file "$HOTFIX_DIR/pipecat_engine_callbacks.py" \
  --custom-tools-file "$HOTFIX_DIR/pipecat_engine_custom_tools.py" \
  --apply

# Idempotency check. Both must now report already_patched.
python3 "$HOTFIX_DIR/apply_transfer_duration_hotfix.py" \
  --callbacks-file "$HOTFIX_DIR/pipecat_engine_callbacks.py" \
  --custom-tools-file "$HOTFIX_DIR/pipecat_engine_custom_tools.py"
```

Add these read-only mounts under `services.api.volumes` in `/opt/dograh/docker-compose.override.yaml`:

```yaml
- /opt/dograh-patches/transfer-duration-hotfix/pipecat_engine_callbacks.py:/app/api/services/workflow/pipecat_engine_callbacks.py:ro
- /opt/dograh-patches/transfer-duration-hotfix/pipecat_engine_custom_tools.py:/app/api/services/workflow/pipecat_engine_custom_tools.py:ro
```

Validate Compose before touching the running service:

```bash
cd /opt/dograh
docker compose config >/tmp/dograh-compose-validated.yaml
```

Restart only the Dograh API service. Do not restart Asterisk, Hopwhistle, FreeSWITCH, Redis, or PostgreSQL for this patch.

```bash
cd /opt/dograh
docker compose up -d --no-deps api
```

## Verification

Confirm the mounted files are active:

```bash
docker exec dograh-api-1 grep -n \
  HOPWHISTLE_TRANSFER_DURATION_HOTFIX_V1 \
  /app/api/services/workflow/pipecat_engine_callbacks.py \
  /app/api/services/workflow/pipecat_engine_custom_tools.py
```

Then place a controlled live call:

1. Let Dograh talk long enough that the transfer completes before the five-minute total-call point.
2. Keep the human agent and customer connected beyond **six minutes total call duration**.
3. Verify no Asterisk channel leaves the transfer bridge at 300 seconds.
4. Verify Hopwhistle FreeSWITCH receives no upstream BYE at 300 seconds.
5. End the call from either human endpoint and verify normal peer teardown still occurs.

Expected Dograh log if the old timer threshold is crossed after handoff:

```text
Max call duration reached after transfer handoff started; leaving the transferred PSTN call intact
```

## Rollback

```bash
cd /opt/dograh
# Remove only the two transfer-duration-hotfix volume entries from the override.
docker compose config >/tmp/dograh-compose-rollback-validated.yaml
docker compose up -d --no-deps api
```

The original staged files are retained as:

- `pipecat_engine_callbacks.py.bak-transfer-duration`
- `pipecat_engine_custom_tools.py.bak-transfer-duration`

No database migration or data rollback is involved.
