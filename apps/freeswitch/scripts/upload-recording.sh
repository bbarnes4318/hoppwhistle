#!/bin/bash
# Upload recording to Hopwhistle API

set -e

RECORDING_FILE="$1"
CALL_ID="$2"

if [ -z "$RECORDING_FILE" ] || [ -z "$CALL_ID" ]; then
  echo "Usage: $0 <recording_file> <call_id>"
  exit 1
fi

# Check if file exists
if [ ! -f "$RECORDING_FILE" ]; then
  echo "Recording file not found: $RECORDING_FILE"
  exit 1
fi

# Extract format
FILENAME=$(basename "$RECORDING_FILE")
EXTENSION="${FILENAME##*.}"

API_URL="${API_URL:-http://api:3001}"
API_KEY="${API_KEY:-}"

echo "Uploading recording for call ${CALL_ID} to ${API_URL}"

# Upload recording file via multipart form
if [ -n "$API_KEY" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/recordings/upload" \
    -H "X-API-Key: ${API_KEY}" \
    -F "callId=${CALL_ID}" \
    -F "format=${EXTENSION}" \
    -F "file=@${RECORDING_FILE}")
else
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/recordings/upload" \
    -F "callId=${CALL_ID}" \
    -F "format=${EXTENSION}" \
    -F "file=@${RECORDING_FILE}")
fi

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "SUCCESS: Recording uploaded for call ${CALL_ID}"
  echo "Response: ${BODY}"
  
  # Clean up local file after successful upload
  rm -f "$RECORDING_FILE"
  exit 0
else
  echo "ERROR: Upload failed with HTTP ${HTTP_CODE}"
  echo "Response: ${BODY}"
  
  # Notify API that recording upload failed
  curl -s -X POST "${API_URL}/api/v1/calls/${CALL_ID}/recording-status" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"error\", \"error\": \"Upload failed with HTTP ${HTTP_CODE}\"}"
  exit 1
fi
