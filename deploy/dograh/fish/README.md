# Fish Audio S2 Pro — Dograh TTS provider kit

Makes **Fish Audio** (`fish`) a first-class TTS provider in the self-hosted
Dograh stack on the Hetzner box (`/opt/dograh`, container `dograh-api-1`),
with S2 Pro as the default model, per-agent cloned voices, a configurable
fallback, and cost/latency accounting.

> **Read `AUDIT.md` first.** It records what is and is not knowable from this
> repository, and lists the four things that must be verified on the box
> before any of this reaches production traffic.

## Files

| File                        | Role                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `fish_config.py`            | Provider identity, defaults, field set, validation, secret masking, transport sample-rate resolution. No pipecat/Dograh imports. |
| `fish_metrics.py`           | Per-call usage: chars **and** UTF-8 bytes, chunks, audio duration from PCM bytes, TTFB/connect percentiles, cost.                |
| `fish_health.py`            | The fallback rule, the pre-audio circuit breaker, canary bucketing, `select_tts_provider()`.                                    |
| `fish_service.py`           | Builds Pipecat's `FishAudioTTSService`; adds instrumentation, bounded connect retry, TTFB watchdog, fallback delegation.         |
| `fish_provider_patch.py`    | Registers `fish` in Dograh's provider enum / config registry / defaults / service factory at runtime. `--check` first.           |
| `audit_fish_readiness.py`   | Read-only Phase-1 runtime audit, run inside `dograh-api-1`.                                                                     |
| `migrate_agents_to_fish.py` | Dry-run-first per-agent migration with backups.                                                                                |
| `rollback_fish.py`          | Restores agent configs from a migration backup.                                                                                |
| `preview_fish_voice.py`     | Browser (16 kHz) and telephone-quality (8 kHz) previews through the production code path.                                       |
| `tests/`                    | 94 tests. No network, no paid API calls.                                                                                       |

The modules import each other by bare name (`import fish_config`) because the
kit is mounted **flat** into the container.

## Configuration

Every field goes through Dograh's normal TTS configuration system. Nothing
here needs a source edit to change a voice.

| Field         | Required | Default    | Range / values                                    |
| ------------- | -------- | ---------- | ------------------------------------------------- |
| `api_key`     | yes      | —          | Fish API key. Stored as a **secret**; masked in UI, never returned by the API, never logged. |
| `model`       | yes      | `s2-pro`   | `s2-pro`, `s1`, `s1-mini`. A blank value resolves to `s2-pro`, never to an older model. |
| `voice`       | yes      | —          | Fish voice/reference ID. Per agent; falls back to the org default. |
| `latency`     | no       | `balanced` | `balanced`, `normal`                              |
| `speed`       | no       | `1.0`      | 0.5 – 2.0                                         |
| `volume`      | no       | `0`        | −20 – 20 dB                                       |
| `normalize`   | no       | `true`     | boolean                                           |
| `temperature` | no       | unset      | 0.0 – 1.0. Left unset on purpose — an aggressive default makes production speech unpredictable. |
| `top_p`       | no       | unset      | 0.0 – 1.0                                         |

Organization-level settings (Dograh's encrypted provider-key storage first;
the environment variables are the bootstrap fallback for a fresh install):

```
FISH_AUDIO_API_KEY=<secret>              # never committed, never logged
FISH_AUDIO_DEFAULT_VOICE_ID=<voice-id>   # used only when an agent has none
```

Rollout / reliability settings:

```
PRIMARY_TTS_PROVIDER=fish
FALLBACK_TTS_PROVIDER=<existing-known-good-provider>   # configurable, not pinned to Cartesia
FISH_TTS_TTFB_TIMEOUT_MS=2500        # set from measured P95, see below
FISH_TTS_MAX_CONNECT_RETRIES=1
FISH_TTS_CANARY_PERCENT=5            # 5 → 15 → 25 → 50 → 100
FISH_TTS_FAILURE_THRESHOLD=3         # consecutive pre-audio failures before the breaker opens
FISH_TTS_BREAKER_OPEN_SECONDS=60
```

### Sample rate

The output rate is always `audio_config.transport_out_sample_rate`:

- Asterisk ARI calls → 8000 Hz, requested from Fish directly (no 44.1 kHz
  generate-then-resample).
- WebRTC / browser tests → whatever that transport negotiates.

`resolve_output_sample_rate()` raises rather than guessing if the transport
rate is missing — a frame whose declared rate disagrees with its bytes is
worse than a loud failure.

## Fallback semantics

Automatic fallback happens **only while Fish has emitted no audio for the
current utterance**:

| Situation                                | Current utterance    | Later utterances       |
| ---------------------------------------- | -------------------- | ---------------------- |
| WebSocket cannot connect / auth fails     | fallback             | fallback               |
| No audio within `FISH_TTS_TTFB_TIMEOUT_MS`| fallback             | fallback               |
| Synthesis error before first audio        | fallback             | fallback               |
| **Error after partial audio**             | **abort, no replay** | fallback               |

Once any audio has reached the caller the utterance is stopped cleanly and
never re-spoken — no duplicate speech, no overlapping audio. Mid-utterance
failures deliberately do **not** trip the circuit breaker; one bad sentence
must not divert every subsequent call.

The breaker only changes which provider is **built** for a *new* call. It
never swaps a provider underneath a call that is already speaking.

### WebSocket lifecycle

One `FishAudioTTSService` per call, so one WebSocket per call. It connects on
`start()` (or first synthesis), is reused for every utterance of that call, and
is closed on `stop()`, `cancel()` and fatal error — Pipecat's own lifecycle,
which is what stops sessions and receive tasks leaking across calls or
surviving a cancelled campaign. Covered by
`test_the_same_websocket_is_reused_across_utterances_of_one_call`,
`test_stop_closes_the_websocket_and_the_receive_task` and
`test_cancel_closes_the_session_and_the_receive_task`.

## Metrics

`FishTTSUsage.to_metrics()` emits, per call: provider, model, voice (+ hashed
`voice_fingerprint`), transport type, requested sample rate, connect time,
TTFB P50/P95/P99, audio duration derived from PCM bytes, chunk count,
characters **and** UTF-8 bytes submitted, interruptions, cancellations,
reconnects, errors split by before/after first audio, fallback activations,
and the call / workflow-run / agent / campaign IDs.

Cost is `utf8_bytes / 1e6 × usd_per_million_bytes` — Fish's billing unit.
It is never derived from connected call time; connected minutes, agent-spoken
audio duration, and submitted bytes are three separate numbers in the record.

The API key never appears: `redacted()` exposes only `api_key_present` and a
12-char SHA-256 `api_key_fingerprint`.

## Deploy

```bash
# 1. Stage the kit
scp -r deploy/dograh/fish root@178.156.223.97:/opt/dograh-patches/

# 2. Audit the runtime FIRST (read-only, writes nothing)
docker exec dograh-api-1 python /patches/fish/audit_fish_readiness.py \
    --source-dump > /opt/dograh-patches/fish-audit-$(date +%F).json

# 3. Install the Fish extra INSIDE the api container image
#    (exact spec depends on the fork — the audit reports which)
#    pipecat-ai[fish]  → ormsgpack + a compatible websockets
#    Verify, do not assume:
docker exec dograh-api-1 python -c \
  "import ormsgpack, websockets; from pipecat.services.fish.tts import FishAudioTTSService; print('ok')"

# 4. Dry-run the registration; it changes nothing and prints what it found
docker exec dograh-api-1 python /patches/fish/fish_provider_patch.py --check

# 5. Mount the kit and set the provider env in
#    /opt/dograh/docker-compose.override.yaml under services.api:
#      volumes:
#        - /opt/dograh-patches/fish:/patches/fish:ro
#      environment:
#        FISH_AUDIO_API_KEY: ${FISH_AUDIO_API_KEY}
#        PRIMARY_TTS_PROVIDER: fish
#        FALLBACK_TTS_PROVIDER: <existing-provider>
#        FISH_TTS_CANARY_PERCENT: "5"

# 6. Restart the api OUTSIDE campaign dialing hours
cd /opt/dograh && docker compose up -d api
```

**Restart caveat (known, same as the state-caller-ID kit):** restarting the
api mid-campaign orphans concurrency slots and caller-ID leases. Recovery:
flush `concurrent_calls:*`, `from_number_pool:1:1`, `workflow_slot_mapping:*`,
`workflow_from_number_mapping:*`, `ari:channel:*` in dograh-redis, then wait
out the orchestrator's 300s stuck-batch timer.

## Migrate existing agents

```bash
# fish-voices.json: [{"agent_or_workflow_id": "42", "fish_voice_id": "<id>"}, ...]
docker exec dograh-api-1 python /patches/fish/migrate_agents_to_fish.py \
    --mapping /patches/fish/fish-voices.json --backup-dir /patches/backups     # dry run
docker exec dograh-api-1 python /patches/fish/migrate_agents_to_fish.py \
    --mapping /patches/fish/fish-voices.json --backup-dir /patches/backups --apply
```

An agent with no mapping entry keeps its current provider and is reported with
`NO_FISH_VOICE_MAPPING`. One Fish voice is never blanket-applied to the fleet.

## Roll back

Fleet-wide, no database writes, effective on the next call:

```bash
# /opt/dograh/docker-compose.override.yaml, services.api.environment
PRIMARY_TTS_PROVIDER=<previous-provider>
FISH_TTS_CANARY_PERCENT=0
cd /opt/dograh && docker compose up -d api
```

Per-agent, from the migration backup (voice mappings are preserved):

```bash
docker exec dograh-api-1 python /patches/fish/rollback_fish.py \
    --backup /patches/backups/fish-migration-<ts>-applied.json          # dry run
docker exec dograh-api-1 python /patches/fish/rollback_fish.py \
    --backup /patches/backups/fish-migration-<ts>-applied.json --apply
```

No database restore, no telephony rebuild, no source edit.

## Preview

```bash
FISH_AUDIO_API_KEY=... python preview_fish_voice.py \
    --voice <fish-reference-id> \
    --text "Hi, this is Sarah with the final expense benefits department." \
    --both --out-dir ./previews
```

Writes `fish-preview-telephone-8k.wav` and `fish-preview-16k.wav` through the
same `create_fish_tts_service()` the live agent uses, with the same model,
voice, speed, latency, normalization, temperature and top-p — so a preview
cannot drift from production speech.

## Tests

```bash
python -m venv .venv && .venv/bin/pip install "pipecat-ai[fish]" pytest pytest-asyncio
.venv/bin/python -m pytest deploy/dograh/fish
```

The Fish WebSocket is mocked including its `ormsgpack` framing; everything
below the mock is real Pipecat. No network, no paid API usage.

## Known limitations

1. **The Dograh source is not in this repository**, so `fish_provider_patch.py`
   registers the provider by runtime introspection rather than by tracked
   full-file patch copies. Run `--check` on the box; then convert it to
   tracked copies under `deploy/dograh/patches/` using
   `audit_fish_readiness.py --source-dump`.
2. **The fallback provider must be a yield-based TTS service.** Delegation
   consumes what `fallback.run_tts()` yields. A fallback that pushes audio
   through its own audio context (another WebSocket streaming service) will
   produce silence; validate the chosen fallback with a real call before
   relying on it.
3. `FISH_TTS_TTFB_TIMEOUT_MS` ships at 2500 ms as a placeholder. Set it from a
   measured Fish P95 on the ARI path before the canary goes above 5 %.
4. The concurrency ceiling of the Fish account is not encoded anywhere here.
   Load-test within the plan's limit before raising the canary.
