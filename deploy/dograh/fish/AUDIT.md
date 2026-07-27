# Fish Audio integration — Phase 1 audit

Grounded in the Hopwhistle repository at branch
`claude/fish-audio-s2-integration-0v02es` (base `d783299`), the published
`pipecat-ai` distribution, and the existing `deploy/dograh/` deploy kit.

## Scope limit — read this first

**This session had no access to the production runtime.** Specifically:

| Resource                    | Status                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `/opt/dograh` (Hetzner)     | Not reachable. No SSH keys, no credentials in the environment.           |
| Docker daemon / `dograh-api-1` | Not available (`/var/run/docker.sock` absent).                       |
| Dograh application source   | **Not in this repository.** Confirmed by `docs/saas/VOICE_AI_INTEGRATION_AUDIT.md` and by a full-tree search: no `.gitmodules`, no `dograh/**`, no `api/services/pipecat/**`, no compose build context. |
| Dograh upstream repo        | Not fetchable — GitHub access in this session is scoped to `bbarnes4318/hoppwhistle`; `dograh` is not published on PyPI or npm either. |
| Fish Audio API key          | Not present in the environment.                                          |
| Asterisk ARI / test DIDs    | Not reachable.                                                           |

Everything below marked **VERIFIED** was established from real artefacts in
this session. Everything marked **MUST VERIFY ON THE BOX** is a question the
shipped `audit_fish_readiness.py` is built to answer in one read-only command.

## 1. Dograh version / commit / image

**MUST VERIFY ON THE BOX.**

```bash
docker exec dograh-api-1 python /patches/fish/audit_fish_readiness.py --source-dump
```

Reports the app root, whether it is a git checkout (commit, branch, remote,
dirty files), any `pyproject.toml`/`VERSION`, and — importantly — every
**bind mount** under the app root, read from `/proc/self/mountinfo`. That last
one is the answer to "which source files survive a container rebuild": a path
that appears there is a host mount, and unless it is also tracked in this
repository it is an untracked server-only change.

What the repository *does* establish (**VERIFIED**): the existing deploy
mechanism for Dograh changes is **bind-mounted full-file copies** tracked in
`deploy/dograh/patches/` (`campaign_call_dispatcher.py`, `rate_limiter.py`)
plus standalone scripts run with `docker exec`, mounted from
`/opt/dograh-patches` via `services.api.volumes` in
`/opt/dograh/docker-compose.override.yaml`. The Fish kit follows exactly that
pattern.

## 2. Pipecat fork and commit; does `pipecat.services.fish.tts` exist?

**MUST VERIFY ON THE BOX** for the fork. **VERIFIED** for upstream:

`pipecat-ai` **1.6.0** ships `pipecat/services/fish/tts.py` with
`FishAudioTTSService` and `FishAudioTTSSettings`. It was installed and exercised
in this session. Its contract:

```python
FishAudioTTSService(
    *, api_key: str,
    reference_id: str | None = None,   # deprecated → settings.voice
    model_id: str | None = None,       # deprecated → settings.model
    output_format: Literal["opus","mp3","pcm","wav"] = "pcm",
    sample_rate: int | None = None,
    params: InputParams | None = None, # deprecated
    settings: FishAudioTTSSettings | None = None,
    **kwargs,
)
```

Confirmed properties, all exercised by the test suite:

- Endpoint `wss://api.fish.audio/v1/tts/live`, `ormsgpack` framing,
  `Authorization: Bearer`, model passed as a **header**.
- Upstream defaults are already `model="s2-pro"`, `latency="balanced"`,
  `normalize=True`, `prosody_speed=1.0`, `prosody_volume=0`.
- Settings are **delta-merged**: fields default to a `NOT_GIVEN` sentinel and
  `apply_update()` skips them. Passing `None` for an unconfigured field would
  clobber a good default — hence `FishTTSConfig.settings_kwargs()` is sparse.
- `temperature` / `top_p` are only sent when not `None`.
- `InterruptibleTTSService` subclass, persistent WebSocket per service
  instance, `_receive_task` cancelled on disconnect, audio delivered through
  audio contexts, `on_audio_context_interrupted` hook available.
- `TTSService.__init__` in 1.6.0 **does** accept `text_filters`,
  `skip_aggregator_types` and `silence_time_s` — i.e. the constructor shape in
  the task description matches upstream 1.6.0.
- Extra deps required: `ormsgpack`, `websockets` (16.1.1 used here).

Because the Dograh fork may differ, `create_fish_tts_service()` filters
optional kwargs against the *installed* constructor chain and drops unknown
ones with a warning rather than exploding.

## 3. Where Dograh stores TTS configuration

**MUST VERIFY ON THE BOX.** `audit_fish_readiness.py` enumerates every
`public` column whose name matches `%tts%`, `%voice%`, `%provider%`,
`%api_key%`, `%config%`, then counts the configured TTS provider per JSON
config column — giving both the storage location and the current per-workflow
provider distribution without printing a single secret value.

## 4. Hardcoded provider references

**VERIFIED — in this repository: none.** A case-insensitive search for
`cartesia` across the whole tree returns only `CartesianGrid` (a Recharts
component) in four dashboard files. There is no Cartesia code, endpoint,
button, or branding string in Hopwhistle.

The provider names that *do* appear in Hopwhistle are `11labs` and `deepgram`,
in the **legacy Vapi** surfaces:

| Surface                                              | Status                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/src/routes/music-console-voice.ts`          | Legacy Vapi. `VOICE_OPTIONS` hardcodes 11labs/deepgram voices.         |
| `apps/web/src/app/music-console/voice/page.tsx`       | Legacy Vapi UI.                                                        |
| `apps/api/src/routes/bot.ts` (`/api/bot/tts/preview`) | Legacy Deepgram preview endpoint (`aura-asteria-en`).                  |
| `apps/web/src/app/(dashboard)/ai-campaigns/**`        | Legacy Vapi campaign flow — wired but orphaned from the sidebar.       |

Per `docs/saas/VOICE_AI_INTEGRATION_AUDIT.md` these are **legacy and dormant**;
the canonical voice-agent UI is Dograh's own, reached by SSO iframe at
`/voice-agents`. They were therefore **left untouched** — the task explicitly
says not to replace strings blindly, and rewriting a dormant Vapi screen to say
"Fish Audio" would be a cosmetic change to a surface that does not drive calls.

**Consequence for Phase 7:** the user-facing Fish provider UI is *Dograh's*
`ServiceConfigurationForm.tsx`, which is out of repo. `fish_option_schema()` in
`fish_provider_patch.py` is the descriptor that drives it (field types,
`secret: true` + `masked: true` on the API key, `s2-pro` default, required
voice, no hardcoded voice ID).

## 5. Current production TTS provider and fallback behaviour

**MUST VERIFY ON THE BOX** — reported by the audit script's
`tts_provider_counts`. The business framing (Cartesia is the incumbent and is
too expensive) is taken as given; it could not be confirmed from any artefact
available here.

## 6. Are production changes tracked in Git?

**VERIFIED, partially.** `deploy/dograh/` tracks `campaign_call_dispatcher.py`,
`rate_limiter.py`, `areacode_state.py` and the importer scripts, and its README
documents mounting them from `/opt/dograh-patches`. Whether the box currently
carries *additional* untracked mounts is exactly what the audit script's
`bind_mount_candidates` answers. This kit adds no untracked server-only change:
every file it deploys is in this branch.

## What still has to happen on the box

These are the deliverables from the task that this session could not produce,
in the order they should be done:

1. **Runtime audit** — `audit_fish_readiness.py --source-dump`. Answers §1, §2
   (fork), §3, §5, §6 and captures the source needed to convert the runtime
   patch into tracked full-file copies.
2. **Fish extra installed in the api image** and verified importable.
3. **`fish_provider_patch.py --check`**, then `--apply` wired into api start-up.
4. **Real integration test** against Fish with a test key and test voice —
   auth, S2 Pro selection, first audio, multi-utterance session, flush,
   interruption, clean teardown, no leftover receive task.
5. **Telephone tests** over the real ARI path — the 14 scripted cases
   (greeting, yes/no question, multi-clause question, name, phone number, ZIP,
   date, dollar amount, final-expense sentence, transfer statement, single
   interruption, two consecutive interruptions, long response, induced provider
   failure), recording both Fish's output and the audio that reaches the
   handset. The handset recording is the authoritative quality test.
6. **Voice-quality comparison harness** — same text, same telephone path, Fish
   S2 Pro vs the incumbent vs the fallback.
7. **Concurrency tests** at 5 / 15 / 25 / 50 concurrent calls, within the Fish
   plan's limit, measuring connect success rate, TTFB P50/P95/P99, error rate,
   reconnects, gaps, throttling and recovery. Set
   `FISH_TTS_TTFB_TIMEOUT_MS` from the measured P95.
8. **Staged rollout** 5 % → 15 % → 25 % → 50 % → 100 % via
   `FISH_TTS_CANARY_PERCENT`, advancing only when TTS errors and P95 first-audio
   latency are no worse than the incumbent.
9. **Rollback rehearsal** before the canary goes past 5 %.
