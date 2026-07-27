"""Fish Audio TTS provider configuration for Dograh.

Pure-python (no pipecat / no Dograh imports) so it can be unit-tested anywhere
and imported by the audit/migration scripts that run with a bare interpreter.

Everything the deployed Dograh needs to know about the ``fish`` provider —
the identifier, the display name, the field set, the defaults, the validation
rules and the mapping onto Pipecat's ``FishAudioTTSSettings`` — lives here so
there is exactly one source of truth for the whole kit.

Secrets: ``FishTTSConfig.api_key`` is the only secret. It is excluded from
``__repr__``, from ``redacted()`` and from every log/metric helper. Use
``fingerprint()`` when a support ticket needs to identify *which* key is in
use without revealing it.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Mapping

# --------------------------------------------------------------------------
# Provider identity
# --------------------------------------------------------------------------

FISH_PROVIDER_ID = "fish"
"""Value stored in Dograh's TTS provider column / ``ServiceProviders.FISH``."""

FISH_PROVIDER_DISPLAY_NAME = "Fish Audio"
"""Human-readable name shown in the Dograh provider UI."""

# --------------------------------------------------------------------------
# Defaults. s2-pro is the production model; never silently fall back to an
# older Fish model.
# --------------------------------------------------------------------------

DEFAULT_FISH_MODEL = "s2-pro"
DEFAULT_FISH_LATENCY = "balanced"
DEFAULT_FISH_NORMALIZE = True
DEFAULT_FISH_SPEED = 1.0
DEFAULT_FISH_VOLUME = 0

#: Fish only emits raw PCM for the realtime WebSocket path we use. Anything
#: else would need transcoding before Asterisk.
FISH_OUTPUT_FORMAT = "pcm"

VALID_LATENCY_MODES = ("normal", "balanced")

SPEED_RANGE = (0.5, 2.0)
VOLUME_RANGE_DB = (-20, 20)
UNIT_RANGE = (0.0, 1.0)

#: Fields exposed through Dograh's normal TTS configuration system.
FISH_CONFIG_FIELDS = (
    "api_key",
    "model",
    "voice",
    "speed",
    "latency",
    "normalize",
    "temperature",
    "top_p",
    "volume",
)

#: Name of the organization-level default voice setting. Read from Dograh's
#: provider configuration first; the environment variable is only the
#: bootstrap fallback for a brand-new install.
FISH_DEFAULT_VOICE_SETTING = "FISH_AUDIO_DEFAULT_VOICE_ID"

#: Name of the Fish API key secret.
FISH_API_KEY_SETTING = "FISH_AUDIO_API_KEY"


class FishConfigError(ValueError):
    """Raised when a Fish configuration cannot produce a usable TTS service."""


def _coerce_float(value: Any, field_name: str, errors: list[str]) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        errors.append(f"{field_name}: expected a number, got {value!r}")
        return None


def _coerce_int(value: Any, field_name: str, errors: list[str]) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        errors.append(f"{field_name}: expected an integer, got {value!r}")
        return None


def _coerce_bool(value: Any, field_name: str, errors: list[str]) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "on"):
            return True
        if lowered in ("false", "0", "no", "off"):
            return False
    errors.append(f"{field_name}: expected a boolean, got {value!r}")
    return None


def _in_range(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


@dataclass
class FishTTSConfig:
    """Resolved Fish Audio settings for one agent / workflow / organization.

    ``None`` means "not configured" and the field is omitted from the Pipecat
    settings delta so Pipecat's own default applies. The four fields with a
    production default (``model``, ``latency``, ``normalize``, ``speed``,
    ``volume``) are always populated by :meth:`from_mapping`.
    """

    api_key: str | None = field(default=None, repr=False)
    model: str = DEFAULT_FISH_MODEL
    voice: str | None = None
    speed: float | None = DEFAULT_FISH_SPEED
    latency: str | None = DEFAULT_FISH_LATENCY
    normalize: bool | None = DEFAULT_FISH_NORMALIZE
    temperature: float | None = None
    top_p: float | None = None
    volume: int | None = DEFAULT_FISH_VOLUME

    # ---------------------------------------------------------------- build

    @classmethod
    def from_mapping(
        cls,
        raw: Mapping[str, Any] | Any,
        *,
        org_default_voice: str | None = None,
        org_default_api_key: str | None = None,
    ) -> "FishTTSConfig":
        """Build a config from Dograh's stored TTS config.

        ``raw`` may be a plain dict (Dograh stores provider config as JSON) or
        any object with the same attribute names (e.g. a pydantic
        ``user_config.tts``), so the same call site works for both shapes.

        Missing ``voice`` / ``api_key`` fall back to the organization-level
        values. Coercion errors are *not* raised here — call :meth:`validate`
        to get the full list, so the UI can show every problem at once.
        """
        get = _reader(raw)
        errors: list[str] = []

        model = get("model")
        model = str(model).strip() if model not in (None, "") else DEFAULT_FISH_MODEL

        voice = get("voice")
        voice = str(voice).strip() if voice not in (None, "") else None
        if not voice and org_default_voice:
            voice = str(org_default_voice).strip() or None

        api_key = get("api_key")
        api_key = str(api_key) if api_key not in (None, "") else None
        if not api_key and org_default_api_key:
            api_key = str(org_default_api_key) or None

        latency = get("latency")
        latency = str(latency).strip().lower() if latency not in (None, "") else DEFAULT_FISH_LATENCY

        normalize = _coerce_bool(get("normalize"), "normalize", errors)
        if normalize is None:
            normalize = DEFAULT_FISH_NORMALIZE

        speed = _coerce_float(get("speed"), "speed", errors)
        if speed is None:
            speed = DEFAULT_FISH_SPEED

        volume = _coerce_int(get("volume"), "volume", errors)
        if volume is None:
            volume = DEFAULT_FISH_VOLUME

        cfg = cls(
            api_key=api_key,
            model=model,
            voice=voice,
            speed=speed,
            latency=latency,
            normalize=normalize,
            # Optional: stay unset unless explicitly configured. Aggressive
            # defaults here make production speech unpredictable.
            temperature=_coerce_float(get("temperature"), "temperature", errors),
            top_p=_coerce_float(get("top_p"), "top_p", errors),
            volume=volume,
        )
        cfg._coercion_errors = errors  # type: ignore[attr-defined]
        return cfg

    # ------------------------------------------------------------- validate

    def validate(self, *, require_voice: bool = True) -> list[str]:
        """Return a list of human-readable problems; empty means usable.

        Never includes the API key value in a message.
        """
        errors: list[str] = list(getattr(self, "_coercion_errors", []))

        if not self.api_key:
            errors.append(
                f"api_key: missing. Set the {FISH_API_KEY_SETTING} provider secret "
                "for this organization."
            )
        if not self.model:
            errors.append("model: missing.")
        if require_voice and not self.voice:
            errors.append(
                "voice: missing. Set the Fish voice/reference ID on the agent, or an "
                f"organization default ({FISH_DEFAULT_VOICE_SETTING})."
            )
        if self.latency not in VALID_LATENCY_MODES:
            errors.append(
                f"latency: {self.latency!r} is not one of {list(VALID_LATENCY_MODES)}."
            )
        if self.speed is not None and not _in_range(self.speed, SPEED_RANGE):
            errors.append(f"speed: {self.speed} outside {SPEED_RANGE}.")
        if self.volume is not None and not _in_range(self.volume, VOLUME_RANGE_DB):
            errors.append(f"volume: {self.volume} dB outside {VOLUME_RANGE_DB}.")
        if self.temperature is not None and not _in_range(self.temperature, UNIT_RANGE):
            errors.append(f"temperature: {self.temperature} outside {UNIT_RANGE}.")
        if self.top_p is not None and not _in_range(self.top_p, UNIT_RANGE):
            errors.append(f"top_p: {self.top_p} outside {UNIT_RANGE}.")
        return errors

    def require_valid(self, *, require_voice: bool = True) -> "FishTTSConfig":
        errors = self.validate(require_voice=require_voice)
        if errors:
            raise FishConfigError("Invalid Fish Audio TTS configuration: " + "; ".join(errors))
        return self

    # -------------------------------------------------------------- mapping

    def settings_kwargs(self) -> dict[str, Any]:
        """Kwargs for Pipecat's ``FishAudioTTSSettings``.

        Sparse on purpose: Pipecat merges a settings *delta* onto its own
        store, skipping ``NOT_GIVEN`` fields. Passing ``None`` for an
        unconfigured field would overwrite a good default with ``None``, so
        unconfigured fields are simply omitted.
        """
        kwargs: dict[str, Any] = {"model": self.model}
        if self.voice is not None:
            kwargs["voice"] = self.voice
        if self.latency is not None:
            kwargs["latency"] = self.latency
        if self.normalize is not None:
            kwargs["normalize"] = self.normalize
        if self.speed is not None:
            kwargs["prosody_speed"] = self.speed
        if self.volume is not None:
            kwargs["prosody_volume"] = self.volume
        if self.temperature is not None:
            kwargs["temperature"] = self.temperature
        if self.top_p is not None:
            kwargs["top_p"] = self.top_p
        return kwargs

    # ------------------------------------------------------------ secrecy

    def fingerprint(self) -> str | None:
        """Stable, non-reversible identifier for the configured API key."""
        if not self.api_key:
            return None
        return hashlib.sha256(self.api_key.encode("utf-8")).hexdigest()[:12]

    def voice_fingerprint(self) -> str | None:
        """Hashed voice ID, for metrics pipelines that must not carry raw IDs."""
        if not self.voice:
            return None
        return hashlib.sha256(self.voice.encode("utf-8")).hexdigest()[:12]

    def redacted(self) -> dict[str, Any]:
        """Log/API-safe view. Never contains the API key."""
        return {
            "provider": FISH_PROVIDER_ID,
            "model": self.model,
            "voice": self.voice,
            "latency": self.latency,
            "normalize": self.normalize,
            "speed": self.speed,
            "volume": self.volume,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "api_key_present": bool(self.api_key),
            "api_key_fingerprint": self.fingerprint(),
        }


def _reader(raw: Mapping[str, Any] | Any):
    """Return a ``get(name)`` closure for dicts *or* attribute objects."""
    if isinstance(raw, Mapping):
        return lambda name: raw.get(name)
    return lambda name: getattr(raw, name, None)


def mask_secret(secret: str | None, *, keep: int = 4) -> str:
    """Render a secret for a log line: ``"sk-…    " -> "sk-…abcd"``."""
    if not secret:
        return "<unset>"
    if len(secret) <= keep:
        return "*" * len(secret)
    return "*" * (len(secret) - keep) + secret[-keep:]


def resolve_output_sample_rate(audio_config: Any) -> int:
    """Derive the TTS output rate from Dograh's transport configuration.

    The ARI telephony transport runs at 8 kHz, but WebRTC/browser testing does
    not — so the rate is always read from the transport, never hardcoded.

    Raises:
        FishConfigError: if the transport rate is missing or non-positive.
            Guessing here produces a frame whose declared rate disagrees with
            its bytes, which is worse than failing loudly.
    """
    for attr in ("transport_out_sample_rate", "output_sample_rate", "sample_rate"):
        value = getattr(audio_config, attr, None)
        if value is None and isinstance(audio_config, Mapping):
            value = audio_config.get(attr)
        if value:
            rate = int(value)
            if rate <= 0:
                raise FishConfigError(f"{attr} must be positive, got {rate}")
            return rate
    raise FishConfigError(
        "Could not determine the transport output sample rate from the audio "
        "config; refusing to guess (ARI is 8000 Hz, WebRTC is not)."
    )
