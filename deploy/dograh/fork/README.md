# Dograh fork — Fish Audio free-model TTS integration (source patch)

This directory delivers a **source-level integration of Fish Audio TTS into
Dograh** as one reviewable commit against a pinned upstream commit, exported
as a `git am` patch. It is a locally tested source patch. **Status, stated
plainly: nothing is deployed, no live Fish Audio API request has been made,
and no telephone call has been tested.** The exact integration commit is
also parked on this repo as branch `dograh-fork/fish-audio-free-model`
(unrelated Dograh history, ready to push into the real fork).
The verification below is unit tests, schema/codegen parity checks, and a
clean-room `git am` rehearsal — nothing more.

## Upstream identity (pinned)

| What | Value |
| --- | --- |
| Upstream repo | `https://github.com/dograh-hq/dograh` (BSD-2-Clause) |
| Base commit | `c436bf69ee8bf18d95395e1ef33b5f3d949f80ce` — `chore: update webhook documentation`, 2026-07-27 |
| Pipecat submodule | `dograh-hq/pipecat` @ `38bf23d0432e022dd9ea8f60460eea2109758750` (already ships `FishAudioTTSService`; no pipecat changes needed) |
| Integration commit | `3314eb1a18cbf5f9f8f7ad9ad971f0bef4f04623` (as produced in the session workspace; `git am` reproduces the same tree) |
| Patch | `0001-feat-tts-add-Fish-Audio-TTS-provider-locked-to-the-f.patch` (8 files; the 9th, `openapi.json`, ships as `openapi.fish.json` — see below) |
| Companion file | `openapi.fish.json` — the regenerated `docs/api-reference/openapi.json`, sha256 `27402ee0990b6a9cd25d7a4b94b5d733170e69c2c475fe1aab60825c20dbed49` |

Files changed by the commit:

```
api/Dockerfile
api/services/configuration/check_validity.py
api/services/configuration/registry.py
api/services/pipecat/service_factory.py
api/tests/test_fish_tts_service_factory.py   (new)
docs/api-reference/openapi.json
docs/configurations/voice.mdx
scripts/setup_requirements.sh
ui/src/client/types.gen.ts
```

## Free-model policy (enforced in code, not by convention)

- **`s2.1-pro-free` is the default and the only advertised model.** The JSON
  schema that drives the workflow UI's dropdown lists no paid models.
- **`ALLOW_PAID_FISH_MODELS` defaults to `false`.** Every Fish model outside
  the free list (`s2.1-pro`, `s2-pro`, `s1`, `s1-mini`, anything unknown) is
  treated as paid and is rejected in two places:
  1. at configuration save time (pydantic `field_validator` — this is the
     path every frontend save goes through, so paid models cannot be
     selected from the UI), and
  2. at service creation time in `create_tts_service` (so a config stored
     before the gate existed, or crafted outside the API, still fails with
     HTTP 400).
- **A rejected paid selection fails loudly; it never falls back** to another
  model or provider (test asserts the service constructor is never called).
- **No silent tier escalation.** There is no fallback logic anywhere in the
  path, and a test drives the *real* `FishAudioTTSService` reconnect code
  with simulated connection failures (the rate-limit / free-model-unavailable
  scenario): every reconnect attempt sends `model: s2.1-pro-free` and the
  configured model is unchanged afterward.
- Blank/missing model resolves to `s2.1-pro-free` (config and factory both).

## What was verified (unit-level only)

On the pinned commit, in a Python 3.13 venv built like CI
(`api/requirements.txt` + dev + `./pipecat[...,fish]` editable):

1. `pytest tests/test_fish_tts_service_factory.py` → **21 passed**, including:
   - `test_fish_configuration_rejects_paid_models_by_default` (×4 paid
     models, pydantic/frontend path) and
     `test_create_fish_tts_service_rejects_paid_models_by_default` (×3,
     factory path, asserts no service constructed) — **paid blocked by
     default**;
   - `test_fish_configuration_blank_model_defaults_to_free_tier` and
     `test_create_fish_tts_service_defaults_model_to_free_tier` — **blank →
     `s2.1-pro-free`**;
   - `test_fish_rate_limit_reconnects_never_switch_to_paid_model` — **rate
     limiting/unavailability never yields a paid request** (real service,
     reconnect path);
   - `test_fish_schema_advertises_only_free_model` and
     `test_fish_paid_model_allowed_only_with_explicit_env_flag` — **frontend
     cannot select paid unless `ALLOW_PAID_FISH_MODELS=true`**.
2. `pytest -k "tts or registry or configuration or check_valid or
   service_factory"` → **201 passed** (one unrelated pre-existing error in a
   test that needs the CI postgres container).
3. `python -m scripts.dump_docs_openapi` (the drift check CI runs) →
   regenerated spec matches the committed one; `openapi.fish.json` is that
   exact output (sha256 above).
4. `@hey-api/openapi-ts@0.99.0` regeneration → `FishTtsConfiguration` type
   and TTS union byte-identical to the committed `types.gen.ts` edit.
5. `ruff format --check` / import lint clean on touched files.
6. Clean-room rehearsal: `git am` of this exact patch onto `c436bf69` plus
   the `openapi.json` step produced a tree **byte-identical** to the tested
   branch.

**Not verified:** any live Fish Audio synthesis request, any telephone call,
any deployed environment, and CI on GitHub. Do not treat this as
production-ready until those happen.

## Landing it in a `bbarnes4318/dograh` fork (PowerShell, run on your machine)

These commands run under **your** GitHub authentication (`gh auth login`
opens a browser; no token is pasted into any chat). One-time setup if
needed: `winget install --id GitHub.cli` and `winget install --id Git.Git`.

Quick path — the exact integration commit `3314eb1a` is parked on this repo
as branch `dograh-fork/fish-audio-free-model`, so after creating the fork you
only push it across:

```powershell
gh auth login                                  # once; browser flow
gh repo fork dograh-hq/dograh --clone=false    # creates bbarnes4318/dograh
git clone --branch dograh-fork/fish-audio-free-model https://github.com/bbarnes4318/hoppwhistle.git dograh-fish
cd dograh-fish
git push https://github.com/bbarnes4318/dograh.git HEAD:hopwhistle/fish-audio-free-model
gh pr create --repo bbarnes4318/dograh --base main --head hopwhistle/fish-audio-free-model `
  --title "feat(tts): Fish Audio TTS provider, locked to the free S2.1 Pro tier" `
  --body "Default and only enabled model: s2.1-pro-free. Paid Fish models rejected unless ALLOW_PAID_FISH_MODELS=true (default false); no fallback, no silent tier escalation."
```

Equivalent patch-based path (no dependency on the parked branch):

```powershell
# 0. Authenticate gh once (browser flow)
gh auth login

# 1. Create the fork under your account (no clone yet)
gh repo fork dograh-hq/dograh --clone=false
#    -> creates https://github.com/bbarnes4318/dograh

# 2. Get the patch + companion spec from the hoppwhistle branch (or use the
#    copies Claude sent you as files). Assuming you cloned hoppwhistle:
cd $env:USERPROFILE\source
git clone https://github.com/bbarnes4318/hoppwhistle.git
$fork = "$env:USERPROFILE\source\hoppwhistle\deploy\dograh\fork"

# 3. Clone upstream, pin the base commit, apply the patch
git clone https://github.com/dograh-hq/dograh.git
cd dograh
git checkout -b hopwhistle/fish-audio-free-model c436bf69ee8bf18d95395e1ef33b5f3d949f80ce
git am "$fork\0001-feat-tts-add-Fish-Audio-TTS-provider-locked-to-the-f.patch"

# 4. Fold in the regenerated OpenAPI spec (no Python needed; byte-exact)
Copy-Item "$fork\openapi.fish.json" "docs\api-reference\openapi.json" -Force
git add docs/api-reference/openapi.json
git commit --amend --no-edit

# 5. Verify the spec you committed is the verified one
(Get-FileHash docs/api-reference/openapi.json -Algorithm SHA256).Hash
# expect: 27402EE0990B6A9CD25D7A4B94B5D733170E69C2C475FE1AAB60825C20DBED49

# 6. Push branch (and main) to your fork
git remote add fork https://github.com/bbarnes4318/dograh.git
git push fork main
git push -u fork hopwhistle/fish-audio-free-model

# 7. Open the PR inside your fork so CI (api tests + drift check) runs
gh pr create --repo bbarnes4318/dograh `
  --base main --head hopwhistle/fish-audio-free-model `
  --title "feat(tts): Fish Audio TTS provider, locked to the free S2.1 Pro tier" `
  --body "Source integration of Fish Audio TTS. Default and only enabled model: s2.1-pro-free. Paid Fish models are rejected unless ALLOW_PAID_FISH_MODELS=true (default false); no fallback, no silent tier escalation. See deploy/dograh/fork/README.md in hoppwhistle for the verification record."
```

Either path yields the identical tree; the quick path preserves the exact
commit SHA `3314eb1a`.

## Deploy notes (for later — NOT done, NOT verified)

Production compose runs published images
(`image: ${REGISTRY:-dograhai}/dograh-api:latest`), so deploying the fork
means building both images from fork source and pinning them in
`docker-compose.override.yaml` on the box (keep the existing bind mounts for
the state-caller-ID patches; this change touches none of those files):

```bash
git clone https://github.com/bbarnes4318/dograh.git /opt/dograh-fork
cd /opt/dograh-fork && git checkout hopwhistle/fish-audio-free-model
git submodule update --init pipecat
docker build -f api/Dockerfile -t hopwhistle/dograh-api:fish-3314eb1 .
docker build -f ui/Dockerfile  -t hopwhistle/dograh-ui:fish-3314eb1 ui
# pin services.api.image / services.ui.image in docker-compose.override.yaml,
# then restart OUTSIDE campaign dialing hours (see ../README.md restart caveat)
cd /opt/dograh && docker compose up -d api ui
```

`ALLOW_PAID_FISH_MODELS` must NOT be set in the api container environment
(absent = false = free-only). Before any campaign uses Fish: add the Fish
Audio API key in the workflow's Voice configuration (validated on save),
run a web test call and a real outbound test call — **that step is the first
live Fish/telephony verification and has not happened yet.**

## Configuration reference

| Field | Default | Notes |
| --- | --- | --- |
| `api_key` | — (required) | Fish Audio API key; validated on save |
| `model` | `s2.1-pro-free` | the only enabled model by default; paid models require `ALLOW_PAID_FISH_MODELS=true` on the API server and an explicit selection |
| `voice` | empty | Fish voice reference ID; empty = model default voice |
| `latency` | `balanced` | `balanced` or `normal` |
| `speed` | `1.0` | 0.5–2.0 |
| `volume` | `0` | −20…20 dB |
| `normalize` | `true` | stabler numbers/dates/URLs pronunciation |
| `ALLOW_PAID_FISH_MODELS` (env, api server) | `false` | opt-in gate for paid Fish models; leave unset in production |

## Rollback

- **Config-level (per workflow):** switch the workflow's Voice provider back
  in the UI; effective next call.
- **Image-level:** remove the two `image:` pins from the override file and
  `docker compose up -d api ui`. Workflows still set to `fish` will fail TTS
  creation with a 400 — flip their provider back first.
- No database migration is involved; TTS settings live in per-workflow JSON.

## Why a patch instead of a pushed fork

This session's GitHub access could not write anywhere: pushes to
`bbarnes4318/hoppwhistle` returned 403, the GitHub App was denied branch
creation and repository creation, forking `dograh-hq/dograh` was denied by
session scope, and cross-owner repo attachment is unsupported. The PowerShell
steps above are the complete, click-free path that lands the commit under
your own authentication.
