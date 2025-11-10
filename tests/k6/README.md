# k6 Load Testing

This directory contains k6 load test scripts for verifying scale limits of the Hopwhistle platform.

## Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
# Download from https://k6.io/docs/getting-started/installation/
```

## Test Scripts

### 1. Call State Updates (`call-state-updates.js`)

**Target:** 500 concurrent call state updates/second

Simulates high-frequency call state transitions (INITIATED → RINGING → ANSWERED → COMPLETED).

**Run:**

```bash
k6 run --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       call-state-updates.js
```

**Metrics:**

- Call state update success rate
- Call state update latency (p95 target: <300ms)
- HTTP request duration

### 2. Reporting Endpoints (`reporting-endpoints.js`)

**Target:** 100 QPS with <300ms p95 latency

Simulates dashboard and analytics queries from multiple concurrent users.

**Run:**

```bash
k6 run --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       --env TENANT_ID=00000000-0000-0000-0000-000000000000 \
       reporting-endpoints.js
```

**Metrics:**

- Reporting request success rate (target: >98%)
- Reporting request latency (p95 target: <300ms)
- Request rate (target: 100 req/s)

### 3. Redis Pub/Sub (`redis-pubsub.js`)

**Target:** Measure Redis pub/sub throughput and latency

Simulates high-frequency event publishing and WebSocket subscription consumption.

**Run:**

```bash
k6 run --env WS_URL=ws://localhost:3001 \
       --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       --env TENANT_ID=00000000-0000-0000-0000-000000000000 \
       --env PUBLISHER_VUS=10 \
       --env MESSAGES_PER_SECOND=500 \
       redis-pubsub.js
```

**Metrics:**

- Message delivery rate (target: >95%)
- Message latency (p95 target: <100ms)
- Total messages received

## Environment Variables

- `API_URL` - Base URL for API (default: `http://localhost:3001`)
- `WS_URL` - WebSocket URL (default: `ws://localhost:3001`)
- `API_KEY` - API key for authentication (default: `test-api-key`)
- `TENANT_ID` - Tenant ID for requests (default: demo tenant)
- `USE_DEMO_ENDPOINT` - Use demo events endpoint for call state updates (default: `false`)
- `PUBLISHER_VUS` - Number of VUs publishing events (default: `10`)
- `MESSAGES_PER_SECOND` - Target messages per second for publishers (default: `500`)

## Running All Tests

Run all tests sequentially:

```bash
# Call state updates
k6 run --out json=results/call-state-updates.json call-state-updates.js

# Reporting endpoints
k6 run --out json=results/reporting-endpoints.json reporting-endpoints.js

# Redis pub/sub
k6 run --out json=results/redis-pubsub.json redis-pubsub.js
```

## Results

Test results are saved to:

- `results/call-state-updates.json`
- `results/reporting-endpoints.json`
- `results/redis-pubsub.json`

## CI Integration

Add to GitHub Actions workflow:

```yaml
- name: Run k6 load tests
  run: |
    k6 run tests/k6/call-state-updates.js
    k6 run tests/k6/reporting-endpoints.js
    k6 run tests/k6/redis-pubsub.js
```

## Performance Baselines

See `/docs/perf.md` for documented performance baselines and thresholds.
