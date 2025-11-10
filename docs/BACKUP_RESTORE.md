# Backup & Restore Procedures

## Overview

This document outlines backup and restore procedures for Hopwhistle production infrastructure, including databases, object storage, and configuration files.

## Backup Strategy

### Backup Types

1. **Full Backup**: Complete backup of all data
2. **Incremental Backup**: Only changed data since last backup
3. **Differential Backup**: All data changed since last full backup
4. **Point-in-Time Recovery**: Continuous transaction log backups

### Backup Schedule

| Resource   | Frequency      | Retention | Type         |
| ---------- | -------------- | --------- | ------------ |
| PostgreSQL | Every 6 hours  | 30 days   | Full + WAL   |
| MinIO/S3   | Daily          | 90 days   | Full         |
| Redis      | Every 12 hours | 7 days    | RDB snapshot |
| Configs    | On change      | 90 days   | Full         |
| Secrets    | On change      | 365 days  | Encrypted    |

## PostgreSQL Backup

### Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-postgres.sh

set -e

BACKUP_DIR="/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Full backup
pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --file="$BACKUP_DIR/full_${TIMESTAMP}.dump" \
  --verbose

# Compress backup
gzip "$BACKUP_DIR/full_${TIMESTAMP}.dump"

# Remove old backups
find "$BACKUP_DIR" -name "full_*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR/full_${TIMESTAMP}.dump.gz"
```

### Continuous WAL Archiving

Configure PostgreSQL for continuous archiving:

```sql
-- postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /backups/postgres/wal/%f'
max_wal_senders = 3
```

### Backup Verification

```bash
#!/bin/bash
# scripts/verify-postgres-backup.sh

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file>"
  exit 1
fi

# Test restore to temporary database
TEMP_DB="backup_test_$(date +%s)"

createdb "$TEMP_DB"

if pg_restore --dbname="$TEMP_DB" "$BACKUP_FILE"; then
  echo "✅ Backup is valid"
  dropdb "$TEMP_DB"
  exit 0
else
  echo "❌ Backup is invalid"
  dropdb "$TEMP_DB"
  exit 1
fi
```

### Restore Procedure

#### Full Restore

```bash
#!/bin/bash
# scripts/restore-postgres.sh

set -e

BACKUP_FILE="$1"
TARGET_DB="$2"

if [ -z "$BACKUP_FILE" ] || [ -z "$TARGET_DB" ]; then
  echo "Usage: $0 <backup_file> <target_database>"
  exit 1
fi

# Stop application (optional, for zero-downtime use replication)
# systemctl stop hopwhistle-api

# Drop existing database (CAUTION: Destructive)
dropdb --if-exists "$TARGET_DB"

# Create new database
createdb "$TARGET_DB"

# Restore backup
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | pg_restore --dbname="$TARGET_DB" --verbose
else
  pg_restore --dbname="$TARGET_DB" --verbose "$BACKUP_FILE"
fi

# Run migrations (if needed)
# cd /app && pnpm --filter @hopwhistle/api db:migrate:deploy

# Verify restore
psql "$TARGET_DB" -c "SELECT COUNT(*) FROM calls;"
psql "$TARGET_DB" -c "SELECT COUNT(*) FROM tenants;"

echo "✅ Restore completed"

# Restart application
# systemctl start hopwhistle-api
```

#### Point-in-Time Recovery

```bash
#!/bin/bash
# scripts/restore-postgres-pitr.sh

set -e

RECOVERY_TIME="$1"  # Format: '2024-01-15 14:30:00'
BASE_BACKUP="$2"

if [ -z "$RECOVERY_TIME" ] || [ -z "$BASE_BACKUP" ]; then
  echo "Usage: $0 <recovery_time> <base_backup>"
  exit 1
fi

# Restore base backup
pg_restore --dbname=postgres "$BASE_BACKUP"

# Configure recovery
cat > /var/lib/postgresql/data/recovery.conf <<EOF
restore_command = 'cp /backups/postgres/wal/%f %p'
recovery_target_time = '$RECOVERY_TIME'
recovery_target_action = 'promote'
EOF

# Start PostgreSQL in recovery mode
systemctl start postgresql

# Monitor recovery
tail -f /var/log/postgresql/postgresql.log
```

## MinIO/S3 Backup

### Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-minio.sh

set -e

BACKUP_DIR="/backups/minio"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=90
BUCKET="hopwhistle-recordings"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Sync bucket to local storage
mc mirror \
  --overwrite \
  --remove \
  --exclude "*.tmp" \
  "$BUCKET" \
  "$BACKUP_DIR/$TIMESTAMP"

# Compress backup
tar -czf "$BACKUP_DIR/minio_${TIMESTAMP}.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
rm -rf "$BACKUP_DIR/$TIMESTAMP"

# Upload to offsite storage (optional)
# aws s3 cp "$BACKUP_DIR/minio_${TIMESTAMP}.tar.gz" \
#   "s3://backup-bucket/minio_${TIMESTAMP}.tar.gz"

# Remove old backups
find "$BACKUP_DIR" -name "minio_*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR/minio_${TIMESTAMP}.tar.gz"
```

### Restore Procedure

```bash
#!/bin/bash
# scripts/restore-minio.sh

set -e

BACKUP_FILE="$1"
TARGET_BUCKET="$2"

if [ -z "$BACKUP_FILE" ] || [ -z "$TARGET_BUCKET" ]; then
  echo "Usage: $0 <backup_file> <target_bucket>"
  exit 1
fi

# Extract backup
TEMP_DIR=$(mktemp -d)
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Restore to bucket
mc mirror \
  --overwrite \
  "$TEMP_DIR" \
  "$TARGET_BUCKET"

# Cleanup
rm -rf "$TEMP_DIR"

echo "✅ Restore completed"
```

## Redis Backup

### Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-redis.sh

set -e

BACKUP_DIR="/backups/redis"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Trigger RDB snapshot
redis-cli BGSAVE

# Wait for save to complete
while [ "$(redis-cli LASTSAVE)" -eq "$(redis-cli LASTSAVE)" ]; do
  sleep 1
done

# Copy RDB file
cp /var/lib/redis/dump.rdb "$BACKUP_DIR/redis_${TIMESTAMP}.rdb"

# Compress backup
gzip "$BACKUP_DIR/redis_${TIMESTAMP}.rdb"

# Remove old backups
find "$BACKUP_DIR" -name "redis_*.rdb.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR/redis_${TIMESTAMP}.rdb.gz"
```

### Restore Procedure

```bash
#!/bin/bash
# scripts/restore-redis.sh

set -e

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file>"
  exit 1
fi

# Stop Redis
systemctl stop redis

# Decompress backup
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" > /var/lib/redis/dump.rdb
else
  cp "$BACKUP_FILE" /var/lib/redis/dump.rdb
fi

# Set permissions
chown redis:redis /var/lib/redis/dump.rdb
chmod 600 /var/lib/redis/dump.rdb

# Start Redis
systemctl start redis

# Verify restore
redis-cli PING

echo "✅ Restore completed"
```

## Configuration Backup

### Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-configs.sh

set -e

BACKUP_DIR="/backups/configs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=90

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup configuration files
tar -czf "$BACKUP_DIR/configs_${TIMESTAMP}.tar.gz" \
  /etc/hopwhistle \
  /opt/hopwhistle/config \
  /var/lib/hopwhistle/secrets

# Encrypt backup (if containing secrets)
gpg --encrypt --recipient backup@hopwhistle.com \
  "$BACKUP_DIR/configs_${TIMESTAMP}.tar.gz"
rm "$BACKUP_DIR/configs_${TIMESTAMP}.tar.gz"

# Remove old backups
find "$BACKUP_DIR" -name "configs_*.tar.gz.gpg" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR/configs_${TIMESTAMP}.tar.gz.gpg"
```

### Restore Procedure

```bash
#!/bin/bash
# scripts/restore-configs.sh

set -e

BACKUP_FILE="$1"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file>"
  exit 1
fi

# Decrypt backup
gpg --decrypt "$BACKUP_FILE" > /tmp/configs_restore.tar.gz

# Extract to temporary location
TEMP_DIR=$(mktemp -d)
tar -xzf /tmp/configs_restore.tar.gz -C "$TEMP_DIR"

# Review changes (IMPORTANT: Verify before restoring)
echo "Reviewing configuration files..."
ls -la "$TEMP_DIR"

# Restore (manual step - verify paths)
# cp -r "$TEMP_DIR/etc/hopwhistle" /etc/
# cp -r "$TEMP_DIR/opt/hopwhistle/config" /opt/hopwhistle/
# cp -r "$TEMP_DIR/var/lib/hopwhistle/secrets" /var/lib/hopwhistle/

# Cleanup
rm -rf "$TEMP_DIR" /tmp/configs_restore.tar.gz

echo "✅ Restore completed (verify manually)"
```

## Secrets Backup

### Automated Backup Script

```bash
#!/bin/bash
# scripts/backup-secrets.sh

set -e

BACKUP_DIR="/backups/secrets"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=365

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Export secrets from KMS/Secrets Manager
# DigitalOcean
doctl compute ssh-key list > "$BACKUP_DIR/ssh_keys_${TIMESTAMP}.txt"
doctl databases connection-pool list > "$BACKUP_DIR/db_pools_${TIMESTAMP}.txt"

# Kubernetes secrets (if applicable)
kubectl get secrets -n hopwhistle -o yaml > "$BACKUP_DIR/k8s_secrets_${TIMESTAMP}.yaml"

# Encrypt all secrets
tar -czf - "$BACKUP_DIR"/*_${TIMESTAMP}.* | \
  gpg --encrypt --recipient secrets@hopwhistle.com > \
  "$BACKUP_DIR/secrets_${TIMESTAMP}.tar.gz.gpg"

# Remove unencrypted files
rm "$BACKUP_DIR"/*_${TIMESTAMP}.*

# Remove old backups
find "$BACKUP_DIR" -name "secrets_*.tar.gz.gpg" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_DIR/secrets_${TIMESTAMP}.tar.gz.gpg"
```

## Disaster Recovery Testing

### Test Schedule

- **Weekly**: Verify backup completion and integrity
- **Monthly**: Test restore to staging environment
- **Quarterly**: Full DR drill with failover
- **Annually**: Complete DR test with external auditors

### Test Procedure

```bash
#!/bin/bash
# scripts/test-dr.sh

set -e

echo "🧪 Starting DR Test..."

# 1. Verify backups exist
echo "1. Checking backups..."
test -f /backups/postgres/latest.dump.gz || exit 1
test -f /backups/minio/latest.tar.gz || exit 1
test -f /backups/redis/latest.rdb.gz || exit 1

# 2. Restore to staging
echo "2. Restoring to staging..."
./scripts/restore-postgres.sh /backups/postgres/latest.dump.gz hopwhistle_staging
./scripts/restore-minio.sh /backups/minio/latest.tar.gz hopwhistle-staging-recordings
./scripts/restore-redis.sh /backups/redis/latest.rdb.gz

# 3. Verify data integrity
echo "3. Verifying data integrity..."
psql hopwhistle_staging -c "SELECT COUNT(*) FROM calls;" | grep -q "[0-9]"
psql hopwhistle_staging -c "SELECT COUNT(*) FROM tenants;" | grep -q "[0-9]"

# 4. Test application functionality
echo "4. Testing application..."
curl -f http://staging.hopwhistle.com/health || exit 1

echo "✅ DR Test completed successfully"
```

## Backup Monitoring

### Health Checks

```bash
#!/bin/bash
# scripts/check-backups.sh

ALERT_EMAIL="ops@hopwhistle.com"
MAX_AGE_HOURS=24

# Check PostgreSQL backup age
PG_BACKUP=$(find /backups/postgres -name "full_*.dump.gz" -mtime -1 | head -1)
if [ -z "$PG_BACKUP" ]; then
  echo "ALERT: No PostgreSQL backup in last 24 hours" | mail -s "Backup Alert" "$ALERT_EMAIL"
fi

# Check MinIO backup age
MINIO_BACKUP=$(find /backups/minio -name "minio_*.tar.gz" -mtime -1 | head -1)
if [ -z "$MINIO_BACKUP" ]; then
  echo "ALERT: No MinIO backup in last 24 hours" | mail -s "Backup Alert" "$ALERT_EMAIL"
fi

# Check backup disk space
DISK_USAGE=$(df -h /backups | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
  echo "ALERT: Backup disk usage at ${DISK_USAGE}%" | mail -s "Backup Alert" "$ALERT_EMAIL"
fi
```

## Offsite Backup

### Automated Offsite Sync

```bash
#!/bin/bash
# scripts/sync-offsite.sh

# Sync to secondary region (Hetzner)
rsync -avz --delete \
  /backups/ \
  backup@hetzner-backup.hopwhistle.com:/backups/primary/

# Sync to cloud storage (S3)
aws s3 sync /backups/ \
  s3://hopwhistle-backups/primary/ \
  --storage-class GLACIER \
  --delete
```

## Recovery Time Objectives (RTO) & Recovery Point Objectives (RPO)

| Resource   | RTO        | RPO       |
| ---------- | ---------- | --------- |
| PostgreSQL | 1 hour     | 6 hours   |
| MinIO/S3   | 2 hours    | 24 hours  |
| Redis      | 30 minutes | 12 hours  |
| Configs    | 15 minutes | On change |
| Secrets    | 30 minutes | On change |

## Emergency Contacts

- **On-Call Engineer**: +1-XXX-XXX-XXXX
- **Database Admin**: +1-XXX-XXX-XXXX
- **Infrastructure Lead**: +1-XXX-XXX-XXXX
- **Security Team**: security@hopwhistle.com

## References

- [PostgreSQL Backup Documentation](https://www.postgresql.org/docs/current/backup.html)
- [MinIO Backup Guide](https://min.io/docs/minio/linux/administration/object-management/backup-restore.html)
- [Redis Persistence](https://redis.io/docs/management/persistence/)
