#!/bin/bash
# ============================================================================
# FreeSWITCH Recording Upload Hook
# ============================================================================
# This script is called by FreeSWITCH's hangup_hook to upload completed
# recording files to the Hopwhistle API for S3 ingestion.
#
# Usage in dialplan:
#   <action application="set" data="api_on_answer=lua upload_recording.lua"/>
#   OR
#   Called via exec_on_hangup
#
# This shell version is simpler and more reliable than the Lua equivalent.
# FreeSWITCH sets channel variables that we read to determine the call and path.
#
# Environment:
#   HOPWHISTLE_API_URL - Base URL of the Hopwhistle API (default: http://localhost:3001)
# ============================================================================

API_URL="${HOPWHISTLE_API_URL:-http://localhost:3001}"
RECORDING_DIR="/tmp/recordings"

# Called with: upload_recording.sh <call_id> <recording_path>
CALL_ID="$1"
RECORDING_PATH="$2"

if [ -z "$CALL_ID" ] || [ -z "$RECORDING_PATH" ]; then
  echo "[upload_recording] ERROR: Missing call_id or recording_path"
  exit 1
fi

if [ ! -f "$RECORDING_PATH" ]; then
  echo "[upload_recording] WARNING: Recording file not found: $RECORDING_PATH"
  # Notify API that recording failed
  curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"error\", \"error\": \"Recording file not found: ${RECORDING_PATH}\"}"
  exit 1
fi

# Get file size
FILE_SIZE=$(stat -c%s "$RECORDING_PATH" 2>/dev/null || stat -f%z "$RECORDING_PATH" 2>/dev/null)

echo "[upload_recording] Uploading recording for call ${CALL_ID}"
echo "[upload_recording] Path: ${RECORDING_PATH}, Size: ${FILE_SIZE} bytes"

# Upload recording file via multipart form
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/recordings/upload" \
  -F "callId=${CALL_ID}" \
  -F "format=wav" \
  -F "file=@${RECORDING_PATH}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "[upload_recording] SUCCESS: Recording uploaded for call ${CALL_ID}"
  echo "[upload_recording] Response: ${BODY}"
  
  # Clean up local file after successful upload
  rm -f "$RECORDING_PATH"
else
  echo "[upload_recording] ERROR: Upload failed with HTTP ${HTTP_CODE}"
  echo "[upload_recording] Response: ${BODY}"
  
  # Notify API that recording upload failed
  curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"error\", \"error\": \"Upload failed with HTTP ${HTTP_CODE}\"}"
fi
