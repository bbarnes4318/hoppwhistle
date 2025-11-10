# ClickHouse Analytics Warehouse Setup

This document describes how to set up ClickHouse for the analytics warehouse.

## Overview

ClickHouse is used as a high-performance analytics store for CDRs and events. The system automatically falls back to Postgres if ClickHouse is not configured.

## Features

- **ETL Worker**: Streams CDRs and events from Postgres to ClickHouse every 30 seconds
- **Materialized Views**: Pre-aggregated hourly and daily metrics (ASR, AHT, billable minutes, conversion rate)
- **Fast Queries**: Optimized for time-series analytics with partitioning and indexing
- **Automatic Fallback**: Uses Postgres views if ClickHouse is disabled

## Setup

### 1. Install ClickHouse

**Using Docker:**

```bash
docker run -d \
  --name clickhouse \
  -p 8123:8123 \
  -p 9000:9000 \
  -e CLICKHOUSE_DB=callfabric \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD= \
  clickhouse/clickhouse-server:latest
```

**Using Docker Compose:**
Add to `infra/docker/docker-compose.yml`:

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:latest
  ports:
    - '8123:8123'
    - '9000:9000'
  environment:
    CLICKHOUSE_DB: callfabric
    CLICKHOUSE_USER: default
    CLICKHOUSE_PASSWORD: ''
  volumes:
    - clickhouse_data:/var/lib/clickhouse
```

### 2. Configure Environment Variables

Add to `apps/api/.env` and `apps/worker/.env`:

```env
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=callfabric
```

### 3. Initialize Schema

Run the ClickHouse schema migration:

```bash
# Connect to ClickHouse
clickhouse-client --host localhost --port 9000

# Or using HTTP
curl http://localhost:8123/ -d "CREATE DATABASE IF NOT EXISTS callfabric"

# Run schema SQL
cat apps/api/src/migrations/clickhouse-schema.sql | clickhouse-client
```

Or use the HTTP interface:

```bash
curl http://localhost:8123/ -d @apps/api/src/migrations/clickhouse-schema.sql
```

### 4. Start ETL Worker

The ETL worker runs automatically when the worker service starts:

```bash
cd apps/worker
pnpm dev
```

The worker will:

- Process CDRs created in the last hour (or since last run)
- Process unprocessed events
- Insert data into ClickHouse tables
- Materialized views will automatically update

## Schema

### Tables

- **cdrs**: Raw CDR data partitioned by month
- **events**: Event data partitioned by month

### Materialized Views

- **metrics_hourly**: Pre-aggregated hourly metrics
- **metrics_daily**: Pre-aggregated daily metrics

Both views include:

- Total calls, answered calls, completed calls, failed calls
- Total duration, billable duration, cost
- ASR (Answer Seizure Ratio)
- AHT (Average Handle Time)
- Conversion rate (from events)

## API Endpoints

### Get Metrics

```
GET /api/v1/reporting/metrics?startDate=2024-01-01T00:00:00Z&endDate=2024-01-02T00:00:00Z&granularity=hour&campaignId=xxx
```

Query Parameters:

- `startDate`: ISO 8601 date string
- `endDate`: ISO 8601 date string
- `granularity`: `hour` or `day` (default: `hour`)
- `campaignId`: Optional campaign filter
- `publisherId`: Optional publisher filter
- `buyerId`: Optional buyer filter

### Get Calls Report

```
GET /api/v1/reporting/calls
```

### Get Campaign Report

```
GET /api/v1/reporting/campaigns/:campaignId?startDate=...&endDate=...
```

## Performance

- **Query Speed**: Materialized views enable sub-second queries even over millions of records
- **Storage**: ClickHouse compresses data efficiently (typically 10x compression)
- **Scalability**: Handles billions of rows with excellent performance

## Monitoring

Check ETL worker logs:

```bash
# Worker logs will show:
# "Processed X CDRs to ClickHouse"
# "Processed X events to ClickHouse"
```

Check ClickHouse status:

```bash
curl http://localhost:8123/ping
```

Query ClickHouse directly:

```bash
clickhouse-client --query "SELECT count() FROM cdrs"
```

## Troubleshooting

### ETL Worker Not Processing

1. Check if ClickHouse is enabled:
   - Look for "ClickHouse client initialized" in logs
   - If not, check environment variables

2. Check ClickHouse connectivity:

   ```bash
   curl http://localhost:8123/ping
   ```

3. Check worker logs for errors

### Slow Queries

1. Ensure materialized views are being used (check query logs)
2. Verify partitioning is working (check partition count)
3. Consider adding more indexes if needed

### Data Not Appearing

1. Check ETL worker is running
2. Verify CDRs/events exist in Postgres
3. Check ClickHouse tables:
   ```sql
   SELECT count() FROM cdrs;
   SELECT count() FROM events;
   ```

## Disabling ClickHouse

To disable ClickHouse and use Postgres fallback:

- Remove or don't set `CLICKHOUSE_URL` environment variable
- The system will automatically use Postgres queries
- No code changes needed
