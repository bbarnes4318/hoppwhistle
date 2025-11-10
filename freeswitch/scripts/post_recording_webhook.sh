#!/usr/bin/env bash
FILE="$1"
UUID="$2"

curl -s -X POST "${API_BASE_URL}/dev/emit" \
  -H "Authorization: Bearer ${API_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"recording.ready\",\"callId\":\"${UUID}\",\"recordingUrl\":\"file://${FILE}\",\"format\":\"wav\"}" >/dev/null

