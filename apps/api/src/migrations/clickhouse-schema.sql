-- ClickHouse Schema for Analytics Warehouse
-- Run this manually or via migration script

-- CDRs table (MergeTree for time-series data)
CREATE TABLE IF NOT EXISTS cdrs
(
    id String,
    call_id String,
    tenant_id String,
    campaign_id Nullable(String),
    publisher_id Nullable(String),
    buyer_id Nullable(String),
    from_number String,
    to_number String,
    duration UInt32,
    billable_duration UInt32,
    cost Decimal64(4),
    rate Nullable(Decimal64(6)),
    direction String,
    status String,
    started_at DateTime,
    answered_at Nullable(DateTime),
    ended_at Nullable(DateTime),
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, created_at, call_id)
SETTINGS index_granularity = 8192;

-- Events table
CREATE TABLE IF NOT EXISTS events
(
    id String,
    tenant_id String,
    type String,
    entity_type Nullable(String),
    entity_id Nullable(String),
    campaign_id Nullable(String),
    publisher_id Nullable(String),
    buyer_id Nullable(String),
    payload String, -- JSON as string
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, created_at, type, entity_type)
SETTINGS index_granularity = 8192;

-- Hourly metrics materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_hourly
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (tenant_id, hour, campaign_id, publisher_id, buyer_id)
AS
SELECT
    tenant_id,
    toStartOfHour(created_at) AS hour,
    campaign_id,
    publisher_id,
    buyer_id,
    count() AS total_calls,
    countIf(status = 'ANSWERED' OR status = 'COMPLETED') AS answered_calls,
    countIf(status = 'COMPLETED') AS completed_calls,
    countIf(status = 'FAILED' OR status = 'BUSY' OR status = 'NO_ANSWER') AS failed_calls,
    sum(duration) AS total_duration,
    sum(billable_duration) AS total_billable_duration,
    sum(cost) AS total_cost,
    avg(duration) AS avg_duration,
    avg(billable_duration) AS avg_billable_duration,
    -- ASR: Answer Seizure Ratio
    countIf(status = 'ANSWERED' OR status = 'COMPLETED') / count() AS asr,
    -- AHT: Average Handle Time (from answered to ended)
    avgIf(
        dateDiff('second', answered_at, ended_at),
        answered_at IS NOT NULL AND ended_at IS NOT NULL
    ) AS aht
FROM cdrs
GROUP BY tenant_id, hour, campaign_id, publisher_id, buyer_id;

-- Daily metrics materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (tenant_id, day, campaign_id, publisher_id, buyer_id)
AS
SELECT
    tenant_id,
    toStartOfDay(created_at) AS day,
    campaign_id,
    publisher_id,
    buyer_id,
    count() AS total_calls,
    countIf(status = 'ANSWERED' OR status = 'COMPLETED') AS answered_calls,
    countIf(status = 'COMPLETED') AS completed_calls,
    countIf(status = 'FAILED' OR status = 'BUSY' OR status = 'NO_ANSWER') AS failed_calls,
    sum(duration) AS total_duration,
    sum(billable_duration) AS total_billable_duration,
    sum(cost) AS total_cost,
    avg(duration) AS avg_duration,
    avg(billable_duration) AS avg_billable_duration,
    -- ASR: Answer Seizure Ratio
    countIf(status = 'ANSWERED' OR status = 'COMPLETED') / count() AS asr,
    -- AHT: Average Handle Time
    avgIf(
        dateDiff('second', answered_at, ended_at),
        answered_at IS NOT NULL AND ended_at IS NOT NULL
    ) AS aht,
    -- Conversion rate (from events)
    countIf(type = 'conversion' AND entity_type = 'call') AS conversions
FROM cdrs
LEFT JOIN events ON cdrs.call_id = events.entity_id AND events.entity_type = 'call'
GROUP BY tenant_id, day, campaign_id, publisher_id, buyer_id;

-- Indexes for faster lookups
ALTER TABLE cdrs ADD INDEX IF NOT EXISTS idx_campaign campaign_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE cdrs ADD INDEX IF NOT EXISTS idx_publisher publisher_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE cdrs ADD INDEX IF NOT EXISTS idx_buyer buyer_id TYPE bloom_filter GRANULARITY 1;

