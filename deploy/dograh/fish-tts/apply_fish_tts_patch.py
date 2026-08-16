#!/usr/bin/env python3
"""Register fish.audio as a first-class TTS provider in self-hosted Dograh.

Dry-run by default. Reads the three upstream files out of the running image
(or a directory you point it at), applies anchored edits, and writes patched
copies to an output directory that you then volume-mount back over the
originals — the same pattern as ``deploy/dograh/patches`` and
``deploy/dograh/transfer-duration-hotfix``.

Files patched
-------------
* ``api/services/configuration/registry.py``
      ``ServiceProviders.FISH``, the base ``provider`` Literal, a
      ``FishAudioTTSConfiguration`` pydantic model (which is what makes the
      provider show up in the AI Voice settings UI — that form is generated
      from this schema), and the ``TTSConfig`` discriminated union.
* ``api/services/pipecat/service_factory.py``
      the ``create_tts_service`` branch that builds the pipecat service.
* ``api/services/configuration/check_validity.py``
      an API-key validator. Without this the config CANNOT be saved:
      ``_check_api_key`` returns False for any provider missing from
      ``_validator_map``, so the UI rejects a perfectly good Fish key.

``fish_msgpack_shim.py`` (shipped alongside this script) is copied to the
output directory unchanged; it is what lets pipecat's Fish service import in
an image built without the ``pipecat[fish]`` extra.

Re-running against already-patched sources is a no-op.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

MARKER = "HOPWHISTLE_FISH_TTS_V1"

REGISTRY_REL = "api/services/configuration/registry.py"
FACTORY_REL = "api/services/pipecat/service_factory.py"
VALIDITY_REL = "api/services/configuration/check_validity.py"
SHIM_NAME = "fish_msgpack_shim.py"


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class PatchResult:
    path: Path
    changed: bool


# --------------------------------------------------------------------------
# registry.py
# --------------------------------------------------------------------------

ENUM_OLD = '''    XAI = "xai"
    LMNT = "lmnt"
'''

ENUM_NEW = f'''    XAI = "xai"
    LMNT = "lmnt"
    FISH = "fish"  # {MARKER}
'''

BASE_LITERAL_OLD = """        ServiceProviders.XAI,
        ServiceProviders.LMNT,
    ]
    api_key: str | list[str]
"""

BASE_LITERAL_NEW = f"""        ServiceProviders.XAI,
        ServiceProviders.LMNT,
        ServiceProviders.FISH,  # {MARKER}
    ]
    api_key: str | list[str]
"""

CONFIG_ANCHOR = "TTSConfig = Annotated[\n"

CONFIG_CLASS = f'''# --- {MARKER} : fish.audio TTS ------------------------------------
# `voice` is Fish's reference_id: the 32-char hex id of a voice model. Clone one
# in the Hopwhistle Voice Studio (/voice-studio) and paste the id here, or take
# it from a model URL on fish.audio.
#
# Emotion cues ([happy], [whispering], [break]) and fine-grained control
# (<|phoneme_start|>...<|phoneme_end|>) are INLINE TEXT, not parameters — they
# travel in whatever the LLM emits. Verified that Dograh's XMLFunctionTagFilter
# only strips `<function=...>` markup, so both marker syntaxes reach Fish
# untouched. Teach the agent to emit them via its globalNode prompt.
FISH_TTS_MODELS = ("s2.1-pro-free", "s2.1-pro", "s2-pro", "s1")
FISH_TTS_LATENCY_MODES = ("balanced", "normal")

FISH_PROVIDER_MODEL_CONFIG = provider_model_config(
    "Fish Audio",
    description="Fish Audio streaming TTS with instant and pro voice cloning.",
    provider_docs_url="https://docs.fish.audio",
)


@register_tts
class FishAudioTTSConfiguration(BaseTTSConfiguration):
    model_config = FISH_PROVIDER_MODEL_CONFIG
    provider: Literal[ServiceProviders.FISH] = ServiceProviders.FISH
    model: str = Field(
        default="s2.1-pro-free",
        description=(
            "Fish Audio TTS model. s2.1-pro-free is the same model as s2.1-pro at "
            "$0, but WITHOUT a time-to-first-audio guarantee — fine for the Voice "
            "Studio and pilot dialing, a real risk of dead air on production "
            "outbound. Switch to s2.1-pro when you go to volume."
        ),
        json_schema_extra={{
            "examples": list(FISH_TTS_MODELS),
            "allow_custom_input": True,
        }},
    )
    voice: str = Field(
        default="",
        description=(
            "Fish Audio reference_id — the 32-char hex voice-model id from the Fish "
            "voice library or one of your own cloned voices. Empty uses Fish's "
            "default voice."
        ),
        json_schema_extra={{"allow_custom_input": True}},
    )
    latency: str = Field(
        default="balanced",
        description=(
            "Fish streaming latency mode. 'balanced' (Fish's default) is the LOWER "
            "latency option at ~300ms time-to-first-audio — keep it for dialing. "
            "'normal' is more stable but slower, for narration. Note this reads "
            "backwards from the names; it matches Fish's docs, not pipecat's "
            "docstring, which has them inverted."
        ),
        json_schema_extra={{
            "examples": list(FISH_TTS_LATENCY_MODES),
            "allow_custom_input": True,
        }},
    )
    speed: float = Field(
        default=1.0,
        ge=0.5,
        le=2.0,
        description="Speech speed multiplier (0.5 to 2.0).",
    )
    volume: int = Field(
        default=0,
        ge=-20,
        le=20,
        description="Volume adjustment in dB (-20 to 20).",
    )
    normalize: bool = Field(
        default=True,
        description=(
            "Let Fish normalize numbers, dates and currency before synthesis. "
            "Leave this ON: phoneme tags survive normalization, and turning it "
            "off makes Fish read prices, dates and phone numbers unreliably — "
            "which is most of what an insurance agent says."
        ),
    )


# --- end {MARKER} ------------------------------------------------


'''

UNION_OLD = """        LmntTTSConfiguration,
    ],
    Field(discriminator="provider"),
]
"""

UNION_NEW = f"""        LmntTTSConfiguration,
        FishAudioTTSConfiguration,  # {MARKER}
    ],
    Field(discriminator="provider"),
]
"""


# --------------------------------------------------------------------------
# service_factory.py
# --------------------------------------------------------------------------

FACTORY_OLD = '''    else:
        raise HTTPException(
            status_code=400, detail=f"Invalid TTS provider {user_config.tts.provider}"
        )
'''

FACTORY_NEW = f'''    elif user_config.tts.provider == ServiceProviders.FISH.value:
        # {MARKER}
        # Imported lazily and from our own shim module: pipecat's Fish service
        # needs an ormsgpack codec that the stock image does not ship, and a
        # lazy import keeps any problem with it contained to Fish configs
        # instead of breaking the whole factory at import time.
        from api.services.pipecat.fish_msgpack_shim import (
            FishAudioTTSService,
            FishAudioTTSSettings,
        )

        # Empty string -> None so Fish falls back to its default voice rather
        # than rejecting a blank reference_id.
        voice = getattr(user_config.tts, "voice", None) or None
        model = getattr(user_config.tts, "model", None) or "s2.1-pro"
        latency = getattr(user_config.tts, "latency", None) or "balanced"
        speed = getattr(user_config.tts, "speed", None)
        volume = getattr(user_config.tts, "volume", None)
        normalize = getattr(user_config.tts, "normalize", None)

        fish_settings = FishAudioTTSSettings(
            model=model,
            voice=voice,
            latency=latency,
        )
        if speed is not None:
            fish_settings.prosody_speed = speed
        if volume is not None:
            fish_settings.prosody_volume = volume
        if normalize is not None:
            fish_settings.normalize = normalize

        return FishAudioTTSService(
            api_key=user_config.tts.api_key,
            # Fish emits raw PCM at whatever rate we ask for. Matching the
            # transport (8 kHz on ARI/FracTEL) skips a resample hop in
            # BaseOutputTransport; a mismatch still works, just costs latency.
            sample_rate=audio_config.transport_out_sample_rate,
            output_format="pcm",
            settings=fish_settings,
            text_filters=[xml_function_tag_filter],
            skip_aggregator_types=["recording_router", "recording"],
            silence_time_s=1.0,
        )
    else:
        raise HTTPException(
            status_code=400, detail=f"Invalid TTS provider {{user_config.tts.provider}}"
        )
'''


# --------------------------------------------------------------------------
# check_validity.py
# --------------------------------------------------------------------------

VALIDATOR_MAP_OLD = """            ServiceProviders.LMNT.value: self._check_lmnt_api_key,
        }
"""

VALIDATOR_MAP_NEW = f"""            ServiceProviders.LMNT.value: self._check_lmnt_api_key,
            ServiceProviders.FISH.value: self._check_fish_api_key,  # {MARKER}
        }}
"""

VALIDATOR_FN_OLD = """    def _check_smallest_api_key(self, model: str, api_key: str) -> bool:
        return True
"""

VALIDATOR_FN_NEW = f'''    def _check_smallest_api_key(self, model: str, api_key: str) -> bool:
        return True

    def _check_fish_api_key(self, model: str, api_key: str) -> bool:
        # {MARKER}
        # /wallet/self/api-credit is account-scoped, so a bad key is rejected
        # outright. Anything that is NOT an explicit auth failure counts as
        # valid: a moved endpoint or a Fish outage must never stop someone
        # from saving a working configuration.
        try:
            response = httpx.get(
                "https://api.fish.audio/wallet/self/api-credit",
                headers={{"Authorization": f"Bearer {{api_key}}"}},
                timeout=10.0,
            )
        except httpx.HTTPError:
            return True

        if response.status_code in (401, 403):
            raise ValueError(
                "Invalid Fish Audio API key. The key was rejected by fish.audio. "
                "Check it at https://fish.audio/app/api-keys."
            )
        return True
'''


# --------------------------------------------------------------------------
# patch machinery
# --------------------------------------------------------------------------


def replace_exact(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(
            f"{label}: expected exactly 1 match for the anchor, found {count}. "
            "Upstream Dograh has moved — re-derive the anchor before deploying."
        )
    return text.replace(old, new, 1)


def insert_before(text: str, anchor: str, block: str, label: str) -> str:
    count = text.count(anchor)
    if count != 1:
        raise PatchError(
            f"{label}: expected exactly 1 match for the anchor, found {count}. "
            "Upstream Dograh has moved — re-derive the anchor before deploying."
        )
    return text.replace(anchor, block + anchor, 1)


def patch_registry(text: str) -> tuple[str, bool]:
    if MARKER in text:
        return text, False
    text = replace_exact(text, ENUM_OLD, ENUM_NEW, "registry.ServiceProviders")
    text = replace_exact(
        text, BASE_LITERAL_OLD, BASE_LITERAL_NEW, "registry.BaseServiceConfiguration"
    )
    text = insert_before(
        text, CONFIG_ANCHOR, CONFIG_CLASS, "registry.FishAudioTTSConfiguration"
    )
    text = replace_exact(text, UNION_OLD, UNION_NEW, "registry.TTSConfig")
    return text, True


def patch_factory(text: str) -> tuple[str, bool]:
    if MARKER in text:
        return text, False
    text = replace_exact(
        text, FACTORY_OLD, FACTORY_NEW, "service_factory.create_tts_service"
    )
    return text, True


def patch_validity(text: str) -> tuple[str, bool]:
    if MARKER in text:
        return text, False
    text = replace_exact(
        text, VALIDATOR_MAP_OLD, VALIDATOR_MAP_NEW, "check_validity._validator_map"
    )
    text = replace_exact(
        text, VALIDATOR_FN_OLD, VALIDATOR_FN_NEW, "check_validity._check_fish_api_key"
    )
    return text, True


PATCHERS = {
    REGISTRY_REL: patch_registry,
    FACTORY_REL: patch_factory,
    VALIDITY_REL: patch_validity,
}


def extract_from_container(container: str, workdir: Path) -> Path:
    """docker cp the three upstream files out of a running container."""
    src = workdir / "upstream"
    for rel in PATCHERS:
        dest = src / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        cmd = ["docker", "cp", f"{container}:/app/{rel}", str(dest)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise PatchError(
                f"docker cp failed for {rel}: {result.stderr.strip() or result.stdout.strip()}"
            )
    return src


def process(src: Path, out: Path, apply: bool) -> list[PatchResult]:
    results: list[PatchResult] = []

    for rel, patcher in PATCHERS.items():
        source_file = src / rel
        if not source_file.is_file():
            raise PatchError(f"missing source file: {source_file}")

        original = source_file.read_text()
        patched, changed = patcher(original)

        # Fail loudly on syntax damage before anything is mounted into a
        # container that places live calls.
        compile(patched, str(source_file), "exec")

        target = out / Path(rel).name
        if apply:
            out.mkdir(parents=True, exist_ok=True)
            if target.exists():
                backup = target.with_suffix(target.suffix + ".bak-fish-tts")
                if not backup.exists():
                    shutil.copy2(target, backup)
            target.write_text(patched)
        results.append(PatchResult(path=target, changed=changed))

    shim_src = Path(__file__).resolve().parent / SHIM_NAME
    if not shim_src.is_file():
        raise PatchError(f"missing {SHIM_NAME} next to this script")
    shim_target = out / SHIM_NAME
    if apply:
        out.mkdir(parents=True, exist_ok=True)
        shutil.copy2(shim_src, shim_target)
    results.append(
        PatchResult(
            path=shim_target,
            changed=not shim_target.exists()
            or shim_target.read_text() != shim_src.read_text(),
        )
    )

    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--src",
        type=Path,
        help="directory containing the upstream Dograh api/ tree",
    )
    source.add_argument(
        "--from-container",
        metavar="NAME",
        help="docker cp the upstream files out of this container (e.g. dograh-api-1)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("/opt/dograh-patches"),
        help="where the patched files are written (default: /opt/dograh-patches)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually write files (default is a dry run)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        if args.from_container:
            workdir = args.out / ".fish-tts-extract"
            workdir.mkdir(parents=True, exist_ok=True)
            src = extract_from_container(args.from_container, workdir)
        else:
            src = args.src

        results = process(src, args.out, args.apply)
    except PatchError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except SyntaxError as exc:
        print(f"error: patched output does not compile: {exc}", file=sys.stderr)
        return 1

    mode = "wrote" if args.apply else "would write"
    for result in results:
        state = "patched" if result.changed else "already patched / unchanged"
        print(f"{mode} {result.path}  [{state}]")

    if not args.apply:
        print("\ndry run — re-run with --apply to write the files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
