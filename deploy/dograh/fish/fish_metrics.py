"""Structured Fish Audio TTS usage, latency and cost accounting.

Pure python so it is unit-testable without pipecat and reusable by the audit
and reporting scripts.

Billing note: Fish bills on **UTF-8 bytes submitted**, not characters and not
connected call minutes. Both counters are tracked because they diverge for any
non-ASCII text (names, currency symbols, smart quotes), and the cost record
must never be derived from call duration.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

#: Bytes per PCM sample at the bit depth Pipecat's Fish service emits.
PCM_BYTES_PER_SAMPLE = 2
PCM_CHANNELS = 1

#: Default list price, USD per million UTF-8 bytes submitted. Overridable so
#: the deployment can track its negotiated rate without a code change.
DEFAULT_FISH_USD_PER_MILLION_BYTES = 15.0


def utf8_bytes(text: str) -> int:
    """UTF-8 byte length — Fish's billing unit."""
    return len(text.encode("utf-8"))


def pcm_duration_seconds(byte_count: int, sample_rate: int) -> float:
    """Audio seconds represented by ``byte_count`` of mono 16-bit PCM."""
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    return byte_count / (sample_rate * PCM_BYTES_PER_SAMPLE * PCM_CHANNELS)


def estimate_fish_cost_usd(
    submitted_bytes: int,
    *,
    usd_per_million_bytes: float = DEFAULT_FISH_USD_PER_MILLION_BYTES,
) -> float:
    """Cost for the submitted text. Never a function of call duration."""
    return (submitted_bytes / 1_000_000.0) * usd_per_million_bytes


@dataclass
class FishTTSUsage:
    """Per-call Fish TTS accounting record.

    One instance per TTS service instance (i.e. per call), so the totals line
    up with a single ``workflow_run``.
    """

    # ------------------------------------------------------------- identity
    provider: str = "fish"
    model: str = ""
    voice_fingerprint: str | None = None
    voice: str | None = None
    transport_type: str | None = None
    requested_sample_rate: int | None = None

    call_id: str | None = None
    workflow_run_id: str | None = None
    agent_id: str | None = None
    campaign_id: str | None = None
    organization_id: str | None = None

    # -------------------------------------------------------------- volumes
    characters_submitted: int = 0
    utf8_bytes_submitted: int = 0
    utterances: int = 0
    audio_chunks: int = 0
    audio_bytes: int = 0

    # -------------------------------------------------------------- latency
    connect_attempts: int = 0
    connect_seconds: list[float] = field(default_factory=list)
    ttfb_seconds: list[float] = field(default_factory=list)
    synthesis_seconds: float = 0.0
    cancellation_seconds: list[float] = field(default_factory=list)

    # --------------------------------------------------------- reliability
    interruptions: int = 0
    cancellations: int = 0
    reconnects: int = 0
    errors: int = 0
    errors_before_first_audio: int = 0
    errors_after_partial_audio: int = 0
    fallback_activations: int = 0

    # ---------------------------------------------------------------- costs
    usd_per_million_bytes: float = DEFAULT_FISH_USD_PER_MILLION_BYTES

    # ------------------------------------------------------------ recorders

    def record_submission(self, text: str) -> None:
        self.utterances += 1
        self.characters_submitted += len(text)
        self.utf8_bytes_submitted += utf8_bytes(text)

    def record_audio_chunk(self, byte_count: int) -> None:
        self.audio_chunks += 1
        self.audio_bytes += byte_count

    def record_connect(self, seconds: float, *, reconnect: bool = False) -> None:
        self.connect_attempts += 1
        self.connect_seconds.append(seconds)
        if reconnect:
            self.reconnects += 1

    def record_ttfb(self, seconds: float) -> None:
        self.ttfb_seconds.append(seconds)

    def record_error(self, *, first_audio_seen: bool) -> None:
        self.errors += 1
        if first_audio_seen:
            self.errors_after_partial_audio += 1
        else:
            self.errors_before_first_audio += 1

    def record_interruption(self, cancellation_seconds: float | None = None) -> None:
        self.interruptions += 1
        if cancellation_seconds is not None:
            self.cancellation_seconds.append(cancellation_seconds)

    def record_cancellation(self, cancellation_seconds: float | None = None) -> None:
        self.cancellations += 1
        if cancellation_seconds is not None:
            self.cancellation_seconds.append(cancellation_seconds)

    def record_fallback(self) -> None:
        self.fallback_activations += 1

    # ------------------------------------------------------------- derived

    @property
    def audio_duration_seconds(self) -> float:
        if not self.requested_sample_rate:
            return 0.0
        return pcm_duration_seconds(self.audio_bytes, self.requested_sample_rate)

    @property
    def estimated_cost_usd(self) -> float:
        return estimate_fish_cost_usd(
            self.utf8_bytes_submitted, usd_per_million_bytes=self.usd_per_million_bytes
        )

    def to_metrics(self) -> dict[str, Any]:
        """Log/metric-safe dict. Contains no API key and no caller PII.

        ``voice`` is included only because it is an opaque Fish reference ID;
        pipelines that must not carry raw IDs should use
        ``voice_fingerprint`` and drop ``voice``.
        """
        data = asdict(self)
        data["audio_duration_seconds"] = round(self.audio_duration_seconds, 4)
        data["estimated_cost_usd"] = round(self.estimated_cost_usd, 6)
        data["ttfb_p50_seconds"] = _percentile(self.ttfb_seconds, 50)
        data["ttfb_p95_seconds"] = _percentile(self.ttfb_seconds, 95)
        data["ttfb_p99_seconds"] = _percentile(self.ttfb_seconds, 99)
        data["connect_p95_seconds"] = _percentile(self.connect_seconds, 95)
        return data


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 4)
    rank = (pct / 100.0) * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return round(ordered[low] * (1 - weight) + ordered[high] * weight, 4)


class Stopwatch:
    """Monotonic elapsed-time helper (``time.monotonic``, never wall clock)."""

    __slots__ = ("_start",)

    def __init__(self) -> None:
        self._start = time.monotonic()

    def reset(self) -> None:
        self._start = time.monotonic()

    def elapsed(self) -> float:
        return time.monotonic() - self._start
