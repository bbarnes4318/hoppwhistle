"""Fish Audio S2 Pro TTS service construction for Dograh.

Wraps Pipecat's own ``FishAudioTTSService`` — this module deliberately does
**not** reimplement the Fish WebSocket protocol. It adds the three things
Dograh needs on top of it:

1. Configuration → Pipecat settings mapping, with the output sample rate taken
   from the transport (8 kHz for Asterisk ARI, whatever WebRTC negotiates for
   browser tests) and never hardcoded.
2. Structured usage/latency/cost instrumentation (:mod:`fish_metrics`).
3. Reliability: a bounded connect retry, a pre-first-audio TTFB watchdog, a
   circuit breaker, and a fallback that can only ever fire **before** Fish has
   emitted audio for the current utterance (:mod:`fish_health`).

All Pipecat hooks used here (``append_to_audio_context``, ``push_error``,
``on_audio_context_interrupted``, ``_connect_websocket``) are public/​protected
extension points of ``TTSService``; no upstream method body is copied, so the
kit survives a Pipecat bump inside the Dograh fork.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncGenerator
from typing import Any, Callable

from loguru import logger

from pipecat.frames.frames import CancelFrame, EndFrame, ErrorFrame, Frame, StartFrame
from pipecat.services.fish.tts import FishAudioTTSService, FishAudioTTSSettings

from fish_config import (
    FISH_OUTPUT_FORMAT,
    FISH_PROVIDER_ID,
    FishConfigError,
    FishTTSConfig,
    resolve_output_sample_rate,
)
from fish_health import (
    FailureStage,
    FishHealthGate,
    FishReliabilityConfig,
    decide_fallback,
)
from fish_metrics import FishTTSUsage, Stopwatch


class InstrumentedFishAudioTTSService(FishAudioTTSService):
    """``FishAudioTTSService`` plus Dograh instrumentation and fallback.

    One instance per call. The WebSocket it owns is opened on ``start()``,
    reused for every utterance of that call, and closed on ``stop()`` /
    ``cancel()`` — Pipecat's own lifecycle, which is what keeps sessions from
    leaking across calls.
    """

    def __init__(
        self,
        *,
        fish_config: FishTTSConfig,
        usage: FishTTSUsage,
        gate: FishHealthGate | None = None,
        reliability: FishReliabilityConfig | None = None,
        fallback_factory: Callable[[], Any] | None = None,
        await_first_audio: bool = True,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._fish_config = fish_config
        self._usage = usage
        self._gate = gate
        self._reliability = reliability or FishReliabilityConfig()
        self._fallback_factory = fallback_factory
        self._await_first_audio = await_first_audio

        self._fallback_service: Any | None = None
        self._start_frame: StartFrame | None = None
        self._degraded = False
        self._degraded_reason: str | None = None

        # Per-utterance first-audio tracking, keyed by audio context ID.
        self._first_audio_events: dict[str, asyncio.Event] = {}
        self._audio_seen_contexts: set[str] = set()
        # Set while ``_connect_websocket`` is running so the ``push_error``
        # upstream raises from a failed connect is not counted twice.
        self._in_connect = False

    # ------------------------------------------------------------- helpers

    @property
    def degraded(self) -> bool:
        """True once Fish has failed pre-audio and the fallback has taken over."""
        return self._degraded

    @property
    def fallback_available(self) -> bool:
        return self._fallback_factory is not None

    def _mark_degraded(self, reason: str) -> None:
        if not self._degraded:
            logger.warning(
                "fish_tts degraded: {} (call_id={})", reason, self._usage.call_id
            )
        self._degraded = True
        self._degraded_reason = reason

    def _record_failure(self, stage: FailureStage, context_id: str | None) -> None:
        first_audio_seen = bool(context_id and context_id in self._audio_seen_contexts)
        self._usage.record_error(first_audio_seen=first_audio_seen)
        if stage.is_pre_audio and not first_audio_seen and self._gate is not None:
            self._gate.record_pre_audio_failure()

    # ----------------------------------------------------------- lifecycle

    async def start(self, frame: StartFrame) -> None:
        self._start_frame = frame
        await super().start(frame)
        self._usage.requested_sample_rate = self.sample_rate
        logger.info(
            "fish_tts start {}",
            {
                **self._fish_config.redacted(),
                "sample_rate": self.sample_rate,
                "output_format": FISH_OUTPUT_FORMAT,
                "call_id": self._usage.call_id,
                "workflow_run_id": self._usage.workflow_run_id,
                "transport_type": self._usage.transport_type,
            },
        )

    async def stop(self, frame: EndFrame) -> None:
        await super().stop(frame)
        await self._stop_fallback(frame)
        logger.info("fish_tts usage {}", self._usage.to_metrics())

    async def cancel(self, frame: CancelFrame) -> None:
        watch = Stopwatch()
        await super().cancel(frame)
        await self._cancel_fallback(frame)
        self._usage.record_cancellation(watch.elapsed())
        logger.info("fish_tts usage {}", self._usage.to_metrics())

    # ------------------------------------------------------------- connect

    async def _connect_websocket(self) -> None:
        """Time the connect, retry it a bounded number of times, feed the gate.

        Upstream swallows connect exceptions and leaves ``_websocket`` as
        ``None``; that is the signal we key off, so this works regardless of
        how the fork reports the failure.
        """
        attempts = max(1, self._reliability.max_connect_retries + 1)
        for attempt in range(attempts):
            watch = Stopwatch()
            self._in_connect = True
            try:
                await super()._connect_websocket()
            finally:
                self._in_connect = False
            elapsed = watch.elapsed()
            reconnect = attempt > 0 or self._usage.connect_attempts > 0
            if self._websocket is not None:
                self._usage.record_connect(elapsed, reconnect=reconnect)
                return
            self._usage.record_connect(elapsed, reconnect=reconnect)
            self._record_failure(FailureStage.CONNECT, None)
            if attempt + 1 < attempts:
                # Bounded backoff — never an unbounded retry storm against a
                # provider that is already rate-limiting us.
                await asyncio.sleep(min(0.25 * (2**attempt), 2.0))
        logger.error(
            "fish_tts websocket connect failed after {} attempt(s) (call_id={})",
            attempts,
            self._usage.call_id,
        )

    # --------------------------------------------------------------- audio

    async def append_to_audio_context(self, context_id: str | None, frame: Any) -> None:
        """First-audio and chunk accounting for the current utterance."""
        audio = getattr(frame, "audio", None)
        if context_id and audio:
            if context_id not in self._audio_seen_contexts:
                self._audio_seen_contexts.add(context_id)
                event = self._first_audio_events.get(context_id)
                if event is not None:
                    event.set()
                if self._gate is not None:
                    self._gate.record_success()
            self._usage.record_audio_chunk(len(audio))
        await super().append_to_audio_context(context_id, frame)

    async def push_error(
        self, error_msg: str, exception: Exception | None = None, fatal: bool = False
    ) -> None:
        if self._in_connect:
            # Already accounted for by _connect_websocket.
            await super().push_error(error_msg, exception, fatal)
            return
        context_id = self.get_active_audio_context_id()
        stage = (
            FailureStage.SYNTHESIS_AFTER_AUDIO
            if context_id and context_id in self._audio_seen_contexts
            else FailureStage.SYNTHESIS_BEFORE_AUDIO
        )
        self._record_failure(stage, context_id)
        decision = decide_fallback(
            stage,
            first_audio_seen=stage is FailureStage.SYNTHESIS_AFTER_AUDIO,
            fallback_available=self.fallback_available,
        )
        if decision.degrade_subsequent_utterances:
            self._mark_degraded(decision.reason)
        await super().push_error(error_msg, exception, fatal)

    async def on_audio_context_interrupted(self, context_id: str) -> None:
        watch = Stopwatch()
        await super().on_audio_context_interrupted(context_id)
        self._first_audio_events.pop(context_id, None)
        self._usage.record_interruption(watch.elapsed())
        logger.debug(
            "fish_tts interrupted context={} cancel_latency_s={:.4f} call_id={}",
            context_id,
            watch.elapsed(),
            self._usage.call_id,
        )

    # ----------------------------------------------------------------- tts

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        """Synthesize one utterance, with pre-first-audio fallback only."""
        if self._degraded and self.fallback_available:
            async for frame in self._delegate_to_fallback(text, context_id, "already degraded"):
                yield frame
            return

        self._usage.record_submission(text)
        event = asyncio.Event()
        self._first_audio_events[context_id] = event

        # A connect that has already failed means zero audio has been emitted
        # for this utterance, so the whole utterance can safely go to the
        # fallback with no risk of speaking it twice.
        if self._websocket is None:
            await self._connect()
        if self._websocket is None:
            self._mark_degraded("fish websocket unavailable")
            if self.fallback_available:
                async for frame in self._delegate_to_fallback(
                    text, context_id, "connect failed before any audio"
                ):
                    yield frame
                return
            yield ErrorFrame(error="Fish Audio websocket unavailable and no fallback configured")
            return

        ttfb = Stopwatch()
        async for frame in super().run_tts(text, context_id):
            yield frame

        if not self._await_first_audio:
            return

        try:
            await asyncio.wait_for(event.wait(), timeout=self._reliability.ttfb_timeout_seconds)
        except asyncio.TimeoutError:
            self._record_failure(FailureStage.TIMEOUT_BEFORE_AUDIO, context_id)
            decision = decide_fallback(
                FailureStage.TIMEOUT_BEFORE_AUDIO,
                first_audio_seen=context_id in self._audio_seen_contexts,
                fallback_available=self.fallback_available,
            )
            self._mark_degraded(decision.reason)
            logger.warning(
                "fish_tts no audio within {} ms (call_id={}); {}",
                self._reliability.ttfb_timeout_ms,
                self._usage.call_id,
                decision.reason,
            )
            if decision.fallback_current_utterance:
                async for frame in self._delegate_to_fallback(
                    text, context_id, "ttfb timeout before any audio"
                ):
                    yield frame
            return
        except asyncio.CancelledError:
            # Interruption / call teardown. Nothing to replay, by design.
            raise
        else:
            self._usage.record_ttfb(ttfb.elapsed())
        finally:
            self._first_audio_events.pop(context_id, None)

    # ------------------------------------------------------------ fallback

    def _ensure_fallback(self) -> Any | None:
        if self._fallback_service is None and self._fallback_factory is not None:
            self._fallback_service = self._fallback_factory()
        return self._fallback_service

    async def _delegate_to_fallback(
        self, text: str, context_id: str, reason: str
    ) -> AsyncGenerator[Frame | None, None]:
        """Speak one utterance through the fallback provider.

        Only ever called when Fish has emitted **zero** audio for
        ``context_id``, so the caller cannot hear the sentence twice.
        """
        service = self._ensure_fallback()
        if service is None:
            yield ErrorFrame(error=f"Fish Audio failed ({reason}) and no fallback is configured")
            return

        self._usage.record_fallback()
        logger.warning(
            "fish_tts falling back to {} for one utterance: {} (call_id={})",
            type(service).__name__,
            reason,
            self._usage.call_id,
        )
        if self._start_frame is not None and not getattr(service, "_fish_started", False):
            await service.start(self._start_frame)
            setattr(service, "_fish_started", True)
        async for frame in service.run_tts(text, context_id):
            yield frame

    async def _stop_fallback(self, frame: EndFrame) -> None:
        if self._fallback_service is not None:
            try:
                await self._fallback_service.stop(frame)
            except Exception as exc:  # pragma: no cover - defensive teardown
                logger.debug("fish_tts fallback stop failed: {}", exc)

    async def _cancel_fallback(self, frame: CancelFrame) -> None:
        if self._fallback_service is not None:
            try:
                await self._fallback_service.cancel(frame)
            except Exception as exc:  # pragma: no cover - defensive teardown
                logger.debug("fish_tts fallback cancel failed: {}", exc)


# --------------------------------------------------------------------------
# Factory
# --------------------------------------------------------------------------


def _accepted_kwargs(cls: type) -> set[str]:
    """Every keyword name accepted anywhere in ``cls``'s ``__init__`` chain.

    Dograh runs a Pipecat *fork*; a kwarg such as ``skip_aggregator_types``
    that exists upstream may not exist there. Passing an unknown kwarg would
    explode deep inside ``AIService``, so unknown ones are dropped with a
    warning instead.
    """
    names: set[str] = set()
    for klass in cls.__mro__:
        init = klass.__dict__.get("__init__")
        if init is None:
            continue
        try:
            signature = inspect.signature(init)
        except (TypeError, ValueError):  # pragma: no cover - builtins
            continue
        for name, param in signature.parameters.items():
            if name == "self" or param.kind is inspect.Parameter.VAR_KEYWORD:
                continue
            names.add(name)
    return names


def create_fish_tts_service(
    config: FishTTSConfig,
    *,
    sample_rate: int,
    usage: FishTTSUsage | None = None,
    gate: FishHealthGate | None = None,
    reliability: FishReliabilityConfig | None = None,
    fallback_factory: Callable[[], Any] | None = None,
    service_cls: type = InstrumentedFishAudioTTSService,
    **extra_kwargs: Any,
) -> InstrumentedFishAudioTTSService:
    """Build the Fish TTS service for one call.

    Args:
        config: Resolved per-agent Fish settings. Validated here — a bad
            config fails at service construction, not mid-call.
        sample_rate: Transport output rate. Pass
            ``audio_config.transport_out_sample_rate``; do not hardcode.
        extra_kwargs: Pipecat ``TTSService`` kwargs used by Dograh
            (``text_filters``, ``skip_aggregator_types``, ``silence_time_s``,
            ``transport_destination``, …). Unknown names are dropped.
    """
    config.require_valid()
    if not sample_rate or sample_rate <= 0:
        raise FishConfigError(f"sample_rate must be a positive int, got {sample_rate!r}")

    usage = usage or FishTTSUsage()
    usage.provider = FISH_PROVIDER_ID
    usage.model = config.model
    usage.voice = config.voice
    usage.voice_fingerprint = config.voice_fingerprint()
    usage.requested_sample_rate = sample_rate

    accepted = _accepted_kwargs(service_cls)
    passthrough: dict[str, Any] = {}
    for name, value in extra_kwargs.items():
        if name in accepted:
            passthrough[name] = value
        else:
            logger.warning(
                "fish_tts: dropping unsupported TTSService kwarg {!r} "
                "(not present in the installed pipecat)",
                name,
            )

    return service_cls(
        fish_config=config,
        usage=usage,
        gate=gate,
        reliability=reliability,
        fallback_factory=fallback_factory,
        api_key=config.api_key,
        output_format=FISH_OUTPUT_FORMAT,
        sample_rate=sample_rate,
        settings=FishAudioTTSSettings(**config.settings_kwargs()),
        **passthrough,
    )


def create_fish_tts_service_from_dograh(
    user_config: Any,
    audio_config: Any,
    *,
    org_default_voice: str | None = None,
    org_default_api_key: str | None = None,
    **kwargs: Any,
) -> InstrumentedFishAudioTTSService:
    """Adapter for Dograh's service factory.

    Mirrors the shape of the other provider branches in
    ``api/services/pipecat/service_factory.py``::

        elif user_config.tts.provider == ServiceProviders.FISH.value:
            return create_fish_tts_service_from_dograh(
                user_config, audio_config,
                text_filters=[xml_function_tag_filter],
                skip_aggregator_types=["recording_router", "recording"],
                silence_time_s=1.0,
            )
    """
    config = FishTTSConfig.from_mapping(
        getattr(user_config, "tts", user_config),
        org_default_voice=org_default_voice,
        org_default_api_key=org_default_api_key,
    )
    return create_fish_tts_service(
        config,
        sample_rate=resolve_output_sample_rate(audio_config),
        **kwargs,
    )
