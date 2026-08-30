"""Tests for the fish.audio TTS patch kit.

Runs anywhere with pytest:

    python -m pytest deploy/dograh/fish-tts/test_apply_fish_tts_patch.py

The three tests marked ``requires_container`` only do real work inside
``dograh-api-1`` (where pipecat and msgpack are installed); elsewhere they
skip. On the box:

    docker cp deploy/dograh/fish-tts/ dograh-api-1:/tmp/fish-tts
    docker exec dograh-api-1 python -m pytest /tmp/fish-tts
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # Register before exec: @dataclass resolves annotations via
    # sys.modules[cls.__module__], which blows up if the module isn't there.
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


patcher = _load("fish_patcher", HERE / "apply_fish_tts_patch.py")


# --------------------------------------------------------------------------
# Patcher
# --------------------------------------------------------------------------

REGISTRY_STUB = '''from typing import Literal

class ServiceProviders(str, Enum):
    XAI = "xai"
    LMNT = "lmnt"


class BaseServiceConfiguration(BaseModel):
    provider: Literal[
        ServiceProviders.XAI,
        ServiceProviders.LMNT,
    ]
    api_key: str | list[str]


TTSConfig = Annotated[
    Union[
        LmntTTSConfiguration,
    ],
    Field(discriminator="provider"),
]
'''

FACTORY_STUB = '''def create_tts_service(user_config, audio_config, correlation_id=None):
    if user_config.tts.provider == ServiceProviders.LMNT.value:
        return LmntTTSService()
    else:
        raise HTTPException(
            status_code=400, detail=f"Invalid TTS provider {user_config.tts.provider}"
        )
'''

VALIDITY_STUB = '''class UserConfigurationValidator:
    def __init__(self):
        self._validator_map = {
            ServiceProviders.LMNT.value: self._check_lmnt_api_key,
        }

    def _check_smallest_api_key(self, model: str, api_key: str) -> bool:
        return True
'''


@pytest.mark.parametrize(
    "stub,fn",
    [
        (REGISTRY_STUB, "patch_registry"),
        (FACTORY_STUB, "patch_factory"),
        (VALIDITY_STUB, "patch_validity"),
    ],
)
def test_patch_applies_once_and_is_idempotent(stub, fn):
    patch = getattr(patcher, fn)

    first, changed = patch(stub)
    assert changed is True
    assert patcher.MARKER in first

    second, changed_again = patch(first)
    assert changed_again is False
    assert second == first


def test_patched_output_is_valid_python():
    for stub, fn in (
        (FACTORY_STUB, "patch_factory"),
        (VALIDITY_STUB, "patch_validity"),
    ):
        patched, _ = getattr(patcher, fn)(stub)
        compile(patched, "<patched>", "exec")


def test_missing_anchor_raises_instead_of_silently_skipping():
    # An upstream rename must fail loudly, not produce a file that mounts
    # cleanly and then 400s on every Fish call.
    with pytest.raises(patcher.PatchError):
        patcher.patch_factory("def create_tts_service():\n    pass\n")


def test_factory_patch_keeps_the_invalid_provider_fallback():
    patched, _ = patcher.patch_factory(FACTORY_STUB)
    assert patched.count("Invalid TTS provider") == 1
    assert patched.rstrip().endswith(")")
    assert "ServiceProviders.FISH.value" in patched


def test_validity_patch_registers_the_validator():
    patched, _ = patcher.patch_validity(VALIDITY_STUB)
    # Without this entry _check_api_key returns False and the config cannot be
    # saved at all — the single easiest thing to forget.
    assert "ServiceProviders.FISH.value: self._check_fish_api_key" in patched
    assert "def _check_fish_api_key" in patched


# --------------------------------------------------------------------------
# msgpack shim
# --------------------------------------------------------------------------

FISH_WIRE_MESSAGES = [
    {
        "event": "start",
        "request": {
            "text": "",
            "sample_rate": 8000,
            "latency": "balanced",
            "format": "pcm",
            "normalize": True,
            "prosody": {"speed": 1.0, "volume": 0},
            "reference_id": "933563129e564b19a115bedd57b7406a",
        },
    },
    {"event": "text", "text": "Hi, this is Alex calling on a recorded line."},
    {"event": "flush"},
    {"event": "stop"},
    {"event": "audio", "audio": b"\x00\x01\x02" * 512, "time": 1.5},
    {"event": "finish", "reason": "stop"},
]


@pytest.mark.parametrize("message", FISH_WIRE_MESSAGES, ids=lambda m: m["event"])
def test_msgpack_matches_ormsgpack_on_fish_protocol(message):
    """The whole no-rebuild approach rests on these two encoders agreeing."""
    ormsgpack = pytest.importorskip("ormsgpack")
    msgpack = pytest.importorskip("msgpack")

    assert msgpack.packb(message, use_bin_type=True) == ormsgpack.packb(message)
    assert ormsgpack.unpackb(msgpack.packb(message, use_bin_type=True)) == message
    assert (
        msgpack.unpackb(ormsgpack.packb(message), raw=False, strict_map_key=False)
        == message
    )


def test_shim_installs_when_ormsgpack_is_absent(monkeypatch):
    pytest.importorskip("msgpack")

    real_import = __import__

    def blocked_import(name, *args, **kwargs):
        if name == "ormsgpack":
            raise ModuleNotFoundError("No module named 'ormsgpack'")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "ormsgpack", raising=False)
    monkeypatch.setattr("builtins.__import__", blocked_import)

    try:
        shim_module = _load("fish_shim_isolated_probe", HERE / "fish_msgpack_shim.py")
        assert shim_module.MSGPACK_BACKEND == "msgpack-shim"
    except ModuleNotFoundError as exc:
        # Outside the container pipecat isn't installed, so the module's final
        # import fails. The shim registration happens first and is what this
        # test is actually about — assert on that and move on.
        if "pipecat" not in str(exc):
            raise

    installed = sys.modules["ormsgpack"]
    assert getattr(installed, "HOPWHISTLE_FISH_SHIM", False) is True
    for message in FISH_WIRE_MESSAGES:
        assert installed.unpackb(installed.packb(message)) == message


@pytest.mark.requires_container
def test_pipecat_fish_service_imports_through_the_shim():
    """The real end-to-end check. Run inside dograh-api-1."""
    pytest.importorskip("pipecat")

    module = _load("fish_shim_real", HERE / "fish_msgpack_shim.py")
    assert module.FishAudioTTSService is not None
    assert module.FishAudioTTSSettings is not None
    # Settings must accept the fields service_factory sets.
    settings = module.FishAudioTTSSettings(
        model="s2.1-pro", voice="deadbeef", latency="balanced"
    )
    settings.prosody_speed = 1.1
    settings.prosody_volume = 0
    settings.normalize = True


@pytest.mark.requires_container
def test_patched_registry_round_trips_a_fish_config(tmp_path):
    """Validate a Fish config through the real discriminated union."""
    pytest.importorskip("pydantic")
    registry_path = Path("/app/api/services/configuration/registry.py")
    if not registry_path.is_file():
        pytest.skip("not running inside the dograh api container")

    from pydantic import TypeAdapter

    from api.services.configuration.registry import (  # type: ignore[import-not-found]
        REGISTRY,
        ServiceProviders,
        ServiceType,
        TTSConfig,
    )

    assert ServiceProviders.FISH.value == "fish"
    assert "fish" in REGISTRY[ServiceType.TTS]

    config = TypeAdapter(TTSConfig).validate_python(
        {
            "provider": "fish",
            "api_key": "test-key",
            "model": "s2.1-pro",
            "voice": "933563129e564b19a115bedd57b7406a",
        }
    )
    assert config.provider.value == "fish"
    assert config.latency == "balanced"
