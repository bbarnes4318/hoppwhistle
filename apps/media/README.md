# Transcription Service

Self-hosted STT (Speech-to-Text) pipeline using WhisperX/Whisper.cpp.

## Architecture

- **Node Worker** (`apps/media/transcriber`): Consumes `recording.ready` events from Redis Streams, delegates transcription to Python sidecar
- **Python Sidecar** (`apps/media/python`): Refactored from `fefast4.poy`, provides stdio JSON API for transcription
- **Postgres Storage**: Stores transcripts with trigram search support
- **Event-Driven**: Uses Redis Streams for reliable event processing

## Components

### Python Sidecar

Located in `apps/media/python/`:

- `fefast4.py`: Core transcription logic (refactored from root `fefast4.poy`)
- `main.py`: stdio JSON interface
- Supports WhisperX (GPU/CPU) and Whisper.cpp fallback
- Optional diarization (requires HuggingFace token)
- Optional DeepSeek analysis (requires API key)

### Node Worker

Located in `apps/media/transcriber/`:

- Consumes `recording.ready` events
- Spawns Python process for transcription
- Stores results in Postgres
- Emits `transcription.ready` events
- Implements retry logic with exponential backoff
- Idempotency via Redis keys

## Event Flow

### Inbound: `recording.ready`

```json
{
  "event": "recording.ready",
  "tenantId": "t_123",
  "data": {
    "callId": "c_abc",
    "recordingUrl": "https://.../recording.wav",
    "format": "wav",
    "durationSec": 742,
    "metadata": {}
  }
}
```

### Outbound: `transcription.ready`

```json
{
  "event": "transcription.ready",
  "tenantId": "t_123",
  "data": {
    "callId": "c_abc",
    "transcriptId": "tr_123",
    "stats": {
      "segments": 218,
      "words": 4832,
      "speakerLabels": true,
      "latencyMs": 29850
    }
  }
}
```

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL with pg_trgm extension
- Redis
- FFmpeg (for audio processing)

### Python Dependencies

```bash
cd apps/media/python
pip install -r requirements.txt
```

### Node Dependencies

```bash
cd apps/media/transcriber
npm install
```

### Database Migration

```bash
cd apps/api
npm run db:migrate
```

This creates:

- `transcripts` table
- `transcript_segments` table
- `transcript_analysis` table
- Trigram indexes for fuzzy search

## Configuration

### Environment Variables

**Python Sidecar:**

- `HUGGINGFACE_TOKEN`: Optional, for diarization
- `DEEPSEEK_API_KEY`: Optional, for analysis
- `WHISPER_CPP_MODEL`: Model size (tiny/small/medium, default: tiny)
- `TRANSCRIBE_TMP`: Temp directory (default: /tmp/transcriber)

**Node Worker:**

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `TRANSCRIBE_MAX_CONCURRENCY`: Max concurrent jobs (default: 2)
- `TRANSCRIBE_MAX_DURATION_SEC`: Max recording duration (default: 7200)
- `TRANSCRIBE_ENGINE_PREF`: Preferred engine (whisperx/whispercpp)
- `PYTHON_BIN`: Python binary path (default: python)
- `PY_SVC_TIMEOUT_MS`: Timeout in milliseconds (default: 900000)

## Usage

### Start Services

```bash
# Start Python sidecar
cd apps/media/python
python main.py

# Start Node worker
cd apps/media/transcriber
npm run dev
```

### Docker Compose

```bash
cd infra/docker
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Test Transcription

```bash
# Send a recording.ready event
redis-cli XADD events:stream '*' channel 'recording.*' payload '{"event":"recording.ready","tenantId":"test","data":{"callId":"test-123","recordingUrl":"https://example.com/test.wav","format":"wav"}}'
```

### API Endpoints

**Get Transcript:**

```http
GET /api/v1/calls/:callId/transcript
```

**List Transcripts:**

```http
GET /api/v1/transcripts?q=search+query&page=1&limit=20
```

## Python API Contract

### Input (stdin)

```json
{
  "job": "transcribe",
  "recordingUrl": "https://.../file.wav",
  "options": {
    "prefer": "whisperx",
    "fallback": "whispercpp",
    "diarize": true,
    "model": "tiny"
  }
}
```

### Output (stdout)

**Success:**

```json
{
  "ok": true,
  "engine": "whisperx",
  "language": "en",
  "durationSec": 742,
  "segments": [
    {
      "start": 0.12,
      "end": 2.84,
      "speaker": "SPEAKER_00",
      "text": "..."
    }
  ],
  "fullText": "entire transcript...",
  "stats": {
    "numSegments": 218,
    "numChars": 23045
  },
  "analysis": {
    "billable": "Yes",
    "applicationSubmitted": "No",
    "reasoning": "..."
  }
}
```

**Error:**

```json
{
  "ok": false,
  "error": "Message",
  "stage": "download|transcribe|align|diarize|analyze"
}
```

## Testing

### Unit Tests

```bash
cd apps/media/transcriber
npm test
```

### Integration Tests

```bash
cd apps/media
npm test
```

### Long File Test

Place a sample long WAV file (>30 minutes) at:
`apps/media/__tests__/assets/sample_long.wav`

Then run:

```bash
TEST_LONG_FILE_URL=file:///path/to/sample_long.wav npm test
```

## Features

- ✅ WhisperX with GPU support (falls back to CPU)
- ✅ Whisper.cpp fallback
- ✅ Speaker diarization (optional)
- ✅ DeepSeek analysis (optional)
- ✅ Long file support (chunking/streaming)
- ✅ Retry logic with exponential backoff
- ✅ Idempotency (prevents duplicate transcriptions)
- ✅ Trigram search for fuzzy text matching
- ✅ Segment-level storage with timestamps
- ✅ Analysis storage (billable, application submitted)

## Troubleshooting

### Python Process Fails

- Check Python binary path (`PYTHON_BIN`)
- Verify dependencies installed (`pip install -r requirements.txt`)
- Check FFmpeg availability
- Review Python stderr logs

### Transcription Timeout

- Increase `PY_SVC_TIMEOUT_MS`
- Check network connectivity for recording URL
- Verify file size/duration within limits

### No Transcription Events

- Verify Redis connection
- Check consumer group exists
- Review worker logs for errors
- Ensure `recording.ready` events are being published

### Database Errors

- Run migration: `npm run db:migrate`
- Verify pg_trgm extension: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- Check database connection string
