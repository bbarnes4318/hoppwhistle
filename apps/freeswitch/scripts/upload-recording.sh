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

API_URL="${API_URL:-http://api:3001}"
API_KEY="${API_KEY:-}"

# Check API KEY presence without printing it
API_KEY_PRESENT="no"
if [ -n "$API_KEY" ]; then
  API_KEY_PRESENT="yes"
fi

# Check if file exists
FILE_EXISTS="no"
if [ -f "$RECORDING_FILE" ]; then
  FILE_EXISTS="yes"
fi

# Get size
FILE_SIZE=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || stat -f%z "$RECORDING_FILE" 2>/dev/null || echo "0")

# Detailed initial log
log "START DIAGNOSTICS: file_path=$RECORDING_FILE, call_id=$CALL_ID, file_exists=$FILE_EXISTS, file_size=$FILE_SIZE, api_url=$API_URL, api_key_present=$API_KEY_PRESENT"

if [ -z "$RECORDING_FILE" ] || [ -z "$CALL_ID" ]; then
  log "ERROR: Usage: $0 <recording_file> <call_id>"
  exit 1
fi

# Build headers/options array for curl to ensure authentication is sent to all endpoints
CURL_OPTS=("-s")
if [ "$API_KEY_PRESENT" = "yes" ]; then
  CURL_OPTS+=("-H" "x-api-key: ${API_KEY}")
fi

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
      FILE_SIZE="$SIZE2"
      FILE_EXISTS="yes"
      log "Recording file ready: ${RECORDING_FILE} (${FILE_SIZE} bytes)"
      break
    fi
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ ! -f "$RECORDING_FILE" ]; then
  log "ERROR: Recording file not found after ${MAX_WAIT}s: $RECORDING_FILE"
  # Notify API that recording failed
  curl "${CURL_OPTS[@]}" -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"failed\", \"error\": \"Recording file not found after ${MAX_WAIT}s: ${RECORDING_FILE}\"}" || true
  exit 1
fi

FILE_SIZE=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || stat -f%z "$RECORDING_FILE" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -le 100 ]; then
  log "ERROR: Recording file is too small (<= 100 bytes): $RECORDING_FILE (size: $FILE_SIZE bytes). Rejecting empty/header-only file."
  curl "${CURL_OPTS[@]}" -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"failed\", \"error\": \"Recording file too small or header-only ($FILE_SIZE bytes)\"}" || true
  # Do not delete the local file on failure. Leave it for inspection.
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
  RESPONSE=$(curl "${CURL_OPTS[@]}" -w "\n%{http_code}" --max-time 30 -X POST "${API_URL}/api/v1/recordings/upload" \
    -F "callId=${CALL_ID}" \
    -F "format=${EXTENSION}" \
    -F "file=@${RECORDING_FILE}" 2>&1)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  log "Upload attempt ${ATTEMPT}/${MAX_RETRIES} results: HTTP_CODE=${HTTP_CODE}, RESPONSE_BODY=${BODY}"

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    log "SUCCESS: Recording uploaded for call ${CALL_ID} (attempt ${ATTEMPT})"
    rm -f "$RECORDING_FILE"
    exit 0
  fi

  log "WARN: Upload attempt ${ATTEMPT}/${MAX_RETRIES} failed (HTTP ${HTTP_CODE})"
  ATTEMPT=$((ATTEMPT + 1))
  [ $ATTEMPT -le $MAX_RETRIES ] && sleep 2
done

log "ERROR: Upload failed after ${MAX_RETRIES} attempts (HTTP ${HTTP_CODE})"
log "Response body of last attempt: ${BODY}"

# Notify API that recording upload failed
curl "${CURL_OPTS[@]}" -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"failed\", \"error\": \"Upload failed after ${MAX_RETRIES} attempts (HTTP ${HTTP_CODE}): ${BODY}\"}" || true

# Do not delete the local file on failure. Leave it for inspection.
exit 1
