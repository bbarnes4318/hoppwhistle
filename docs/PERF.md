# Performance & Load Testing Baselines

**Last Updated:** [Date]

## Overview

This document outlines performance baselines and scale limits for the Hopwhistle platform, verified through k6 load testing.

## Test Environment

- **API Server:** Fastify on Node.js
- **Database:** PostgreSQL
- **Cache/PubSub:** Redis
- **Test Tool:** k6
- **Test Duration:** 5-10 minutes per test

## Performance Targets

### 1. Call State Updates

**Target:** 500 concurrent call state updates/second

**Test:** `tests/k6/call-state-updates.js`

**Baseline Results:**

| Metric       | Target          | Baseline          | Status |
| ------------ | --------------- | ----------------- | ------ |
| Throughput   | 500 updates/sec | [TBD] updates/sec | ⏳     |
| Success Rate | >95%            | [TBD]%            | ⏳     |
| p95 Latency  | <300ms          | [TBD]ms           | ⏳     |
| p99 Latency  | <500ms          | [TBD]ms           | ⏳     |

**Test Configuration:**

- Stages: Ramp up to 500 VUs over 3 minutes
- Duration: 3 minutes at peak load
- Endpoint: `/api/v1/demo/events/call` (POST)
- Simulates call state progression: INITIATED → RINGING → ANSWERED → COMPLETED

**Key Findings:**

- [To be populated after test runs]

**Bottlenecks Identified:**

- [To be populated after test runs]

**Optimization Recommendations:**

- [To be populated after test runs]

---

### 2. Reporting Endpoints

**Target:** 100 QPS with <300ms p95 latency

**Test:** `tests/k6/reporting-endpoints.js`

**Baseline Results:**

| Metric       | Target    | Baseline    | Status |
| ------------ | --------- | ----------- | ------ |
| Request Rate | 100 req/s | [TBD] req/s | ⏳     |
| Success Rate | >98%      | [TBD]%      | ⏳     |
| p50 Latency  | <150ms    | [TBD]ms     | ⏳     |
| p95 Latency  | <300ms    | [TBD]ms     | ⏳     |
| p99 Latency  | <500ms    | [TBD]ms     | ⏳     |

**Test Configuration:**

- Stages: Ramp up to 100 VUs over 2 minutes
- Duration: 5 minutes at peak load
- Endpoints:
  - `/api/v1/reporting/metrics` (hourly granularity)
  - `/api/v1/reporting/calls`
  - `/api/v1/reporting/metrics` (daily granularity)

**Key Findings:**

- [To be populated after test runs]

**Bottlenecks Identified:**

- [To be populated after test runs]

**Optimization Recommendations:**

- [To be populated after test runs]

---

### 3. Redis Pub/Sub Throughput

**Target:** High-throughput event delivery with <100ms p95 latency

**Test:** `tests/k6/redis-pubsub.js`

**Baseline Results:**

| Metric                | Target    | Baseline    | Status |
| --------------------- | --------- | ----------- | ------ |
| Message Delivery Rate | >95%      | [TBD]%      | ⏳     |
| Message Throughput    | 500 msg/s | [TBD] msg/s | ⏳     |
| p50 Latency           | <50ms     | [TBD]ms     | ⏳     |
| p95 Latency           | <100ms    | [TBD]ms     | ⏳     |
| p99 Latency           | <200ms    | [TBD]ms     | ⏳     |

**Test Configuration:**

- Subscribers: 200 WebSocket connections
- Publishers: 10 VUs publishing at 500 msg/s
- Duration: 3 minutes at peak load
- Channels: `call.*` pattern subscription

**Key Findings:**

- [To be populated after test runs]

**Bottlenecks Identified:**

- [To be populated after test runs]

**Optimization Recommendations:**

- [To be populated after test runs]

---

## System Resource Limits

### Database (PostgreSQL)

| Resource             | Limit | Current Usage | Notes                      |
| -------------------- | ----- | ------------- | -------------------------- |
| Max Connections      | 100   | [TBD]         | Connection pooling enabled |
| Query Timeout        | 30s   | [TBD]         | Configurable per query     |
| Connection Pool Size | 20    | [TBD]         | Per API instance           |

### Redis

| Resource         | Limit     | Current Usage | Notes                       |
| ---------------- | --------- | ------------- | --------------------------- |
| Max Connections  | 10000     | [TBD]         | Pub/sub connections         |
| Memory Limit     | 2GB       | [TBD]         | Configurable                |
| Pub/Sub Channels | Unlimited | [TBD]         | Pattern-based subscriptions |

### API Server

| Resource                | Limit | Current Usage | Notes        |
| ----------------------- | ----- | ------------- | ------------ |
| Max Concurrent Requests | 1000  | [TBD]         | Per instance |
| Request Timeout         | 30s   | [TBD]         | Configurable |
| WebSocket Connections   | 1000  | [TBD]         | Per instance |

---

## Load Test Execution

### Prerequisites

1. **Start Services:**

   ```bash
   # Start API server
   cd apps/api && pnpm dev

   # Start Redis
   docker run -d -p 6379:6379 redis:7

   # Start PostgreSQL
   docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
   ```

2. **Seed Test Data:**

   ```bash
   pnpm db:seed:demo
   ```

3. **Install k6:**
   ```bash
   # See tests/k6/README.md for installation instructions
   ```

### Running Tests

**Option 1: Run individually**

```bash
cd tests/k6

# Call state updates
k6 run --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       call-state-updates.js

# Reporting endpoints
k6 run --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       --env TENANT_ID=00000000-0000-0000-0000-000000000000 \
       reporting-endpoints.js

# Redis pub/sub
k6 run --env WS_URL=ws://localhost:3001 \
       --env API_URL=http://localhost:3001 \
       --env API_KEY=test-api-key \
       --env TENANT_ID=00000000-0000-0000-0000-000000000000 \
       --env PUBLISHER_VUS=10 \
       --env MESSAGES_PER_SECOND=500 \
       redis-pubsub.js
```

**Option 2: Run all tests (bash)**

```bash
cd tests/k6
bash run-all.sh
```

**Option 3: Run all tests (PowerShell)**

```powershell
cd tests/k6
.\run-all.ps1
```

**Option 4: Using npm scripts**

```bash
# From project root
pnpm test:perf:call-state
pnpm test:perf:reporting
pnpm test:perf:pubsub
pnpm test:perf  # Run all
```

### Collecting Results

Results are automatically saved to:

- `tests/k6/results/call-state-updates.json`
- `tests/k6/results/reporting-endpoints.json`
- `tests/k6/results/redis-pubsub.json`

---

## Performance Monitoring

### Key Metrics to Monitor

1. **API Metrics:**
   - Request rate (req/s)
   - Response time (p50, p95, p99)
   - Error rate
   - Active connections

2. **Database Metrics:**
   - Query execution time
   - Connection pool usage
   - Slow query count
   - Lock contention

3. **Redis Metrics:**
   - Memory usage
   - Connection count
   - Pub/sub message rate
   - Command latency

4. **System Metrics:**
   - CPU usage
   - Memory usage
   - Network I/O
   - Disk I/O

### Monitoring Tools

- **Application:** Built-in Prometheus metrics
- **Database:** PostgreSQL `pg_stat_statements`
- **Redis:** Redis `INFO` command
- **System:** Node.js `process.memoryUsage()`, `os.cpus()`

---

## Scaling Recommendations

### Horizontal Scaling

- **API Servers:** Scale to 3+ instances behind load balancer
- **Database:** Use read replicas for reporting queries
- **Redis:** Use Redis Cluster for high availability

### Vertical Scaling

- **Database:** Increase connection pool size
- **Redis:** Increase memory limit
- **API Server:** Increase Node.js heap size if needed

### Optimization Strategies

1. **Database:**
   - Add indexes for frequently queried fields
   - Use query result caching
   - Implement database connection pooling

2. **Redis:**
   - Use Redis pipelining for batch operations
   - Implement message batching for pub/sub
   - Use Redis Cluster for distributed pub/sub

3. **API:**
   - Implement request rate limiting
   - Add response caching headers
   - Optimize JSON serialization

---

## Regression Testing

Run load tests as part of CI/CD pipeline:

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start services
        run: docker-compose up -d
      - name: Run k6 tests
        run: |
          k6 run tests/k6/call-state-updates.js
          k6 run tests/k6/reporting-endpoints.js
          k6 run tests/k6/redis-pubsub.js
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: k6-results
          path: tests/k6/results/
```

---

## Troubleshooting

### Common Issues

1. **High Latency:**
   - Check database query performance
   - Verify Redis connection pool
   - Review API server CPU/memory usage

2. **Connection Errors:**
   - Check connection pool limits
   - Verify network connectivity
   - Review firewall rules

3. **Memory Leaks:**
   - Monitor Node.js heap usage
   - Check for unclosed connections
   - Review event listener cleanup

### Debug Commands

```bash
# Check API server health
curl http://localhost:3001/health

# Check Redis connections
redis-cli INFO clients

# Check PostgreSQL connections
psql -c "SELECT count(*) FROM pg_stat_activity;"

# Monitor API server metrics
curl http://localhost:3001/metrics
```

---

## Quick Start

1. **Install k6:**

   ```bash
   # macOS
   brew install k6

   # Linux (see tests/k6/README.md for full instructions)
   # Windows: Download from https://k6.io/docs/getting-started/installation/
   ```

2. **Start services:**

   ```bash
   # Start API, Redis, PostgreSQL
   docker-compose -f infra/docker/docker-compose.dev.yml up -d
   ```

3. **Seed test data:**

   ```bash
   pnpm db:seed:demo
   ```

4. **Run tests:**
   ```bash
   cd tests/k6
   k6 run call-state-updates.js
   ```

## Next Steps

1. ✅ Create k6 test scripts
2. ⏳ Run baseline tests
3. ⏳ Document baseline results
4. ⏳ Identify bottlenecks
5. ⏳ Implement optimizations
6. ⏳ Re-run tests to verify improvements
7. ⏳ Set up CI/CD integration
8. ⏳ Establish monitoring alerts

---

**Note:** This document should be updated after each load test run with actual baseline results and findings. The test scripts are ready to use - run them and populate the baseline results tables above.
