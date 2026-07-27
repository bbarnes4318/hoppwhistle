"""Migration planning rules and provider registration helpers."""

import enum
import json

import pytest

from fish_provider_patch import add_enum_member, fish_option_schema, find_provider_enum
from migrate_agents_to_fish import (
    SKIP_ALREADY_FISH,
    SKIP_INVALID,
    SKIP_NO_MAPPING,
    SKIP_NO_TTS_CONFIG,
    load_mapping,
    plan_row,
)


def _config(provider="cartesia", voice="sonic-1", model="sonic-2"):
    return {"tts": {"provider": provider, "model": model, "voice": voice}}


# ------------------------------------------------------------- planning


def test_a_mapped_agent_migrates_to_fish_s2_pro_with_its_own_voice():
    plan = plan_row("42", _config(), {"agent_or_workflow_id": "42", "fish_voice_id": "fish-42"})
    assert plan["action"] == "migrate"
    assert plan["proposed"] == {"provider": "fish", "model": "s2-pro", "voice": "fish-42"}
    assert plan["current"]["provider"] == "cartesia"


def test_an_unmapped_agent_is_left_on_its_current_provider():
    plan = plan_row("43", _config(), None)
    assert plan["action"] == "skip"
    assert plan["reason"] == SKIP_NO_MAPPING
    assert plan["current"]["provider"] == "cartesia"
    assert "voice" not in plan.get("proposed", {})


def test_two_agents_get_two_different_voices():
    """One Fish voice must never be blanket-applied to the whole fleet."""
    mapping = {
        "1": {"agent_or_workflow_id": "1", "fish_voice_id": "voice-a"},
        "2": {"agent_or_workflow_id": "2", "fish_voice_id": "voice-b"},
    }
    plans = [plan_row(rid, _config(), mapping[rid]) for rid in ("1", "2")]
    voices = {p["proposed"]["voice"] for p in plans}
    assert voices == {"voice-a", "voice-b"}


def test_an_agent_already_on_fish_is_not_touched_again():
    plan = plan_row(
        "44",
        _config(provider="fish", voice="fish-44", model="s2-pro"),
        {"agent_or_workflow_id": "44", "fish_voice_id": "fish-44"},
    )
    assert plan["action"] == "skip"
    assert plan["reason"] == SKIP_ALREADY_FISH


def test_a_row_without_tts_config_is_skipped():
    plan = plan_row("45", {"llm": {}}, {"agent_or_workflow_id": "45", "fish_voice_id": "v"})
    assert plan["reason"] == SKIP_NO_TTS_CONFIG


def test_per_agent_overrides_are_carried_through():
    plan = plan_row(
        "46",
        _config(),
        {
            "agent_or_workflow_id": "46",
            "fish_voice_id": "fish-46",
            "speed": 1.1,
            "latency": "normal",
            "model": "s2-pro",
        },
    )
    assert plan["new_tts"]["speed"] == 1.1
    assert plan["new_tts"]["latency"] == "normal"


def test_an_override_that_fails_validation_blocks_the_migration():
    plan = plan_row(
        "47",
        _config(),
        {"agent_or_workflow_id": "47", "fish_voice_id": "fish-47", "speed": 9.0},
    )
    assert plan["action"] == "skip"
    assert plan["reason"] == SKIP_INVALID
    assert any("speed" in e for e in plan["errors"])


def test_migration_is_idempotent():
    entry = {"agent_or_workflow_id": "48", "fish_voice_id": "fish-48"}
    first = plan_row("48", _config(), entry)
    migrated = {"tts": first["new_tts"]}
    second = plan_row("48", migrated, entry)
    assert second["action"] == "skip"
    assert second["reason"] == SKIP_ALREADY_FISH


def test_non_fish_fields_on_the_row_are_preserved():
    config = _config()
    config["tts"]["language"] = "en"
    config["llm"] = {"provider": "openai"}
    plan = plan_row("49", config, {"agent_or_workflow_id": "49", "fish_voice_id": "v"})
    assert plan["new_tts"]["language"] == "en"


# -------------------------------------------------------------- mapping io


def test_mapping_accepts_a_list_or_an_object(tmp_path):
    as_list = tmp_path / "list.json"
    as_list.write_text(
        json.dumps([{"agent_or_workflow_id": "1", "fish_voice_id": "a"}]), encoding="utf-8"
    )
    as_object = tmp_path / "object.json"
    as_object.write_text(json.dumps({"1": "a"}), encoding="utf-8")
    assert load_mapping(str(as_list))["1"]["fish_voice_id"] == "a"
    assert load_mapping(str(as_object))["1"]["fish_voice_id"] == "a"


def test_mapping_rejects_an_entry_without_a_voice(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps([{"agent_or_workflow_id": "1"}]), encoding="utf-8")
    with pytest.raises(SystemExit):
        load_mapping(str(path))


def test_mapping_rejects_duplicate_ids(tmp_path):
    path = tmp_path / "dupe.json"
    path.write_text(
        json.dumps(
            [
                {"agent_or_workflow_id": "1", "fish_voice_id": "a"},
                {"agent_or_workflow_id": "1", "fish_voice_id": "b"},
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(SystemExit):
        load_mapping(str(path))


# ------------------------------------------------------- provider registry


class _Providers(str, enum.Enum):
    CARTESIA = "cartesia"
    DEEPGRAM = "deepgram"
    OPENAI = "openai"


def test_fish_can_be_added_to_an_existing_provider_enum():
    assert add_enum_member(_Providers, "FISH", "fish") is True
    assert _Providers.FISH.value == "fish"  # type: ignore[attr-defined]
    assert _Providers("fish") is _Providers.FISH  # type: ignore[attr-defined]
    assert "FISH" in _Providers.__members__
    assert _Providers.FISH == "fish"  # str mixin preserved  # type: ignore[attr-defined]


def test_adding_fish_twice_is_a_no_op():
    add_enum_member(_Providers, "FISH", "fish")
    assert add_enum_member(_Providers, "FISH", "fish") is False


def test_provider_enum_discovery_needs_two_known_vendors():
    """A single vendor name is not enough evidence — avoid false positives."""
    found, path = find_provider_enum()
    # Dograh is not importable here, so discovery must fail cleanly.
    assert found is None and path is None


def test_option_schema_marks_the_api_key_secret_and_defaults_to_s2_pro():
    schema = fish_option_schema()
    assert schema["id"] == "fish"
    assert schema["name"] == "Fish Audio"
    assert schema["default_model"] == "s2-pro"
    fields = {f["key"]: f for f in schema["fields"]}
    assert set(fields) == {
        "api_key",
        "model",
        "voice",
        "latency",
        "speed",
        "volume",
        "normalize",
        "temperature",
        "top_p",
    }
    assert fields["api_key"]["secret"] is True
    assert fields["api_key"]["masked"] is True
    assert fields["voice"]["required"] is True
    assert fields["temperature"]["default"] is None
    assert fields["top_p"]["default"] is None


def test_option_schema_contains_no_hardcoded_voice_id():
    """A specific Fish voice must never be baked into source."""
    schema = json.dumps(fish_option_schema())
    voice_field = next(f for f in fish_option_schema()["fields"] if f["key"] == "voice")
    assert "default" not in voice_field or voice_field.get("default") in (None, "")
    assert "FISH_AUDIO_DEFAULT_VOICE_ID" in schema
