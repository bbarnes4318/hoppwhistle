"""Render a Fish voice preview through the *production* code path.

The point of this tool is that a preview must not be a separate legacy
endpoint that produces different speech from the live agent. It builds the
same :func:`create_fish_tts_service` the service factory builds, with the same
model, voice, speed, latency, normalization, temperature and top-p, and writes
the resulting PCM to a WAV file.

Two preview modes, because browser audio is not what the caller hears:

* ``--sample-rate 16000`` — browser preview (or whatever WebRTC negotiates).
* ``--sample-rate 8000``  — telephone-quality preview: Fish is asked for 8 kHz
  directly, exactly as it is on an Asterisk ARI call, so the preview carries
  the same band-limiting the callee will hear.

``--both`` writes one file per rate for side-by-side comparison.

This is the only script in the kit that spends Fish credit; it needs
``FISH_AUDIO_API_KEY``. It never prints the key.

Example::

    FISH_AUDIO_API_KEY=... python preview_fish_voice.py \\
        --voice <fish-reference-id> \\
        --text "Hi, this is Sarah with the final expense benefits department." \\
        --both --out-dir ./previews
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import wave
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fish_config import FISH_API_KEY_SETTING, FishTTSConfig  # noqa: E402
from fish_metrics import FishTTSUsage  # noqa: E402

BROWSER_SAMPLE_RATE = 16000
TELEPHONE_SAMPLE_RATE = 8000


async def synthesize(config: FishTTSConfig, text: str, sample_rate: int) -> tuple[bytes, dict]:
    """Run one utterance through the real service and return (pcm, metrics)."""
    from pipecat.clocks.system_clock import SystemClock
    from pipecat.frames.frames import EndFrame, StartFrame
    from pipecat.processors.frame_processor import FrameProcessorSetup
    from pipecat.utils.asyncio.task_manager import TaskManager

    from fish_service import create_fish_tts_service

    usage = FishTTSUsage(call_id="preview", transport_type=f"preview-{sample_rate}")
    service = create_fish_tts_service(config, sample_rate=sample_rate, usage=usage)

    captured = bytearray()
    original_append = service.append_to_audio_context

    async def capture(context_id, frame):
        audio = getattr(frame, "audio", None)
        if audio:
            captured.extend(audio)
        await original_append(context_id, frame)

    service.append_to_audio_context = capture  # type: ignore[method-assign]

    task_manager = TaskManager(loop=asyncio.get_running_loop())
    await service.setup(
        FrameProcessorSetup(
            clock=SystemClock(), task_manager=task_manager, pipeline_worker=MagicMock()
        )
    )

    async def _noop_push(frame, direction=None):
        return None

    service.push_frame = _noop_push  # type: ignore[method-assign]

    await service.start(StartFrame(audio_out_sample_rate=sample_rate))
    context_id = "preview-ctx"
    await service.create_audio_context(context_id)
    service._turn_context_id = context_id
    async for _ in service.run_tts(text, context_id):
        pass
    # Let the receive task drain the tail of the utterance.
    for _ in range(80):
        await asyncio.sleep(0.05)
        if captured and usage.audio_chunks and not service._websocket:
            break
    await asyncio.sleep(0.5)
    await service.stop(EndFrame())
    return bytes(captured), usage.to_metrics()


def write_wav(path: str, pcm: bytes, sample_rate: int) -> None:
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", help="Fish reference ID (default: $FISH_AUDIO_DEFAULT_VOICE_ID)")
    parser.add_argument("--model", default=None)
    parser.add_argument("--speed", type=float, default=None)
    parser.add_argument("--latency", default=None)
    parser.add_argument("--volume", type=int, default=None)
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument("--top-p", type=float, default=None)
    parser.add_argument("--normalize", default=None)
    parser.add_argument("--sample-rate", type=int, default=TELEPHONE_SAMPLE_RATE)
    parser.add_argument("--both", action="store_true", help="render 8 kHz and 16 kHz")
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()

    api_key = os.environ.get(FISH_API_KEY_SETTING)
    if not api_key:
        raise SystemExit(f"{FISH_API_KEY_SETTING} is not set")

    raw = {
        "api_key": api_key,
        "voice": args.voice or os.environ.get("FISH_AUDIO_DEFAULT_VOICE_ID"),
    }
    for name, value in (
        ("model", args.model),
        ("speed", args.speed),
        ("latency", args.latency),
        ("volume", args.volume),
        ("temperature", args.temperature),
        ("top_p", args.top_p),
        ("normalize", args.normalize),
    ):
        if value is not None:
            raw[name] = value

    config = FishTTSConfig.from_mapping(raw).require_valid()
    rates = [TELEPHONE_SAMPLE_RATE, BROWSER_SAMPLE_RATE] if args.both else [args.sample_rate]

    os.makedirs(args.out_dir, exist_ok=True)
    for rate in rates:
        pcm, metrics = await synthesize(config, args.text, rate)
        label = "telephone-8k" if rate == TELEPHONE_SAMPLE_RATE else f"{rate // 1000}k"
        path = os.path.join(args.out_dir, f"fish-preview-{label}.wav")
        write_wav(path, pcm, rate)
        print(
            f"{path}  bytes={len(pcm)}  seconds={metrics['audio_duration_seconds']}  "
            f"ttfb_p50={metrics['ttfb_p50_seconds']}  chunks={metrics['audio_chunks']}  "
            f"utf8_bytes={metrics['utf8_bytes_submitted']}  "
            f"est_cost_usd={metrics['estimated_cost_usd']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
