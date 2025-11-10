# Observability Setup

This document describes the observability stack for CallFabric, including logging, tracing, metrics, and health checks.

## Overview

CallFabric uses a comprehensive observability stack:

- **Structured Logging**: Pino for JSON logs with request IDs and tenant IDs
- **Distributed Tracing**: OpenTelemetry with Jaeger
- **Metrics**: Prometheus with Grafana dashboards
- **Health Checks**: Liveness and readiness probes

## Quick Start

### Start Observability Stack

```bash
cd infra/docker
docker-compose -f docker-compose.observability.yml up -d
```

This starts:

- **Jaeger** on http://localhost:16686 (UI)
- **Prometheus** on http://localhost:9090
- **Grafana** on http://localhost:3000 (admin/admin)
- **Node Exporter** on http://localhost:9100

### Verify Health

```bash
# Check all services
docker-compose -f docker-compose.observability.yml ps

# Check API health
curl http://localhost:3001/health/ready

# Check metrics
curl http://localhost:3001/metrics
```

## Structured Logging

### Configuration

Logging uses Pino for structured JSON logs. In development, logs are prettified for readability.

**Environment Variables:**

- `LOG_LEVEL`: Log level (debug, info, warn, error) - default: `info` (dev) or `debug` (prod)
- `NODE_ENV`: Set to `development` for pretty logs

### Log Format

All logs include:

- `service`: Service name (callfabric-api, callfabric-worker)
- `level`: Log level
- `time`: ISO timestamp
- `requestId`: Request ID (for API requests)
- `tenantId`: Tenant ID (when available)
- `userId`: User ID (when available)

**Example Log:**

```json
{
  "level": "info",
  "time": "2024-01-15T10:30:00.000Z",
  "service": "callfabric-api",
  "requestId": "1234567890-abc123",
  "tenantId": "tenant-123",
  "msg": "Request completed",
  "statusCode": 200,
  "duration": 0.045
}
```

### Usage

```typescript
import { logger } from './lib/logger.js';
import { createRequestLogger } from './lib/logger.js';

// Service logger
logger.info({ msg: 'Service started', port: 3001 });

// Request logger (in API)
const requestLogger = createRequestLogger(request);
requestLogger.info({ msg: 'Processing request' });
requestLogger.error({ msg: 'Request failed', err: error });
```

## Distributed Tracing

### Configuration

Tracing uses OpenTelemetry with Jaeger exporter.

**Environment Variables:**

- `ENABLE_TRACING`: Set to `false` to disable (default: enabled)
- `JAEGER_ENDPOINT`: Jaeger HTTP endpoint (default: `http://localhost:14268/api/traces`)

### Viewing Traces

1. Open Jaeger UI: http://localhost:16686
2. Select service: `callfabric-api` or `callfabric-worker`
3. Click "Find Traces"

### Trace Context

Traces automatically include:

- HTTP request spans
- Database query spans
- External API call spans
- Worker job spans

## Metrics

### Prometheus Metrics

All services expose metrics at `/metrics`:

- **API**: http://localhost:3001/metrics
- **Worker**: http://localhost:9091/metrics

### Available Metrics

#### HTTP Metrics

- `http_requests_total`: Total HTTP requests
- `http_request_duration_seconds`: Request duration histogram
- `http_request_errors_total`: Total HTTP errors

#### Database Metrics

- `db_queries_total`: Total database queries
- `db_query_duration_seconds`: Query duration histogram
- `db_connections_active`: Active database connections

#### Call Metrics

- `calls_total`: Total calls by status
- `calls_duration_seconds`: Call duration histogram
- `calls_active`: Active calls

#### Worker Metrics

- `worker_jobs_total`: Total worker jobs
- `worker_job_duration_seconds`: Job duration histogram
- `worker_jobs_active`: Active jobs

#### ETL Metrics

- `etl_records_processed_total`: Total records processed
- `etl_processing_duration_seconds`: ETL processing duration

### Prometheus Configuration

Prometheus is configured to scrape:

- API service (port 3001)
- Worker service (port 9091)
- Node exporter (port 9100)

Configuration: `infra/docker/prometheus/prometheus.yml`

## Grafana Dashboards

### Accessing Grafana

1. Open http://localhost:3000
2. Login: `admin` / `admin`
3. Change password on first login

### Available Dashboards

1. **CallFabric API Metrics**
   - HTTP request rate and duration
   - Error rates
   - Active calls
   - Database metrics

2. **CallFabric Worker Metrics**
   - Worker job processing
   - ETL metrics
   - Job duration

3. **CallFabric Call Metrics**
   - Call volume by status
   - Active calls
   - Call duration
   - ASR (Answer Seizure Ratio)

4. **CallFabric System Metrics**
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network traffic

### Creating Custom Dashboards

1. Click "+" → "Create Dashboard"
2. Add panels with Prometheus queries
3. Save dashboard

Example queries:

```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_request_errors_total[5m])

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

## Health Checks

### Endpoints

#### API Service

- **Liveness**: `GET /health/live` - Always returns 200 if service is running
- **Readiness**: `GET /health/ready` - Returns 200 if dependencies are healthy, 503 if degraded/unhealthy
- **Health**: `GET /health` - Detailed health information

#### Worker Service

- **Health**: `GET /health` - Returns service status
- **Metrics**: `GET /metrics` - Prometheus metrics

### Readiness Probe Details

The readiness probe checks:

- **Database**: Connection and query latency
- **Redis**: Connection and ping latency
- **ClickHouse**: Connection (if enabled)

Response format:

```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": {
    "database": {
      "status": "ok",
      "latency": 5
    },
    "redis": {
      "status": "ok",
      "latency": 2
    },
    "clickhouse": {
      "status": "ok" | "error" | "disabled",
      "latency": 10
    }
  }
}
```

### Kubernetes Integration

Use these endpoints for Kubernetes probes:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Alerts

### Recommended Alerts

Set up alerts in Prometheus/Alertmanager for:

1. **High Error Rate**

   ```promql
   rate(http_request_errors_total[5m]) > 10
   ```

2. **High Latency**

   ```promql
   histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
   ```

3. **Database Connection Issues**

   ```promql
   db_connections_active > 80
   ```

4. **High Call Failure Rate**

   ```promql
   rate(calls_total{status="FAILED"}[5m]) > 0.1
   ```

5. **Worker Job Failures**
   ```promql
   rate(worker_jobs_total{status="failed"}[5m]) > 0.1
   ```

## Troubleshooting

### Logs Not Appearing

1. Check `LOG_LEVEL` environment variable
2. Verify service is writing to stdout/stderr
3. Check Docker logs: `docker logs callfabric-api`

### Traces Not Appearing

1. Verify Jaeger is running: `curl http://localhost:16686`
2. Check `ENABLE_TRACING` is not set to `false`
3. Verify `JAEGER_ENDPOINT` is correct
4. Check service logs for tracing errors

### Metrics Not Scraping

1. Verify Prometheus is running: `curl http://localhost:9090/-/healthy`
2. Check Prometheus targets: http://localhost:9090/targets
3. Verify service exposes `/metrics` endpoint
4. Check Prometheus configuration

### Grafana Not Loading Dashboards

1. Verify Prometheus datasource is configured
2. Check dashboard JSON files are valid
3. Verify file permissions in Grafana container
4. Check Grafana logs: `docker logs grafana`

## Runbooks

See `docs/runbooks/README.md` for detailed runbooks on:

- High API error rate
- Database connection issues
- High call failure rate
- SIP registration failures
- RTP media issues
- Worker job failures
- ClickHouse ETL lag
