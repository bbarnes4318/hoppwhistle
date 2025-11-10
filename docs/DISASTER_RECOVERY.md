# Disaster Recovery Plan

## Overview

This document outlines the disaster recovery (DR) plan for Hopwhistle across two regions: **DigitalOcean (Primary)** and **Hetzner (Secondary)**.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Primary Region (DO)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   API    │  │   Web    │  │  Worker  │  │ FreeSWITCH│   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│  ┌────┴─────────────┴─────────────┴─────────────┴─────┐    │
│  │              PostgreSQL (Primary)                  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         MinIO/S3 (Primary)                         │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
                    [Replication]
                          │
┌─────────────────────────────────────────────────────────────┐
│                 Secondary Region (Hetzner)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   API    │  │   Web    │  │  Worker  │  │ FreeSWITCH│   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│  ┌────┴─────────────┴─────────────┴─────────────┴─────┐    │
│  │           PostgreSQL (Standby)                   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         MinIO/S3 (Replica)                          │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Recovery Objectives

| Metric                             | Target                           |
| ---------------------------------- | -------------------------------- |
| **RTO (Recovery Time Objective)**  | 1 hour                           |
| **RPO (Recovery Point Objective)** | 15 minutes                       |
| **MTTR (Mean Time To Recovery)**   | 30 minutes                       |
| **Availability SLA**               | 99.9% (8.76 hours downtime/year) |

## Database Replication Setup

### Primary (DigitalOcean)

```bash
# postgresql.conf
wal_level = replica
max_wal_senders = 3
max_replication_slots = 3
hot_standby = on

# pg_hba.conf
host replication replicator <hetzner-ip>/32 md5
```

### Standby (Hetzner)

```bash
# Create replication user on primary
psql -c "CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD 'secure-password';"

# Setup streaming replication
pg_basebackup \
  -h <primary-ip> \
  -D /var/lib/postgresql/data \
  -U replicator \
  -P \
  -W \
  -R \
  -S replication_slot_hetzner

# postgresql.conf (standby)
hot_standby = on
hot_standby_feedback = on

# recovery.conf (auto-generated by pg_basebackup -R)
primary_conninfo = 'host=<primary-ip> port=5432 user=replicator password=secure-password'
primary_slot_name = 'replication_slot_hetzner'
```

### Verify Replication

```bash
# On primary
psql -c "SELECT * FROM pg_stat_replication;"

# On standby
psql -c "SELECT pg_is_in_recovery();"  # Should return 't'
```

## Object Storage Replication

### MinIO Replication Setup

```bash
# Configure replication on primary MinIO
mc replicate add \
  minio-primary/recordings \
  minio-secondary/recordings \
  --remote-bucket=recordings \
  --priority=1 \
  --sync
```

### S3 Cross-Region Replication

```bash
# Configure replication policy
cat > replication-policy.json <<EOF
{
  "Rules": [
    {
      "Status": "Enabled",
      "Priority": 1,
      "DeleteMarkerReplication": { "Status": "Enabled" },
      "Filter": { "Prefix": "" },
      "Destination": {
        "Bucket": "arn:aws:s3:::hopwhistle-recordings-hetzner",
        "StorageClass": "STANDARD"
      }
    }
  ]
}
EOF

aws s3api put-bucket-replication \
  --bucket hopwhistle-recordings \
  --replication-configuration file://replication-policy.json
```

## Failover Procedures

### Automated Failover Detection

```bash
#!/bin/bash
# scripts/dr-monitor.sh

PRIMARY_API="https://api.hopwhistle.com"
SECONDARY_API="https://api-hetzner.hopwhistle.com"
ALERT_EMAIL="ops@hopwhistle.com"

# Check primary health
PRIMARY_HEALTH=$(curl -sf "$PRIMARY_API/health" || echo "DOWN")

if [ "$PRIMARY_HEALTH" = "DOWN" ]; then
  echo "🚨 Primary region is DOWN"

  # Verify secondary is healthy
  SECONDARY_HEALTH=$(curl -sf "$SECONDARY_API/health" || echo "DOWN")

  if [ "$SECONDARY_HEALTH" = "UP" ]; then
    echo "✅ Secondary region is UP, initiating failover..."
    ./scripts/failover-to-hetzner.sh
  else
    echo "❌ Both regions are DOWN - CRITICAL"
    echo "CRITICAL: Both regions down" | mail -s "DR Alert" "$ALERT_EMAIL"
  fi
fi
```

### Manual Failover to Hetzner

```bash
#!/bin/bash
# scripts/failover-to-hetzner.sh

set -e

echo "🔄 Initiating failover to Hetzner (Secondary Region)"

# Step 1: Promote standby database
echo "1. Promoting standby database..."
ssh hetzner-db "sudo -u postgres psql -c 'SELECT pg_promote();'"

# Verify promotion
sleep 10
ssh hetzner-db "sudo -u postgres psql -c 'SELECT pg_is_in_recovery();'" | grep -q "f" || {
  echo "❌ Database promotion failed"
  exit 1
}

# Step 2: Update application configuration
echo "2. Updating application configuration..."
cat > /opt/hopwhistle/hetzner/.env <<EOF
DATABASE_URL=postgresql://user:pass@hetzner-db:5432/hopwhistle
REDIS_URL=redis://hetzner-redis:6379
S3_ENDPOINT=https://minio-hetzner.hopwhistle.com
S3_BUCKET=recordings
API_URL=https://api-hetzner.hopwhistle.com
NODE_ENV=production
EOF

# Step 3: Start services in Hetzner
echo "3. Starting services..."
ssh hetzner-app "cd /opt/hopwhistle && docker-compose up -d"

# Step 4: Health check
echo "4. Health checking..."
sleep 30
for i in {1..10}; do
  HEALTH=$(curl -sf https://api-hetzner.hopwhistle.com/health || echo "DOWN")
  if [ "$HEALTH" = "OK" ]; then
    echo "✅ Health check passed"
    break
  fi
  echo "Waiting for health check... ($i/10)"
  sleep 10
done

# Step 5: Update DNS
echo "5. Updating DNS..."
# DigitalOcean DNS
doctl compute domain records update hopwhistle.com \
  --record-id $(doctl compute domain records list hopwhistle.com --format ID,Name,Data --no-header | grep api | awk '{print $1}') \
  --record-data hetzner-api.hopwhistle.com \
  --record-type CNAME

doctl compute domain records update hopwhistle.com \
  --record-id $(doctl compute domain records list hopwhistle.com --format ID,Name,Data --no-header | grep www | awk '{print $1}') \
  --record-data hetzner-web.hopwhistle.com \
  --record-type CNAME

# Step 6: Verify failover
echo "6. Verifying failover..."
sleep 60  # Wait for DNS propagation
curl -f https://api.hopwhistle.com/health || {
  echo "⚠️  DNS may not have propagated yet"
}

echo "✅ Failover completed"
```

### Failback to DigitalOcean

```bash
#!/bin/bash
# scripts/failback-to-digitalocean.sh

set -e

echo "🔄 Initiating failback to DigitalOcean (Primary Region)"

# Step 1: Re-establish replication
echo "1. Re-establishing database replication..."
# Re-sync database from Hetzner to DO
pg_basebackup \
  -h hetzner-db \
  -D /var/lib/postgresql/data \
  -U replicator \
  -P \
  -W \
  -R

# Step 2: Start services in DO
echo "2. Starting services..."
cd /opt/hopwhistle/digitalocean
docker-compose up -d

# Step 3: Health check
echo "3. Health checking..."
sleep 30
curl -f https://api-do.hopwhistle.com/health || exit 1

# Step 4: Update DNS back
echo "4. Updating DNS..."
doctl compute domain records update hopwhistle.com \
  --record-id $(doctl compute domain records list hopwhistle.com --format ID,Name,Data --no-header | grep api | awk '{print $1}') \
  --record-data api-do.hopwhistle.com \
  --record-type CNAME

# Step 5: Verify failback
echo "5. Verifying failback..."
sleep 60
curl -f https://api.hopwhistle.com/health || {
  echo "⚠️  DNS may not have propagated yet"
}

echo "✅ Failback completed"
```

## DR Testing Schedule

| Test Type                | Frequency | Procedure                                      |
| ------------------------ | --------- | ---------------------------------------------- |
| **Database Replication** | Weekly    | Verify replication lag < 1 minute              |
| **Failover Test**        | Monthly   | Full failover to Hetzner, verify functionality |
| **Failback Test**        | Quarterly | Failback to DO, verify replication restored    |
| **Full DR Drill**        | Annually  | Complete DR scenario with external auditors    |

## Monitoring & Alerts

### Key Metrics

```yaml
# Prometheus alerts
groups:
  - name: dr_alerts
    rules:
      - alert: DatabaseReplicationLag
        expr: pg_replication_lag_seconds > 60
        for: 5m
        annotations:
          summary: 'Database replication lag exceeds 1 minute'

      - alert: PrimaryRegionDown
        expr: up{job="api",region="digitalocean"} == 0
        for: 2m
        annotations:
          summary: 'Primary region (DO) is down'

      - alert: SecondaryRegionDown
        expr: up{job="api",region="hetzner"} == 0
        for: 2m
        annotations:
          summary: 'Secondary region (Hetzner) is down'

      - alert: StorageReplicationFailed
        expr: minio_replication_errors_total > 10
        for: 5m
        annotations:
          summary: 'Object storage replication errors detected'
```

## Network Configuration

### DNS Setup

```
# Primary (DigitalOcean)
api.hopwhistle.com        CNAME  api-do.hopwhistle.com
www.hopwhistle.com        CNAME  web-do.hopwhistle.com

# Secondary (Hetzner) - Failover targets
api-hetzner.hopwhistle.com  A     <hetzner-ip>
web-hetzner.hopwhistle.com  A     <hetzner-ip>
```

### Load Balancer Configuration

```yaml
# DigitalOcean Load Balancer (Primary)
name: hopwhistle-primary-lb
region: nyc1
algorithm: round_robin
health_check:
  protocol: http
  port: 3001
  path: /health
  check_interval_seconds: 10
  response_timeout_seconds: 5
  healthy_threshold: 3
  unhealthy_threshold: 5
forwarding_rules:
  - entry_protocol: http
    entry_port: 80
    target_protocol: http
    target_port: 3000
  - entry_protocol: https
    entry_port: 443
    target_protocol: https
    target_port: 3000
```

## Data Synchronization

### Real-time Sync

- **Database**: Streaming replication (WAL)
- **Redis**: Redis Sentinel with replication
- **Object Storage**: MinIO/S3 replication

### Backup Sync

- **Database Backups**: Synced to Hetzner every 6 hours
- **Object Storage Backups**: Synced daily
- **Configuration Backups**: Synced on change

## Communication Plan

### During DR Event

1. **Immediate** (0-15 min)
   - Alert on-call engineer
   - Assess situation
   - Notify stakeholders

2. **Response** (15-60 min)
   - Execute failover procedures
   - Monitor health checks
   - Update status page

3. **Recovery** (1-4 hours)
   - Investigate root cause
   - Plan remediation
   - Execute failback when ready

### Stakeholder Notifications

- **Internal**: Slack #incidents channel
- **Customers**: Status page (status.hopwhistle.com)
- **Management**: Email + SMS alerts

## Post-DR Actions

1. **Root Cause Analysis**
   - Document incident
   - Identify contributing factors
   - Create action items

2. **Improvements**
   - Update DR procedures
   - Enhance monitoring
   - Improve automation

3. **Testing**
   - Verify all systems operational
   - Test replication
   - Schedule follow-up DR test

## Regional Specifications

### DigitalOcean (Primary)

- **Region**: NYC1
- **Resources**:
  - 3x API instances (2 vCPU, 4GB RAM)
  - 2x Web instances (1 vCPU, 2GB RAM)
  - 5x Worker instances (2 vCPU, 4GB RAM)
  - PostgreSQL Managed Database (4 vCPU, 8GB RAM)
  - Redis Managed Database (1 vCPU, 2GB RAM)
  - Spaces (S3-compatible) 1TB

### Hetzner (Secondary)

- **Region**: FSN1 (Falkenstein, Germany)
- **Resources**:
  - 3x API instances (CX31: 2 vCPU, 4GB RAM)
  - 2x Web instances (CX21: 2 vCPU, 4GB RAM)
  - 5x Worker instances (CX31: 2 vCPU, 4GB RAM)
  - PostgreSQL (CX41: 4 vCPU, 8GB RAM)
  - Redis (CX21: 2 vCPU, 4GB RAM)
  - Object Storage (1TB)

## Cost Considerations

- **Primary Region**: ~$500/month
- **Secondary Region**: ~$400/month
- **Replication Bandwidth**: ~$50/month
- **Total DR Cost**: ~$950/month

## References

- [PostgreSQL Streaming Replication](https://www.postgresql.org/docs/current/warm-standby.html)
- [MinIO Replication](https://min.io/docs/minio/linux/administration/object-management/replication.html)
- [DigitalOcean Managed Databases](https://docs.digitalocean.com/products/databases/)
- [Hetzner Cloud Documentation](https://docs.hetzner.com/)
