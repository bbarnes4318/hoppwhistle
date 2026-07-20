"""A minimal free, local (CPU) Piper text-to-speech plugin for LiveKit Agents.

Wraps piper-tts as a non-streaming LiveKit `tts.TTS` so the Protoface avatar can
lip-sync to it. No external API key or cost.
"""
from __future__ import annotations

import os

from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions

try:
    from piper import PiperVoice  # piper-tts >= 1.2
except Exception:  # pragma: no cover
    PiperVoice = None  # type: ignore

_MODEL = os.getenv("PIPER_VOICE_MODEL", "/models/en_US-lessac-medium.onnx")
_SR = int(os.getenv("PIPER_SAMPLE_RATE", "22050"))


class PiperTTS(tts.TTS):
    def __init__(self) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=_SR,
            num_channels=1,
        )
        if PiperVoice is None:
            raise RuntimeError("piper-tts is not installed")
        self._voice = PiperVoice.load(_MODEL)

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "PiperChunkedStream":
        return PiperChunkedStream(
            tts=self, input_text=text, conn_options=conn_options, voice=self._voice
        )


class PiperChunkedStream(tts.ChunkedStream):
    def __init__(self, *, tts: PiperTTS, input_text: str, conn_options, voice) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._voice = voice

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        output_emitter.initialize(
            request_id="piper",
            sample_rate=_SR,
            num_channels=1,
            mime_type="audio/pcm",
        )
        # piper-tts >= 1.3 yields AudioChunk objects (one per sentence); each
        # exposes the raw int16 PCM for the requested text.
        for chunk in self._voice.synthesize(self._input_text):
            output_emitter.push(bytes(chunk.audio_int16_bytes))
        output_emitter.flush()
