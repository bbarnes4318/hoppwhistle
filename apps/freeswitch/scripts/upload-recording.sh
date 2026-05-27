#!/bin/bash
# Upload recording to Hopwhistle API
# Called by FreeSWITCH api_hangup_hook after call ends.
# The recording file may still be being finalized when this runs,
# so we wait briefly and retry to ensure a complete upload.

RECORDING_FILE="$1"
CALL_ID="$2"

LOG_PREFIX="[upload-recording]"

log() {
  echo "${LOG_PREFIX} $*"
}

if [ -z "$RECORDING_FILE" ] || [ -z "$CALL_ID" ]; then
  log "ERROR: Usage: $0 <recording_file> <call_id>"
  exit 1
fi

API_URL="${API_URL:-http://api:3001}"
API_KEY="${API_KEY:-}"

# Wait for the recording file to appear and stabilize.
# record_session may still be flushing when the hangup hook fires.
MAX_WAIT=10
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if [ -f "$RECORDING_FILE" ]; then
    # Check file size is non-zero and stable (not still being written)
    SIZE1=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || stat -f%z "$RECORDING_FILE" 2>/dev/null || echo "0")
    sleep 1
    SIZE2=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || stat -f%z "$RECORDING_FILE" 2>/dev/null || echo "0")
    if [ "$SIZE1" = "$SIZE2" ] && [ "$SIZE1" != "0" ]; then
      log "Recording file ready: ${RECORDING_FILE} (${SIZE2} bytes)"
      break
    fi
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ ! -f "$RECORDING_FILE" ]; then
  log "ERROR: Recording file not found after ${MAX_WAIT}s: $RECORDING_FILE"
  # Notify API that recording failed
  curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"error\", \"error\": \"Recording file not found: ${RECORDING_FILE}\"}" || true
  exit 1
fi

FILE_SIZE=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || stat -f%z "$RECORDING_FILE" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" = "0" ]; then
  log "ERROR: Recording file is empty: $RECORDING_FILE"
  curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"error\", \"error\": \"Recording file is empty\"}" || true
  rm -f "$RECORDING_FILE"
  exit 1
fi

# Extract format
FILENAME=$(basename "$RECORDING_FILE")
EXTENSION="${FILENAME##*.}"

log "Uploading recording for call ${CALL_ID} (${FILE_SIZE} bytes) to ${API_URL}"

# Upload with retry logic (3 attempts)
MAX_RETRIES=3
ATTEMPT=1
HTTP_CODE=""
BODY=""

while [ $ATTEMPT -le $MAX_RETRIES ]; do
  if [ -n "$API_KEY" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${API_URL}/api/v1/recordings/upload" \
      -H "X-API-Key: ${API_KEY}" \
      -F "callId=${CALL_ID}" \
      -F "format=${EXTENSION}" \
      -F "file=@${RECORDING_FILE}" 2>&1)
  else
    RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 30 -X POST "${API_URL}/api/v1/recordings/upload" \
      -F "callId=${CALL_ID}" \
      -F "format=${EXTENSION}" \
      -F "file=@${RECORDING_FILE}" 2>&1)
  fi

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    log "SUCCESS: Recording uploaded for call ${CALL_ID} (attempt ${ATTEMPT})"
    log "Response: ${BODY}"
    rm -f "$RECORDING_FILE"
    exit 0
  fi

  log "WARN: Upload attempt ${ATTEMPT}/${MAX_RETRIES} failed (HTTP ${HTTP_CODE})"
  ATTEMPT=$((ATTEMPT + 1))
  [ $ATTEMPT -le $MAX_RETRIES ] && sleep 2
done

log "ERROR: Upload failed after ${MAX_RETRIES} attempts (HTTP ${HTTP_CODE})"
log "Response: ${BODY}"

# Notify API that recording upload failed
curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"error\", \"error\": \"Upload failed after ${MAX_RETRIES} attempts (HTTP ${HTTP_CODE})\"}" || true
exit 1
