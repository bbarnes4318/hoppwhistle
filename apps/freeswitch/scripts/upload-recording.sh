#!/bin/bash
# Upload recording to S3-compatible storage (Wasabi/Spaces)

set -e

RECORDING_FILE="$1"
CALL_ID="$2"

if [ -z "$RECORDING_FILE" ] || [ -z "$CALL_ID" ]; then
  echo "Usage: $0 <recording_file> <call_id>"
  exit 1
fi

# Get S3 config from environment
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${S3_SECRET_KEY:-}"
S3_REGION="${S3_REGION:-us-east-1}"

# Skip upload if S3 not configured
if [ -z "$S3_ENDPOINT" ] || [ -z "$S3_BUCKET" ] || [ -z "$S3_ACCESS_KEY" ] || [ -z "$S3_SECRET_KEY" ]; then
  echo "S3 configuration not set, skipping upload"
  exit 0
fi

# Check if file exists
if [ ! -f "$RECORDING_FILE" ]; then
  echo "Recording file not found: $RECORDING_FILE"
  exit 1
fi

# Extract filename and extension
FILENAME=$(basename "$RECORDING_FILE")
EXTENSION="${FILENAME##*.}"
DATE_PATH=$(date +"%Y/%m/%d")

# S3 key path: recordings/YYYY/MM/DD/call_id.ext
S3_KEY="recordings/${DATE_PATH}/${CALL_ID}.${EXTENSION}"

# Use AWS CLI or curl for upload
if command -v aws &> /dev/null; then
  # Use AWS CLI
  aws s3 cp "$RECORDING_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
    --endpoint-url="$S3_ENDPOINT" \
    --region="$S3_REGION" \
    --quiet
  
  echo "Uploaded to S3: ${S3_KEY}"
else
  # Use curl for S3 upload (simpler but requires proper signing)
  # For production, use AWS CLI or a proper S3 SDK
  echo "AWS CLI not found, skipping upload (install aws-cli for S3 upload)"
  exit 0
fi

# Notify API about recording upload
API_URL="${API_URL:-http://api:3001}"
API_KEY="${API_KEY:-}"

if [ -n "$API_URL" ] && [ -n "$API_KEY" ]; then
  curl -X POST "${API_URL}/api/v1/recordings/uploaded" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${API_KEY}" \
    -d "{
      \"callId\": \"${CALL_ID}\",
      \"url\": \"s3://${S3_BUCKET}/${S3_KEY}\",
      \"format\": \"${EXTENSION}\",
      \"size\": $(stat -f%z "$RECORDING_FILE" 2>/dev/null || stat -c%s "$RECORDING_FILE" 2>/dev/null || echo 0)
    }" \
    --silent --show-error || true
fi

# Clean up local file after upload (optional)
# rm -f "$RECORDING_FILE"

exit 0

