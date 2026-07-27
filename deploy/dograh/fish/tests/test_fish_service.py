"""Fish TTS service tests against the real Pipecat ``FishAudioTTSService``.

The Fish WebSocket is mocked end to end (``ormsgpack`` framing included), so
the suite never spends a paid Fish API call and never needs network access.
Everything below the mock — settings merging, the start message, the receive
loop, audio contexts, interruption handling — is genuine Pipecat code.
"""

import asyncio
from unittest.mock import MagicMock, patch

import ormsgpack
import pytest
from websockets.protocol import State

from pipecat.clocks.system_clock import SystemClock
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    StartFrame,
    TTSAudioRawFrame,
)
from pipecat.processors.frame_processor import FrameProcessorSetup
from pipecat.utils.asyncio.task_manager import TaskManager

from fish_config import FishConfigError, FishTTSConfig
from fish_health import FishHealthGate, FishReliabilityConfig
from fish_metrics import FishTTSUsage
from fish_service import create_fish_tts_service

pytestmark = pytest.mark.asyncio

CHUNK = b"\x01\x02" * 1024  # 2048 bytes — above Pipecat's 1024-byte floor


class FakeFishWebSocket:
    """Minimal stand-in for Fish's realtime WebSocket."""

    def __init__(
        self,
        *,
        chunks: int = 2,
        silent: bool = False,
        error_after_chunks: int | None = None,
    ) -> None:
        self.sent: list[dict] = []
        self.queue: asyncio.Queue = asyncio.Queue()
        self.state = State.OPEN
        self.closed = False
        self._chunks = chunks
        self._silent = silent
        self._error_after_chunks = error_after_chunks

    @property
    def start_message(self) -> dict | None:
        for msg in self.sent:
            if msg.get("event") == "start":
                return msg
        return None

    async def send(self, data: bytes) -> None:
        message = ormsgpack.unpackb(data)
        self.sent.append(message)
        if message.get("event") != "flush" or self._silent:
            return
        for index in range(self._chunks):
            if self._error_after_chunks is not None and index >= self._error_after_chunks:
                await self.queue.put(ormsgpack.packb({"event": "finish", "reason": "error"}))
                return
            await self.queue.put(ormsgpack.packb({"event": "audio", "audio": CHUNK}))

    async def close(self) -> None:
        self.closed = True
        self.state = State.CLOSED
        await self.queue.put(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


class StubFallbackTTS:
    """Yield-based stand-in for the configured fallback provider."""

    def __init__(self) -> None:
        self.spoken: list[str] = []
        self.started = False
        self.stopped = False
        self.cancelled = False

    async def start(self, frame) -> None:
        self.started = True

    async def stop(self, frame) -> None:
        self.stopped = True

    async def cancel(self, frame) -> None:
        self.cancelled = True

    async def run_tts(self, text: str, context_id: str):
        self.spoken.append(text)
        yield TTSAudioRawFrame(b"\x00\x00" * 800, 8000, 1, context_id=context_id)


async def build_service(
    *,
    sample_rate: int = 8000,
    config_overrides: dict | None = None,
    websocket: FakeFishWebSocket | None = None,
    connect_fails: bool = False,
    fallback: StubFallbackTTS | None = None,
    gate: FishHealthGate | None = None,
    ttfb_timeout_ms: int = 250,
    max_connect_retries: int = 0,
    **extra,
):
    """Construct the service with a mocked Fish WebSocket and start it."""
    websocket = websocket or FakeFishWebSocket()
    headers: dict = {}

    async def fake_connect(url, additional_headers=None, **_kwargs):
        headers.update(additional_headers or {})
        if connect_fails:
            raise ConnectionRefusedError("fish unreachable")
        return websocket

    raw = {"api_key": "sk-test-key", "voice": "voice-abc"}
    raw.update(config_overrides or {})
    config = FishTTSConfig.from_mapping(raw)
    usage = FishTTSUsage(call_id="call-1", transport_type="ari")
    reliability = FishReliabilityConfig(
        fallback_provider="stub" if fallback else None,
        ttfb_timeout_ms=ttfb_timeout_ms,
        max_connect_retries=max_connect_retries,
    )

    with patch("pipecat.services.fish.tts.websocket_connect", fake_connect):
        service = create_fish_tts_service(
            config,
            sample_rate=sample_rate,
            usage=usage,
            gate=gate,
            reliability=reliability,
            fallback_factory=(lambda: fallback) if fallback else None,
            **extra,
        )
        task_manager = TaskManager(loop=asyncio.get_running_loop())
        await service.setup(
            FrameProcessorSetup(
                clock=SystemClock(), task_manager=task_manager, pipeline_worker=MagicMock()
            )
        )
        pushed: list = []

        async def capture(frame, direction=None):
            pushed.append(frame)

        service.push_frame = capture
        await service.start(StartFrame(audio_out_sample_rate=sample_rate))

    service._test_pushed = pushed  # type: ignore[attr-defined]
    service._test_headers = headers  # type: ignore[attr-defined]
    service._test_ws = websocket  # type: ignore[attr-defined]
    service._test_connect = fake_connect  # type: ignore[attr-defined]
    service._test_usage = usage  # type: ignore[attr-defined]
    return service


async def speak(service, text: str, context_id: str = "ctx-1", settle: float = 0.15):
    """Run one utterance the way ``TTSService`` would, and collect the frames."""
    await service.create_audio_context(context_id)
    service._turn_context_id = context_id
    with patch("pipecat.services.fish.tts.websocket_connect", service._test_connect):
        frames = [frame async for frame in service.run_tts(text, context_id)]
    await asyncio.sleep(settle)
    return frames


async def teardown(service):
    with patch("pipecat.services.fish.tts.websocket_connect", service._test_connect):
        await service.stop(EndFrame())


# ---------------------------------------------------------------- wire format


async def test_start_message_uses_s2_pro_pcm_and_the_transport_sample_rate():
    service = await build_service(sample_rate=8000)
    try:
        start = service._test_ws.start_message
        assert start is not None
        request = start["request"]
        assert request["format"] == "pcm"
        assert request["sample_rate"] == 8000
        assert request["reference_id"] == "voice-abc"
        assert request["latency"] == "balanced"
        assert request["normalize"] is True
        assert request["prosody"] == {"speed": 1.0, "volume": 0}
        assert service._test_headers["model"] == "s2-pro"
        assert service._test_headers["Authorization"] == "Bearer sk-test-key"
    finally:
        await teardown(service)


async def test_webrtc_sample_rate_is_not_forced_to_8k():
    service = await build_service(sample_rate=16000)
    try:
        assert service._test_ws.start_message["request"]["sample_rate"] == 16000
        assert service.sample_rate == 16000
    finally:
        await teardown(service)


async def test_all_tunables_reach_the_wire():
    service = await build_service(
        config_overrides={
            "model": "s2-pro",
            "speed": 1.2,
            "volume": -4,
            "latency": "normal",
            "normalize": False,
            "temperature": 0.55,
            "top_p": 0.75,
        }
    )
    try:
        request = service._test_ws.start_message["request"]
        assert request["latency"] == "normal"
        assert request["normalize"] is False
        assert request["prosody"] == {"speed": 1.2, "volume": -4}
        assert request["temperature"] == 0.55
        assert request["top_p"] == 0.75
    finally:
        await teardown(service)


async def test_unset_temperature_and_top_p_are_absent_from_the_wire():
    service = await build_service()
    try:
        request = service._test_ws.start_message["request"]
        assert "temperature" not in request
        assert "top_p" not in request
    finally:
        await teardown(service)


# ------------------------------------------------------------- happy path


async def test_audio_chunks_ttfb_and_cost_are_recorded():
    gate = FishHealthGate()
    service = await build_service(gate=gate)
    usage = service._test_usage
    try:
        await speak(service, "Hello there.")
        assert usage.audio_chunks == 2
        assert usage.audio_bytes == 2 * len(CHUNK)
        assert usage.utterances == 1
        assert usage.utf8_bytes_submitted == len("Hello there.")
        assert usage.ttfb_seconds and usage.ttfb_seconds[0] < 1.0
        assert usage.errors == 0
        assert usage.audio_duration_seconds == pytest.approx(4096 / 16000)
        assert gate.is_open() is False
        assert service.degraded is False
    finally:
        await teardown(service)


async def test_the_same_websocket_is_reused_across_utterances_of_one_call():
    service = await build_service()
    try:
        await speak(service, "First sentence.", "ctx-1")
        first = service._websocket
        await speak(service, "Second sentence.", "ctx-2")
        assert service._websocket is first
        assert service._test_usage.connect_attempts == 1
        assert service._test_usage.reconnects == 0
        assert service._test_usage.utterances == 2
    finally:
        await teardown(service)


async def test_stop_closes_the_websocket_and_the_receive_task():
    service = await build_service()
    await speak(service, "Bye.")
    await teardown(service)
    assert service._test_ws.closed is True
    assert service._websocket is None
    assert service._receive_task is None


async def test_cancel_closes_the_session_and_records_the_cancellation():
    service = await build_service()
    await speak(service, "Long sentence being spoken.")
    with patch("pipecat.services.fish.tts.websocket_connect", service._test_connect):
        await service.cancel(CancelFrame())
    assert service._test_ws.closed is True
    assert service._receive_task is None
    assert service._test_usage.cancellations == 1
    assert service._test_usage.cancellation_seconds


async def test_interruption_is_recorded_with_a_cancellation_latency():
    service = await build_service()
    try:
        await speak(service, "Interrupt me.")
        await service.on_audio_context_interrupted("ctx-1")
        assert service._test_usage.interruptions == 1
        assert service._test_usage.cancellation_seconds
        assert service._test_usage.cancellation_seconds[0] < 1.0
    finally:
        await teardown(service)


# --------------------------------------------------------------- failures


async def test_connect_failure_falls_back_for_the_current_utterance():
    fallback = StubFallbackTTS()
    gate = FishHealthGate(failure_threshold=1)
    service = await build_service(connect_fails=True, fallback=fallback, gate=gate)
    try:
        frames = await speak(service, "Greeting after connect failure.")
        assert fallback.spoken == ["Greeting after connect failure."]
        assert fallback.started is True
        assert any(isinstance(f, TTSAudioRawFrame) for f in frames)
        assert service._test_usage.fallback_activations == 1
        assert service.degraded is True
        assert gate.is_open() is True
    finally:
        await teardown(service)


async def test_connect_failure_without_a_fallback_yields_an_error_not_silence():
    service = await build_service(connect_fails=True)
    try:
        frames = await speak(service, "No fallback configured.")
        assert any(isinstance(f, ErrorFrame) for f in frames)
        assert service._test_usage.fallback_activations == 0
    finally:
        await teardown(service)


async def test_connect_is_retried_a_bounded_number_of_times():
    service = await build_service(connect_fails=True, max_connect_retries=1)
    try:
        # One attempt during start(), then two more (1 retry) for the utterance.
        await speak(service, "Retry me.")
        assert service._test_usage.connect_attempts >= 3
        assert service._test_usage.errors_before_first_audio >= 2
    finally:
        await teardown(service)


async def test_timeout_before_first_audio_falls_back_for_that_utterance():
    fallback = StubFallbackTTS()
    service = await build_service(
        websocket=FakeFishWebSocket(silent=True), fallback=fallback, ttfb_timeout_ms=200
    )
    try:
        await speak(service, "Silence from fish.", settle=0.05)
        assert fallback.spoken == ["Silence from fish."]
        assert service._test_usage.fallback_activations == 1
        assert service._test_usage.errors_before_first_audio == 1
        assert service._test_usage.errors_after_partial_audio == 0
    finally:
        await teardown(service)


async def test_error_after_partial_audio_is_never_replayed_through_the_fallback():
    """The caller has already heard part of the sentence; replaying duplicates it."""
    fallback = StubFallbackTTS()
    service = await build_service(
        websocket=FakeFishWebSocket(chunks=3, error_after_chunks=1), fallback=fallback
    )
    try:
        await speak(service, "Half of this sentence played.", settle=0.3)
        usage = service._test_usage
        assert usage.audio_chunks == 1  # partial audio did reach the caller
        assert usage.errors_after_partial_audio == 1
        assert usage.fallback_activations == 0
        assert fallback.spoken == []  # no replay
        # ...but the next response uses the fallback.
        assert service.degraded is True
        await speak(service, "Next response.", "ctx-2", settle=0.05)
        assert fallback.spoken == ["Next response."]
        assert usage.fallback_activations == 1
    finally:
        await teardown(service)


async def test_a_mid_utterance_failure_does_not_trip_the_breaker():
    gate = FishHealthGate(failure_threshold=1)
    service = await build_service(
        websocket=FakeFishWebSocket(chunks=3, error_after_chunks=1), gate=gate
    )
    try:
        await speak(service, "Partial audio then error.", settle=0.3)
        assert service._test_usage.errors_after_partial_audio == 1
        assert gate.is_open() is False
    finally:
        await teardown(service)


async def test_once_degraded_every_later_utterance_uses_the_fallback():
    fallback = StubFallbackTTS()
    service = await build_service(connect_fails=True, fallback=fallback)
    try:
        await speak(service, "One.", "ctx-1")
        await speak(service, "Two.", "ctx-2")
        assert fallback.spoken == ["One.", "Two."]
        assert fallback.started is True
        assert service._test_usage.fallback_activations == 2
    finally:
        await teardown(service)


async def test_fallback_is_torn_down_with_the_call():
    fallback = StubFallbackTTS()
    service = await build_service(connect_fails=True, fallback=fallback)
    await speak(service, "One.")
    await teardown(service)
    assert fallback.stopped is True


# -------------------------------------------------------------- construction


async def test_missing_api_key_fails_at_construction_not_mid_call():
    with pytest.raises(FishConfigError) as excinfo:
        create_fish_tts_service(
            FishTTSConfig.from_mapping({"voice": "v"}), sample_rate=8000
        )
    assert "api_key" in str(excinfo.value)


async def test_missing_voice_fails_at_construction():
    with pytest.raises(FishConfigError) as excinfo:
        create_fish_tts_service(
            FishTTSConfig.from_mapping({"api_key": "k"}), sample_rate=8000
        )
    assert "voice" in str(excinfo.value)


async def test_non_positive_sample_rate_is_rejected():
    with pytest.raises(FishConfigError):
        create_fish_tts_service(
            FishTTSConfig.from_mapping({"api_key": "k", "voice": "v"}), sample_rate=0
        )


async def test_dograh_ttsservice_kwargs_are_passed_through():
    service = await build_service(
        skip_aggregator_types=["recording_router", "recording"], silence_time_s=1.0
    )
    try:
        assert service._skip_aggregator_types == ["recording_router", "recording"]
        assert service._silence_time_s == 1.0
    finally:
        await teardown(service)


async def test_an_unknown_kwarg_is_dropped_instead_of_exploding():
    """A Pipecat fork may not have every upstream kwarg."""
    service = await build_service(a_kwarg_this_pipecat_does_not_have=True)
    try:
        assert service is not None
    finally:
        await teardown(service)
