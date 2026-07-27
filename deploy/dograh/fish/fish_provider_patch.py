"""Register ``fish`` as a first-class Dograh TTS provider at runtime.

Why a runtime installer rather than edited source files: the Hopwhistle repo
does not contain the Dograh application source (it lives at ``/opt/dograh`` on
the Hetzner box), so a tracked full-file patch copy cannot be authored until
``audit_fish_readiness.py --source-dump`` has been run there. This installer
does the same registration without needing the source, is idempotent, and
refuses to guess: anything it cannot positively identify is reported and left
alone.

Run ``--check`` on the box first. It prints exactly what it found and what it
would change, and touches nothing::

    docker exec dograh-api-1 python /patches/fish/fish_provider_patch.py --check

Then activate it for the api service by importing it at process start (see the
kit README — ``PYTHONSTARTUP`` is not honoured by uvicorn; use a ``sitecustomize``
shim or an explicit import in a mounted module).

Once the real source has been captured, prefer converting this into tracked
full-file patch copies under ``deploy/dograh/patches/`` — the same mechanism
already used for ``campaign_call_dispatcher.py`` and ``rate_limiter.py``.
"""

from __future__ import annotations

import argparse
import enum
import importlib
import inspect
import json
import os
import sys
from typing import Any, Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fish_config import (  # noqa: E402
    FISH_API_KEY_SETTING,
    FISH_CONFIG_FIELDS,
    FISH_DEFAULT_VOICE_SETTING,
    FISH_PROVIDER_DISPLAY_NAME,
    FISH_PROVIDER_ID,
    DEFAULT_FISH_LATENCY,
    DEFAULT_FISH_MODEL,
    DEFAULT_FISH_NORMALIZE,
    DEFAULT_FISH_SPEED,
    DEFAULT_FISH_VOLUME,
)

ENUM_MEMBER_NAME = "FISH"

#: Modules searched for Dograh's provider enum, in priority order.
ENUM_MODULES = (
    "api.services.configuration.registry",
    "api.services.configuration.defaults",
    "api.enums",
)

FACTORY_MODULE = "api.services.pipecat.service_factory"


class PatchReport(dict):
    """Structured, printable record of what the installer did or would do."""

    def note(self, key: str, value: Any) -> None:
        self.setdefault(key, []).append(value)


# --------------------------------------------------------------------------
# 1. Provider identifier
# --------------------------------------------------------------------------


def find_provider_enum() -> tuple[type[enum.Enum] | None, str | None]:
    """Locate the enum that holds Dograh's service-provider identifiers."""
    for module_name in ENUM_MODULES:
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        for attr in dir(module):
            obj = getattr(module, attr)
            if not (isinstance(obj, type) and issubclass(obj, enum.Enum)):
                continue
            values = {str(member.value).lower() for member in obj}
            # The provider enum is the one that already names TTS/STT/LLM
            # vendors. Requiring two hits avoids matching an unrelated enum.
            vendor_hits = values & {
                "cartesia",
                "elevenlabs",
                "deepgram",
                "openai",
                "azure",
                "groq",
                "smallest",
                "rime",
                "playht",
            }
            if len(vendor_hits) >= 2:
                return obj, f"{module_name}.{attr}"
    return None, None


def add_enum_member(enum_cls: type[enum.Enum], name: str, value: str) -> bool:
    """Add a member to an existing Enum in place. Returns True if added.

    Enums are closed by design, so this pokes the documented private maps.
    It is guarded: an existing member with the same name or value is a no-op.
    """
    if name in enum_cls.__members__:
        return False
    if any(str(member.value) == value for member in enum_cls):
        return False

    mixin = next(
        (base for base in enum_cls.__mro__ if base in (str, int) and base is not object), None
    )
    if mixin is str:
        member = str.__new__(enum_cls, value)
    elif mixin is int:  # pragma: no cover - Dograh uses str enums
        member = int.__new__(enum_cls, int(value))
    else:
        member = object.__new__(enum_cls)
    member._name_ = name
    member._value_ = value
    if hasattr(member, "__objclass__"):  # pragma: no cover
        pass
    enum_cls._member_map_[name] = member
    enum_cls._value2member_map_[value] = member
    enum_cls._member_names_.append(name)
    return True


# --------------------------------------------------------------------------
# 2. Configuration schema / defaults
# --------------------------------------------------------------------------


def fish_option_schema() -> dict:
    """Provider descriptor for Dograh's configuration registry and UI.

    ``api_key`` is marked secret so the registry stores it with the other
    encrypted provider keys, masks it in the UI and omits it from API
    responses.
    """
    return {
        "id": FISH_PROVIDER_ID,
        "name": FISH_PROVIDER_DISPLAY_NAME,
        "kind": "tts",
        "default_model": DEFAULT_FISH_MODEL,
        "models": [
            {"id": "s2-pro", "name": "S2 Pro (recommended)"},
            {"id": "s1", "name": "S1"},
            {"id": "s1-mini", "name": "S1 Mini"},
        ],
        "fields": [
            {
                "key": "api_key",
                "label": "Fish Audio API key",
                "type": "secret",
                "secret": True,
                "masked": True,
                "setting": FISH_API_KEY_SETTING,
                "required": True,
            },
            {
                "key": "model",
                "label": "Model",
                "type": "select",
                "default": DEFAULT_FISH_MODEL,
                "options": ["s2-pro", "s1", "s1-mini"],
                "required": True,
            },
            {
                "key": "voice",
                "label": "Voice / reference ID",
                "type": "string",
                "help": (
                    "Fish Audio voice model (reference) ID. Paste it from Fish "
                    "Audio. Set per agent; leave blank to use the organization "
                    f"default ({FISH_DEFAULT_VOICE_SETTING})."
                ),
                "required": True,
            },
            {
                "key": "latency",
                "label": "Latency mode",
                "type": "select",
                "options": ["balanced", "normal"],
                "default": DEFAULT_FISH_LATENCY,
            },
            {
                "key": "speed",
                "label": "Speed",
                "type": "number",
                "min": 0.5,
                "max": 2.0,
                "step": 0.05,
                "default": DEFAULT_FISH_SPEED,
            },
            {
                "key": "volume",
                "label": "Volume (dB)",
                "type": "number",
                "min": -20,
                "max": 20,
                "step": 1,
                "default": DEFAULT_FISH_VOLUME,
            },
            {
                "key": "normalize",
                "label": "Normalize text",
                "type": "boolean",
                "default": DEFAULT_FISH_NORMALIZE,
            },
            {
                "key": "temperature",
                "label": "Temperature (optional)",
                "type": "number",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": None,
            },
            {
                "key": "top_p",
                "label": "Top-p (optional)",
                "type": "number",
                "min": 0.0,
                "max": 1.0,
                "step": 0.05,
                "default": None,
            },
        ],
    }


def register_option_schema(report: PatchReport, *, apply: bool) -> None:
    """Add the Fish descriptor to whatever registry structure Dograh exposes."""
    try:
        registry = importlib.import_module("api.services.configuration.registry")
    except Exception as exc:
        report.note("skipped", f"configuration registry not importable: {exc!r}")
        return

    schema = fish_option_schema()
    installed = False
    for attr in dir(registry):
        obj = getattr(registry, attr)
        if isinstance(obj, dict) and any(
            key in ("cartesia", "elevenlabs", "deepgram") for key in map(str, obj)
        ):
            report.note("found", f"registry dict {attr} with {len(obj)} providers")
            if apply and FISH_PROVIDER_ID not in obj:
                obj[FISH_PROVIDER_ID] = schema
                installed = True
        elif isinstance(obj, list) and obj and isinstance(obj[0], dict):
            ids = {str(entry.get("id", "")).lower() for entry in obj if isinstance(entry, dict)}
            if ids & {"cartesia", "elevenlabs", "deepgram"}:
                report.note("found", f"registry list {attr} with {len(obj)} providers")
                if apply and FISH_PROVIDER_ID not in ids:
                    obj.append(schema)
                    installed = True
    if apply and not installed:
        report.note(
            "manual",
            "no provider registry container matched; add fish_option_schema() to "
            "api/services/configuration/registry.py by hand",
        )


def set_default_provider(report: PatchReport, *, apply: bool) -> None:
    """Make ``fish`` the TTS default for newly created agents/workflows."""
    try:
        defaults = importlib.import_module("api.services.configuration.defaults")
    except Exception as exc:
        report.note("skipped", f"defaults module not importable: {exc!r}")
        return

    changed = []
    for attr in dir(defaults):
        if attr.startswith("__"):
            continue
        obj = getattr(defaults, attr)
        if isinstance(obj, dict):
            tts = obj.get("tts")
            if isinstance(tts, dict) and "provider" in tts:
                report.note("found", f"defaults {attr}.tts.provider = {tts['provider']!r}")
                if apply:
                    tts["provider"] = FISH_PROVIDER_ID
                    tts.setdefault("model", DEFAULT_FISH_MODEL)
                    tts["model"] = tts.get("model") or DEFAULT_FISH_MODEL
                    changed.append(attr)
    if apply and not changed:
        report.note(
            "manual",
            "no defaults mapping with tts.provider found; set the new-agent default "
            "to 'fish' in api/services/configuration/defaults.py by hand",
        )


# --------------------------------------------------------------------------
# 3. Service factory
# --------------------------------------------------------------------------


def _provider_of(user_config: Any) -> str | None:
    tts = getattr(user_config, "tts", None)
    if tts is None and isinstance(user_config, dict):
        tts = user_config.get("tts")
    if tts is None:
        return None
    provider = getattr(tts, "provider", None)
    if provider is None and isinstance(tts, dict):
        provider = tts.get("provider")
    return str(provider).lower() if provider else None


def find_tts_factories(module: Any) -> list[str]:
    """Callables in the factory module that look like they build a TTS service."""
    names = []
    for attr, obj in vars(module).items():
        if not callable(obj) or attr.startswith("_"):
            continue
        if getattr(obj, "__module__", None) != module.__name__:
            continue
        if "tts" not in attr.lower():
            continue
        try:
            params = list(inspect.signature(obj).parameters)
        except (TypeError, ValueError):
            continue
        if any("config" in p for p in params):
            names.append(attr)
    return sorted(names)


def wrap_tts_factory(
    module: Any,
    name: str,
    *,
    builder: Callable[..., Any],
    report: PatchReport,
    apply: bool,
) -> None:
    original = getattr(module, name)
    if getattr(original, "_fish_patched", False):
        report.note("found", f"{module.__name__}.{name} already patched")
        return
    report.note("found", f"{module.__name__}.{name}{inspect.signature(original)}")
    if not apply:
        return

    is_async = inspect.iscoroutinefunction(original)

    def _maybe_fish(args, kwargs):
        user_config = kwargs.get("user_config") or (args[0] if args else None)
        audio_config = kwargs.get("audio_config") or (args[1] if len(args) > 1 else None)
        if _provider_of(user_config) != FISH_PROVIDER_ID or audio_config is None:
            return None
        return user_config, audio_config

    if is_async:

        async def wrapper(*args, **kwargs):  # type: ignore[misc]
            match = _maybe_fish(args, kwargs)
            if match is None:
                return await original(*args, **kwargs)
            return builder(*match)

    else:

        def wrapper(*args, **kwargs):
            match = _maybe_fish(args, kwargs)
            if match is None:
                return original(*args, **kwargs)
            return builder(*match)

    wrapper.__name__ = original.__name__
    wrapper.__doc__ = original.__doc__
    wrapper._fish_patched = True  # type: ignore[attr-defined]
    wrapper._fish_original = original  # type: ignore[attr-defined]
    setattr(module, name, wrapper)
    report.note("patched", f"{module.__name__}.{name}")


def _default_builder(user_config: Any, audio_config: Any) -> Any:
    from fish_service import create_fish_tts_service_from_dograh

    return create_fish_tts_service_from_dograh(
        user_config,
        audio_config,
        org_default_voice=os.environ.get(FISH_DEFAULT_VOICE_SETTING),
        org_default_api_key=os.environ.get(FISH_API_KEY_SETTING),
    )


def patch_service_factory(report: PatchReport, *, apply: bool, builder=_default_builder) -> None:
    try:
        module = importlib.import_module(FACTORY_MODULE)
    except Exception as exc:
        report.note("skipped", f"{FACTORY_MODULE} not importable: {exc!r}")
        return
    names = find_tts_factories(module)
    if not names:
        report.note("manual", f"no TTS factory callable found in {FACTORY_MODULE}")
        return
    for name in names:
        wrap_tts_factory(module, name, builder=builder, report=report, apply=apply)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def install(*, apply: bool = True) -> PatchReport:
    """Register Fish everywhere it can be registered. Idempotent."""
    report = PatchReport()
    report["provider_id"] = FISH_PROVIDER_ID
    report["display_name"] = FISH_PROVIDER_DISPLAY_NAME
    report["default_model"] = DEFAULT_FISH_MODEL
    report["config_fields"] = list(FISH_CONFIG_FIELDS)
    report["apply"] = apply

    enum_cls, enum_path = find_provider_enum()
    report["provider_enum"] = enum_path
    if enum_cls is None:
        report.note("manual", "provider enum not found; add FISH = \"fish\" by hand")
    else:
        report["provider_enum_members_before"] = {m.name: m.value for m in enum_cls}
        if apply:
            added = add_enum_member(enum_cls, ENUM_MEMBER_NAME, FISH_PROVIDER_ID)
            report.note("patched" if added else "found", f"{enum_path}.{ENUM_MEMBER_NAME}")

    register_option_schema(report, apply=apply)
    set_default_provider(report, apply=apply)
    patch_service_factory(report, apply=apply)

    try:
        importlib.import_module("pipecat.services.fish.tts")
        report["pipecat_fish_available"] = True
    except Exception as exc:
        report["pipecat_fish_available"] = False
        report.note(
            "blocking",
            f"pipecat.services.fish.tts is not importable ({exc!r}); install the "
            "fish extra (see README) before enabling the provider",
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="report only, change nothing")
    group.add_argument("--apply", action="store_true", help="perform the registration")
    args = parser.parse_args()
    report = install(apply=args.apply)
    print(json.dumps(report, indent=2, default=str))
    return 0 if not report.get("blocking") else 1


if __name__ == "__main__":
    raise SystemExit(main())
