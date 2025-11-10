#!/bin/bash
# Run all k6 performance tests sequentially

set -e

API_URL=${API_URL:-http://localhost:3001}
WS_URL=${WS_URL:-ws://localhost:3001}
API_KEY=${API_KEY:-test-api-key}
TENANT_ID=${TENANT_ID:-00000000-0000-0000-0000-000000000000}

echo "🚀 Starting k6 Performance Test Suite"
echo "======================================"
echo "API URL: $API_URL"
echo "WS URL: $WS_URL"
echo ""

# Create results directory
mkdir -p results

echo "📞 Test 1/3: Call State Updates"
echo "--------------------------------"
k6 run \
  --env API_URL=$API_URL \
  --env API_KEY=$API_KEY \
  --env TENANT_ID=$TENANT_ID \
  --out json=results/call-state-updates.json \
  call-state-updates.js

echo ""
echo "📊 Test 2/3: Reporting Endpoints"
echo "----------------------------------"
k6 run \
  --env API_URL=$API_URL \
  --env API_KEY=$API_KEY \
  --env TENANT_ID=$TENANT_ID \
  --out json=results/reporting-endpoints.json \
  reporting-endpoints.js

echo ""
echo "📡 Test 3/3: Redis Pub/Sub"
echo "---------------------------"
k6 run \
  --env WS_URL=$WS_URL \
  --env API_URL=$API_URL \
  --env API_KEY=$API_KEY \
  --env TENANT_ID=$TENANT_ID \
  --env PUBLISHER_VUS=10 \
  --env MESSAGES_PER_SECOND=500 \
  --out json=results/redis-pubsub.json \
  redis-pubsub.js

echo ""
echo "✅ All tests completed!"
echo "Results saved to tests/k6/results/"

