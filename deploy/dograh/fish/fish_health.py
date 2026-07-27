"""Fish TTS reliability: fallback policy, circuit breaker, canary routing.

Pure python, no pipecat import, so the rules are unit-testable in isolation
and identical whether they are consulted from the service factory (which
provider do we build for this call?) or from inside a live TTS service (may
this failure fall back?).

The single rule that everything else serves:

    Fallback is allowed only while Fish has emitted **no audio** for the
    current utterance. Once any audio has reached the caller, the utterance is
    aborted cleanly and never replayed through another provider — replaying it
    would speak the sentence twice.
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable

DEFAULT_TTFB_TIMEOUT_MS = 2500
DEFAULT_MAX_CONNECT_RETRIES = 1
DEFAULT_FAILURE_THRESHOLD = 3
DEFAULT_OPEN_SECONDS = 60.0


class FailureStage(str, Enum):
    """Where a Fish failure happened relative to the first audio byte."""

    CONNECT = "connect"
    AUTH = "auth"
    TIMEOUT_BEFORE_AUDIO = "timeout_before_audio"
    SYNTHESIS_BEFORE_AUDIO = "synthesis_before_audio"
    SYNTHESIS_AFTER_AUDIO = "synthesis_after_audio"

    @property
    def is_pre_audio(self) -> bool:
        return self is not FailureStage.SYNTHESIS_AFTER_AUDIO


@dataclass(frozen=True)
class FallbackDecision:
    """Outcome of consulting the fallback policy for one failure."""

    fallback_current_utterance: bool
    degrade_subsequent_utterances: bool
    reason: str

    @property
    def replays_audio(self) -> bool:
        """True if acting on this decision could speak the same text twice."""
        return False


def decide_fallback(
    stage: FailureStage,
    *,
    first_audio_seen: bool,
    fallback_available: bool,
) -> FallbackDecision:
    """Apply the critical fallback rule to a single Fish failure."""
    if first_audio_seen or stage is FailureStage.SYNTHESIS_AFTER_AUDIO:
        return FallbackDecision(
            fallback_current_utterance=False,
            degrade_subsequent_utterances=fallback_available,
            reason=(
                "fish already emitted audio for this utterance; aborting cleanly "
                "without replay"
            ),
        )
    if not fallback_available:
        return FallbackDecision(
            fallback_current_utterance=False,
            degrade_subsequent_utterances=False,
            reason="no fallback provider configured",
        )
    return FallbackDecision(
        fallback_current_utterance=True,
        degrade_subsequent_utterances=True,
        reason=f"fish failed at {stage.value} before any audio",
    )


class FishHealthGate:
    """Circuit breaker over Fish's *pre-audio* failures.

    Only failures that happen before audio count: a mid-utterance failure is
    already handled by aborting that utterance, and letting it trip the
    breaker would make one bad sentence divert every subsequent call.

    Opening the breaker changes which provider the service factory *builds*
    for new calls; it never switches a provider underneath a call that is
    already speaking.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = DEFAULT_FAILURE_THRESHOLD,
        open_seconds: float = DEFAULT_OPEN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be >= 1")
        self._failure_threshold = failure_threshold
        self._open_seconds = open_seconds
        self._clock = clock
        self._consecutive_failures = 0
        self._opened_at: float | None = None
        self._open_count = 0

    # ------------------------------------------------------------- signals

    def record_success(self) -> None:
        """Fish produced audio. Closes the breaker."""
        self._consecutive_failures = 0
        self._opened_at = None

    def record_pre_audio_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self._failure_threshold and self._opened_at is None:
            self._opened_at = self._clock()
            self._open_count += 1

    # --------------------------------------------------------------- state

    def is_open(self) -> bool:
        """True while new calls should be built on the fallback provider."""
        if self._opened_at is None:
            return False
        if self._clock() - self._opened_at >= self._open_seconds:
            # Half-open: let the next call try Fish again.
            self._opened_at = None
            self._consecutive_failures = 0
            return False
        return True

    @property
    def consecutive_failures(self) -> int:
        return self._consecutive_failures

    @property
    def open_count(self) -> int:
        return self._open_count

    def snapshot(self) -> dict:
        return {
            "open": self.is_open(),
            "consecutive_pre_audio_failures": self._consecutive_failures,
            "failure_threshold": self._failure_threshold,
            "open_seconds": self._open_seconds,
            "times_opened": self._open_count,
        }


@dataclass
class FishReliabilityConfig:
    """Deployment knobs for the Fish rollout.

    Read from Dograh's own configuration when the deployment stores provider
    settings in the database; the environment variables exist so the rollout
    can be driven without a schema change and so a rollback is a single
    setting flip.
    """

    primary_provider: str = "fish"
    fallback_provider: str | None = None
    ttfb_timeout_ms: int = DEFAULT_TTFB_TIMEOUT_MS
    max_connect_retries: int = DEFAULT_MAX_CONNECT_RETRIES
    canary_percent: float = 100.0
    failure_threshold: int = DEFAULT_FAILURE_THRESHOLD
    open_seconds: float = DEFAULT_OPEN_SECONDS

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "FishReliabilityConfig":
        src = os.environ if env is None else env

        def _num(name: str, default: float) -> float:
            raw = src.get(name)
            if raw in (None, ""):
                return default
            try:
                return float(raw)
            except ValueError:
                return default

        fallback = src.get("FALLBACK_TTS_PROVIDER") or None
        return cls(
            primary_provider=(src.get("PRIMARY_TTS_PROVIDER") or "fish").strip().lower(),
            fallback_provider=fallback.strip().lower() if fallback else None,
            ttfb_timeout_ms=int(_num("FISH_TTS_TTFB_TIMEOUT_MS", DEFAULT_TTFB_TIMEOUT_MS)),
            max_connect_retries=int(
                _num("FISH_TTS_MAX_CONNECT_RETRIES", DEFAULT_MAX_CONNECT_RETRIES)
            ),
            canary_percent=_num("FISH_TTS_CANARY_PERCENT", 100.0),
            failure_threshold=int(_num("FISH_TTS_FAILURE_THRESHOLD", DEFAULT_FAILURE_THRESHOLD)),
            open_seconds=_num("FISH_TTS_BREAKER_OPEN_SECONDS", DEFAULT_OPEN_SECONDS),
        )

    @property
    def ttfb_timeout_seconds(self) -> float:
        return self.ttfb_timeout_ms / 1000.0


def in_canary(bucket_key: str, canary_percent: float) -> bool:
    """Deterministic canary bucketing.

    Stable for a given key, so a call (or an agent, if the agent ID is used as
    the key) does not flip providers between retries. 0 routes nothing to
    Fish, 100 routes everything.
    """
    if canary_percent <= 0:
        return False
    if canary_percent >= 100:
        return True
    digest = hashlib.sha256(bucket_key.encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % 10_000
    return bucket < canary_percent * 100


def select_tts_provider(
    *,
    configured_provider: str,
    reliability: FishReliabilityConfig,
    gate: FishHealthGate | None = None,
    bucket_key: str | None = None,
) -> tuple[str, str]:
    """Pick the provider to *build* for a new call.

    Returns ``(provider, reason)``. Only diverts away from Fish; a workflow
    explicitly configured for another provider is left alone.
    """
    provider = (configured_provider or "").strip().lower()
    if provider != "fish":
        return provider, "workflow provider is not fish"

    fallback = reliability.fallback_provider
    if gate is not None and gate.is_open():
        if fallback:
            return fallback, "fish circuit breaker open"
        return provider, "fish circuit breaker open but no fallback configured"

    if bucket_key is not None and not in_canary(bucket_key, reliability.canary_percent):
        if fallback:
            return fallback, f"outside fish canary ({reliability.canary_percent}%)"
        return provider, "outside fish canary but no fallback configured"

    return provider, "fish primary"
