"""Fallback policy, circuit breaker, canary routing and cost accounting."""

import pytest

from fish_health import (
    FailureStage,
    FishHealthGate,
    FishReliabilityConfig,
    decide_fallback,
    in_canary,
    select_tts_provider,
)
from fish_metrics import (
    FishTTSUsage,
    estimate_fish_cost_usd,
    pcm_duration_seconds,
    utf8_bytes,
)


# ------------------------------------------------------- the critical rule


@pytest.mark.parametrize(
    "stage",
    [
        FailureStage.CONNECT,
        FailureStage.AUTH,
        FailureStage.TIMEOUT_BEFORE_AUDIO,
        FailureStage.SYNTHESIS_BEFORE_AUDIO,
    ],
)
def test_pre_audio_failures_may_fall_back_for_the_current_utterance(stage):
    decision = decide_fallback(stage, first_audio_seen=False, fallback_available=True)
    assert decision.fallback_current_utterance is True
    assert decision.degrade_subsequent_utterances is True


def test_failure_after_partial_audio_never_replays_the_utterance():
    decision = decide_fallback(
        FailureStage.SYNTHESIS_AFTER_AUDIO, first_audio_seen=True, fallback_available=True
    )
    assert decision.fallback_current_utterance is False
    assert decision.replays_audio is False
    # But the next response should still use the fallback.
    assert decision.degrade_subsequent_utterances is True


def test_first_audio_seen_blocks_fallback_even_for_a_pre_audio_stage_label():
    decision = decide_fallback(
        FailureStage.SYNTHESIS_BEFORE_AUDIO, first_audio_seen=True, fallback_available=True
    )
    assert decision.fallback_current_utterance is False


def test_no_fallback_configured_means_no_fallback():
    decision = decide_fallback(
        FailureStage.CONNECT, first_audio_seen=False, fallback_available=False
    )
    assert decision.fallback_current_utterance is False
    assert decision.degrade_subsequent_utterances is False


# ------------------------------------------------------------- breaker


def test_breaker_opens_after_threshold_pre_audio_failures():
    clock = [0.0]
    gate = FishHealthGate(failure_threshold=3, open_seconds=60, clock=lambda: clock[0])
    for _ in range(2):
        gate.record_pre_audio_failure()
    assert gate.is_open() is False
    gate.record_pre_audio_failure()
    assert gate.is_open() is True
    assert gate.open_count == 1


def test_breaker_half_opens_after_the_window():
    clock = [0.0]
    gate = FishHealthGate(failure_threshold=1, open_seconds=30, clock=lambda: clock[0])
    gate.record_pre_audio_failure()
    assert gate.is_open() is True
    clock[0] = 29.0
    assert gate.is_open() is True
    clock[0] = 31.0
    assert gate.is_open() is False


def test_success_closes_the_breaker():
    gate = FishHealthGate(failure_threshold=2)
    gate.record_pre_audio_failure()
    gate.record_success()
    gate.record_pre_audio_failure()
    assert gate.is_open() is False
    assert gate.consecutive_failures == 1


# --------------------------------------------------------- provider choice


def test_fish_is_selected_when_healthy():
    cfg = FishReliabilityConfig(fallback_provider="cartesia")
    provider, reason = select_tts_provider(
        configured_provider="fish", reliability=cfg, gate=FishHealthGate()
    )
    assert provider == "fish"
    assert reason == "fish primary"


def test_open_breaker_routes_new_calls_to_the_fallback():
    gate = FishHealthGate(failure_threshold=1)
    gate.record_pre_audio_failure()
    provider, reason = select_tts_provider(
        configured_provider="fish",
        reliability=FishReliabilityConfig(fallback_provider="cartesia"),
        gate=gate,
    )
    assert provider == "cartesia"
    assert "breaker" in reason


def test_open_breaker_without_a_fallback_still_uses_fish():
    gate = FishHealthGate(failure_threshold=1)
    gate.record_pre_audio_failure()
    provider, _ = select_tts_provider(
        configured_provider="fish", reliability=FishReliabilityConfig(), gate=gate
    )
    assert provider == "fish"


def test_a_non_fish_workflow_is_never_diverted():
    gate = FishHealthGate(failure_threshold=1)
    gate.record_pre_audio_failure()
    provider, _ = select_tts_provider(
        configured_provider="elevenlabs",
        reliability=FishReliabilityConfig(fallback_provider="cartesia"),
        gate=gate,
    )
    assert provider == "elevenlabs"


def test_canary_is_deterministic_and_proportional():
    assert in_canary("call-1", 0) is False
    assert in_canary("call-1", 100) is True
    assert in_canary("call-1", 5) == in_canary("call-1", 5)

    keys = [f"call-{i}" for i in range(4000)]
    hits = sum(in_canary(k, 5) for k in keys)
    assert 100 <= hits <= 300, hits  # ~5% of 4000 = 200


def test_canary_routes_the_rest_to_the_fallback():
    cfg = FishReliabilityConfig(fallback_provider="cartesia", canary_percent=0)
    provider, reason = select_tts_provider(
        configured_provider="fish", reliability=cfg, bucket_key="call-1"
    )
    assert provider == "cartesia"
    assert "canary" in reason


def test_reliability_config_from_env():
    cfg = FishReliabilityConfig.from_env(
        {
            "PRIMARY_TTS_PROVIDER": "fish",
            "FALLBACK_TTS_PROVIDER": "Cartesia",
            "FISH_TTS_TTFB_TIMEOUT_MS": "1800",
            "FISH_TTS_MAX_CONNECT_RETRIES": "1",
            "FISH_TTS_CANARY_PERCENT": "15",
        }
    )
    assert cfg.primary_provider == "fish"
    assert cfg.fallback_provider == "cartesia"
    assert cfg.ttfb_timeout_ms == 1800
    assert cfg.ttfb_timeout_seconds == 1.8
    assert cfg.canary_percent == 15


def test_reliability_config_survives_garbage_env_values():
    cfg = FishReliabilityConfig.from_env({"FISH_TTS_TTFB_TIMEOUT_MS": "soon"})
    assert cfg.ttfb_timeout_ms == 2500


# ------------------------------------------------------------ accounting


def test_fish_bills_utf8_bytes_which_are_not_always_characters():
    text = "Café — $1,200"
    assert len(text) != utf8_bytes(text)
    usage = FishTTSUsage(requested_sample_rate=8000)
    usage.record_submission(text)
    assert usage.characters_submitted == len(text)
    assert usage.utf8_bytes_submitted == utf8_bytes(text)


def test_audio_duration_comes_from_pcm_bytes_not_call_time():
    # 1 second of mono 16-bit 8 kHz PCM = 16000 bytes.
    usage = FishTTSUsage(requested_sample_rate=8000)
    usage.record_audio_chunk(16000)
    assert usage.audio_duration_seconds == pytest.approx(1.0)
    assert usage.audio_chunks == 1


def test_pcm_duration_tracks_the_transport_rate():
    assert pcm_duration_seconds(16000, 8000) == pytest.approx(1.0)
    assert pcm_duration_seconds(16000, 16000) == pytest.approx(0.5)


def test_cost_is_a_function_of_submitted_bytes_only():
    assert estimate_fish_cost_usd(1_000_000, usd_per_million_bytes=15.0) == pytest.approx(15.0)
    usage = FishTTSUsage(requested_sample_rate=8000, usd_per_million_bytes=15.0)
    usage.record_submission("a" * 500_000)
    assert usage.estimated_cost_usd == pytest.approx(7.5)


def test_errors_are_classified_by_whether_audio_had_started():
    usage = FishTTSUsage()
    usage.record_error(first_audio_seen=False)
    usage.record_error(first_audio_seen=True)
    assert usage.errors == 2
    assert usage.errors_before_first_audio == 1
    assert usage.errors_after_partial_audio == 1


def test_metrics_payload_has_percentiles_and_no_secrets():
    usage = FishTTSUsage(
        model="s2-pro",
        voice="voice-abc",
        requested_sample_rate=8000,
        call_id="call-1",
        transport_type="ari",
    )
    for value in (0.10, 0.20, 0.30, 0.40):
        usage.record_ttfb(value)
    usage.record_submission("hello")
    metrics = usage.to_metrics()
    assert metrics["ttfb_p50_seconds"] == pytest.approx(0.25)
    assert metrics["ttfb_p95_seconds"] >= metrics["ttfb_p50_seconds"]
    assert metrics["transport_type"] == "ari"
    assert "api_key" not in metrics
    assert metrics["estimated_cost_usd"] >= 0
