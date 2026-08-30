# fish.audio TTS for self-hosted Dograh — deploy kit

Registers **fish.audio** as a first-class TTS provider in the Dograh stack on the
Hetzner box (`/opt/dograh`, container `dograh-api-1`), so an AI Voice agent can
speak with a Fish voice — including a cloned one — on live outbound calls.

Delivered as volume-mounted patch files, same pattern as
`deploy/dograh/patches` and `deploy/dograh/transfer-duration-hotfix`. **No image
rebuild.**

## Why no rebuild is needed

`pipecat.services.fish.tts` already exists in the image — Dograh pins its own
pipecat fork and that fork ships a complete `FishAudioTTSService`. The only
thing missing is `ormsgpack`: `api/Dockerfile` installs pipecat with a fixed
extras list that stops at `smallest`, so the `[fish]` extra (which is *only*
`ormsgpack>=1.7.0`) never lands.

`msgpack==1.1.2` is already in `api/requirements.txt` and produces byte-identical
output to `ormsgpack` for every message on Fish's wire protocol. `fish_msgpack_shim.py`
registers a msgpack-backed stand-in under the name `ormsgpack` before importing
pipecat's service. If someone later rebuilds the image with `pipecat[fish]`, the
real library wins and the shim never installs.

The equivalence is asserted in `test_apply_fish_tts_patch.py` — if a future
msgpack release ever diverges, that test fails rather than the dialer.

## Files

| File | Role |
| --- | --- |
| `apply_fish_tts_patch.py` | Idempotent, dry-run-first patcher. Reads the upstream files out of the running container, applies anchored edits, `compile()`s the result, writes to the mount directory. |
| `fish_msgpack_shim.py` | The `ormsgpack` → `msgpack` shim. Mounted as a new module; nothing upstream is replaced. |
| `test_apply_fish_tts_patch.py` | Patcher, shim, and codec-equivalence tests. |
| `conftest.py` | Registers the `requires_container` marker. |

## What gets patched

Three upstream files, four edits total:

- **`api/services/configuration/registry.py`** — `ServiceProviders.FISH`, the
  base `provider` Literal, a `FishAudioTTSConfiguration` model, and the
  `TTSConfig` discriminated union. The pydantic model is what makes Fish appear
  in the AI Voice settings UI; that form is generated from this schema, so
  there is no separate frontend change.
- **`api/services/pipecat/service_factory.py`** — one `elif` branch in
  `create_tts_service`.
- **`api/services/configuration/check_validity.py`** — an API-key validator.
  **Do not skip this one.** `_check_api_key` returns `False` for any provider
  missing from `_validator_map`, so without it the UI rejects a perfectly valid
  Fish key and the config cannot be saved at all.

## Deploy (on the box)

```bash
# 1. Stage the kit
scp -r deploy/dograh/fish-tts root@178.156.223.97:/opt/dograh-patches/

# 2. Dry run — reads the live files out of the container, patches nothing
docker run --rm -v /opt/dograh-patches:/patches -v /var/run/docker.sock:/var/run/docker.sock \
  python:3.13-slim python /patches/fish-tts/apply_fish_tts_patch.py \
  --from-container dograh-api-1 --out /patches
# (or simply, if the box has python3:)
python3 /opt/dograh-patches/fish-tts/apply_fish_tts_patch.py \
  --from-container dograh-api-1 --out /opt/dograh-patches

# 3. Apply
python3 /opt/dograh-patches/fish-tts/apply_fish_tts_patch.py \
  --from-container dograh-api-1 --out /opt/dograh-patches --apply

# 4. Add the mounts to /opt/dograh/docker-compose.override.yaml
#    under services.api.volumes:
#      - /opt/dograh-patches/registry.py:/app/api/services/configuration/registry.py:ro
#      - /opt/dograh-patches/service_factory.py:/app/api/services/pipecat/service_factory.py:ro
#      - /opt/dograh-patches/check_validity.py:/app/api/services/configuration/check_validity.py:ro
#      - /opt/dograh-patches/fish_msgpack_shim.py:/app/api/services/pipecat/fish_msgpack_shim.py:ro

# 5. Restart api OUTSIDE campaign dialing hours
cd /opt/dograh && docker compose up -d api

# 6. Verify inside the container
docker exec dograh-api-1 python -c "
from api.services.configuration.registry import REGISTRY, ServiceType
print('fish registered:', 'fish' in REGISTRY[ServiceType.TTS])"
docker exec dograh-api-1 python -c "
from api.services.pipecat.fish_msgpack_shim import MSGPACK_BACKEND, FishAudioTTSService
print('codec:', MSGPACK_BACKEND, '| service:', FishAudioTTSService.__name__)"
```

**Restart caveat (same as the state-caller-ID kit):** restarting `api`
mid-campaign orphans concurrency slots and caller-ID leases. Recovery: flush
`concurrent_calls:*`, `from_number_pool:1:1`, `workflow_slot_mapping:*`,
`workflow_from_number_mapping:*`, `ari:channel:*` in dograh-redis, then wait out
the orchestrator's 300s stuck-batch timer.

## Configure the agent

In AI Voice → settings, set TTS provider to **Fish Audio**:

| Field | Value |
| --- | --- |
| `api_key` | your Fish key |
| `model` | `s2.1-pro-free` (default) |
| `voice` | Fish `reference_id` — clone one at `/voice-studio` and copy the id |
| `latency` | `balanced` |
| `speed` / `volume` | `1.0` / `0` |
| `normalize` | on |

### On `s2.1-pro-free`

`s2.1-pro-free` is the same model as `s2.1-pro` at $0, but Fish publishes **no
time-to-first-audio guarantee** on it. On a cold outbound call, a slow first
chunk is dead air in the opening two seconds — the most expensive place in the
call to have any. It is the right default for the Voice Studio and for pilot
dialing; watch TTFA before running volume on it, and flip `model` to `s2.1-pro`
if the tail is ugly. Changing the field is the whole switch; nothing else moves.

### On `latency`

The names read backwards. Per Fish's docs, `balanced` is the **faster** mode
(~300ms TTFA) and `normal` is the slower, more stable one. pipecat's own
docstring has these inverted — trust Fish. Keep `balanced` for dialing.

## Emotion and fine-grained control

Both are **inline text**, not API parameters — `[confident]`, `[break]`,
`<|phoneme_start|>EH1 N JH AH0 N IH1 R<|phoneme_end|>` travel inside whatever
the LLM emits. Two consequences:

1. Verified that Dograh's `XMLFunctionTagFilter` only strips `<function=...>`
   markup, so both syntaxes reach Fish untouched. No pipeline change needed.
2. The agent will not use them unless its prompt says to. The Voice Studio's
   **Use in agent** tab has a ready prompt block for the globalNode.

Marker syntax is model-dependent: S2 family uses `[brackets]` with free-form
descriptions; legacy S1 uses `(parentheses)` with a fixed tag set. Paralanguage
effects — `(break)`, `(breath)`, `(sigh)` — use parentheses in *both*. The
Studio renders the correct syntax for whichever model is selected.

**Worth knowing:** if the LLM emits a bracket marker while the TTS provider is
something other than Fish, that provider will read it aloud — the agent says the
word "confident". Anything that swaps TTS away from Fish should also strip the
prompt block, or add a bracket-stripping text filter for non-Fish providers.

## Rollback

1. Remove the four mounts from `docker-compose.override.yaml`, `docker compose up -d api`.
   Everything reverts; nothing upstream was modified in place.
2. Any agent still configured with `provider: fish` will 400 on
   `Invalid TTS provider` until you point it at another provider — switch the
   agent's TTS config first, then unmount.

## Keeping it working across upgrades

The patcher re-derives from whatever is in the image, so a `docker compose pull`
is followed by re-running step 3. If an upstream rename moves an anchor, the
patcher raises `PatchError` naming the anchor instead of writing a file that
mounts cleanly and then fails on every call. Re-derive the anchor from the new
source and re-run.
