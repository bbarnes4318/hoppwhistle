"""Fish provider configuration: defaults, validation, propagation, secrecy."""

import pytest

from fish_config import (
    DEFAULT_FISH_LATENCY,
    DEFAULT_FISH_MODEL,
    FISH_OUTPUT_FORMAT,
    FISH_PROVIDER_DISPLAY_NAME,
    FISH_PROVIDER_ID,
    FishConfigError,
    FishTTSConfig,
    mask_secret,
    resolve_output_sample_rate,
)


# --------------------------------------------------------------- identity


def test_provider_identity_is_stable():
    assert FISH_PROVIDER_ID == "fish"
    assert FISH_PROVIDER_DISPLAY_NAME == "Fish Audio"
    assert FISH_OUTPUT_FORMAT == "pcm"


def test_model_defaults_to_s2_pro_when_unset():
    cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v"})
    assert cfg.model == "s2-pro"
    assert DEFAULT_FISH_MODEL == "s2-pro"
    assert cfg.settings_kwargs()["model"] == "s2-pro"


def test_blank_model_does_not_silently_become_an_older_fish_model():
    for blank in ("", None):
        cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v", "model": blank})
        assert cfg.model == "s2-pro"


def test_explicit_model_is_respected():
    cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v", "model": "s1"})
    assert cfg.model == "s1"


# ------------------------------------------------------------ propagation


def test_every_field_propagates_into_the_pipecat_settings_delta():
    cfg = FishTTSConfig.from_mapping(
        {
            "api_key": "sk-secret",
            "model": "s2-pro",
            "voice": "abc123voice",
            "speed": 1.15,
            "latency": "normal",
            "normalize": False,
            "temperature": 0.6,
            "top_p": 0.8,
            "volume": -3,
        }
    )
    kwargs = cfg.settings_kwargs()
    assert kwargs == {
        "model": "s2-pro",
        "voice": "abc123voice",
        "latency": "normal",
        "normalize": False,
        "prosody_speed": 1.15,
        "prosody_volume": -3,
        "temperature": 0.6,
        "top_p": 0.8,
    }


def test_unset_optionals_are_omitted_not_nulled():
    """A sparse delta: passing None would clobber Pipecat's own default."""
    cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v"})
    kwargs = cfg.settings_kwargs()
    assert "temperature" not in kwargs
    assert "top_p" not in kwargs
    # The production defaults are always explicit.
    assert kwargs["latency"] == DEFAULT_FISH_LATENCY == "balanced"
    assert kwargs["normalize"] is True
    assert kwargs["prosody_speed"] == 1.0
    assert kwargs["prosody_volume"] == 0


def test_string_values_from_json_config_are_coerced():
    cfg = FishTTSConfig.from_mapping(
        {"api_key": "k", "voice": "v", "speed": "1.25", "volume": "-2", "normalize": "false"}
    )
    assert cfg.speed == 1.25
    assert cfg.volume == -2
    assert cfg.normalize is False
    assert cfg.validate() == []


# ---------------------------------------------------------------- voices


def test_voice_falls_back_to_the_organization_default():
    cfg = FishTTSConfig.from_mapping({"api_key": "k"}, org_default_voice="org-voice")
    assert cfg.voice == "org-voice"


def test_agent_voice_beats_the_organization_default():
    cfg = FishTTSConfig.from_mapping(
        {"api_key": "k", "voice": "agent-voice"}, org_default_voice="org-voice"
    )
    assert cfg.voice == "agent-voice"


def test_missing_voice_is_an_error():
    errors = FishTTSConfig.from_mapping({"api_key": "k"}).validate()
    assert any(e.startswith("voice:") for e in errors)


def test_missing_voice_is_allowed_when_explicitly_not_required():
    assert FishTTSConfig.from_mapping({"api_key": "k"}).validate(require_voice=False) == []


# -------------------------------------------------------------- api key


def test_missing_api_key_is_an_error():
    errors = FishTTSConfig.from_mapping({"voice": "v"}).validate()
    assert any(e.startswith("api_key:") for e in errors)
    assert not any("sk-" in e for e in errors)


def test_api_key_never_appears_in_repr_or_redacted_output():
    cfg = FishTTSConfig.from_mapping({"api_key": "sk-super-secret", "voice": "v"})
    assert "sk-super-secret" not in repr(cfg)
    redacted = cfg.redacted()
    assert "sk-super-secret" not in str(redacted)
    assert redacted["api_key_present"] is True
    assert redacted["api_key_fingerprint"]
    assert "api_key" not in redacted


def test_fingerprint_is_stable_and_not_reversible():
    a = FishTTSConfig.from_mapping({"api_key": "sk-1", "voice": "v"})
    b = FishTTSConfig.from_mapping({"api_key": "sk-1", "voice": "v"})
    c = FishTTSConfig.from_mapping({"api_key": "sk-2", "voice": "v"})
    assert a.fingerprint() == b.fingerprint() != c.fingerprint()
    assert "sk-1" not in a.fingerprint()


def test_mask_secret():
    assert mask_secret("sk-abcdefgh") == "*******efgh"
    assert mask_secret(None) == "<unset>"
    assert mask_secret("ab") == "**"


# ------------------------------------------------------------ validation


@pytest.mark.parametrize(
    "field,value",
    [
        ("speed", 3.0),
        ("speed", 0.1),
        ("volume", 40),
        ("volume", -40),
        ("temperature", 1.5),
        ("temperature", -0.1),
        ("top_p", 1.5),
        ("latency", "turbo"),
    ],
)
def test_out_of_range_values_are_rejected(field, value):
    cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v", field: value})
    errors = cfg.validate()
    assert any(e.startswith(f"{field}:") for e in errors), errors


def test_non_numeric_values_are_reported_not_crashed():
    cfg = FishTTSConfig.from_mapping({"api_key": "k", "voice": "v", "speed": "fast"})
    assert any("speed" in e for e in cfg.validate())


def test_require_valid_raises_with_a_message_that_has_no_secret():
    cfg = FishTTSConfig.from_mapping({"api_key": "sk-secret"})
    with pytest.raises(FishConfigError) as excinfo:
        cfg.require_valid()
    assert "sk-secret" not in str(excinfo.value)


# --------------------------------------------------------- attribute input


class _TTSAttrs:
    provider = "fish"
    api_key = "k"
    model = None
    voice = "attr-voice"
    speed = 1.1
    latency = "balanced"
    normalize = True
    temperature = None
    top_p = None
    volume = 0


def test_accepts_an_attribute_object_like_user_config_tts():
    cfg = FishTTSConfig.from_mapping(_TTSAttrs())
    assert cfg.voice == "attr-voice"
    assert cfg.model == "s2-pro"
    assert cfg.validate() == []


# -------------------------------------------------------- sample rate


class _AudioConfig:
    def __init__(self, rate):
        self.transport_out_sample_rate = rate


def test_ari_sample_rate_is_read_from_the_transport():
    assert resolve_output_sample_rate(_AudioConfig(8000)) == 8000


def test_webrtc_sample_rate_is_read_from_the_transport():
    assert resolve_output_sample_rate(_AudioConfig(16000)) == 16000


def test_dict_audio_config_is_supported():
    assert resolve_output_sample_rate({"transport_out_sample_rate": 24000}) == 24000


def test_missing_sample_rate_fails_loudly_instead_of_defaulting_to_8k():
    class Empty:
        pass

    with pytest.raises(FishConfigError):
        resolve_output_sample_rate(Empty())


def test_non_positive_sample_rate_is_rejected():
    with pytest.raises(FishConfigError):
        resolve_output_sample_rate(_AudioConfig(0))
