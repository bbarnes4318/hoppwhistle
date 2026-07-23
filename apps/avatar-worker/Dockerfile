FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Free, CPU-friendly Piper voice (natural US English).
RUN mkdir -p /models \
  && curl -fsSL -o /models/en_US-lessac-medium.onnx \
     https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
  && curl -fsSL -o /models/en_US-lessac-medium.onnx.json \
     https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Preload the Silero VAD used by the agent runtime (avoids first-request stall).
RUN python -c "from livekit.plugins import silero; silero.VAD.load()" || true

COPY worker.py piper_tts.py ./

ENV PIPER_VOICE_MODEL=/models/en_US-lessac-medium.onnx

# Registers with LiveKit and waits for avatar dispatches.
CMD ["python", "worker.py", "start"]
