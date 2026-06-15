# Hoppwhistle Production Migration Guide: AWS to Hetzner

This document details the playbook and instructions to migrate the Hoppwhistle production stack from AWS to Hetzner.

## 1. Migration Overview & IP Definitions

To ensure a smooth transition, we define the role of all active environments below.

*   **AWS (Source of Truth)**:
    *   **Public IP**: `3.214.60.13`
    *   **Project Path**: `/opt/hopwhistle`
    *   **Database**: PostgreSQL database `callfabric`, user `callfabric`, host `hopwhistle-postgres-dev`
    *   **Recordings S3 Bucket**: `hopwhistle-recordings-prod` (Region: `us-east-1`, EBS volume: 200 GB gp3)
    *   **Role**: Current live production. **This is the single source of truth for database and media migration.**
*   **Hetzner (Target Production)**:
    *   **Hetzner Project Name**: `hopwhistle`
    *   **Target IP**: *[To be assigned upon server provisioning]*
    *   **Role**: New production environment.
*   **Vultr (Stale/Legacy Only)**:
    *   **Public IP**: `45.32.213.201`
    *   **Role**: Legacy server. **DO NOT migrate database data, logs, or recordings from Vultr.** Treat Vultr references as historical/inactive.

---

## 2. Step-by-Step Migration Playbook

### Step 2.1: Stop Write-Heavy Services on AWS
To prevent data drift and out-of-sync database/recording assets during the dump and sync processes, stop all active application services on the AWS instance. Leave only the database and storage services running for retrieval.

1.  SSH into the AWS EC2 instance:
    ```bash
    ssh -i ~/.ssh/hopwhistle-aws.pem ubuntu@3.214.60.13
    ```
2.  Navigate to the project directory:
    ```bash
    cd /opt/hopwhistle
    ```
3.  Stop write-heavy containers (API, worker, transcriber, and FreeSWITCH):
    ```bash
    docker compose stop api worker transcriber freeswitch
    ```
4.  Confirm only PostgreSQL, Redis, and ClickHouse are running:
    ```bash
    docker ps
    ```

---

### Step 2.2: Dump PostgreSQL Database from AWS
We will perform a binary custom-format dump of the `callfabric` PostgreSQL database, which is fast and supports parallel restores.

1.  On the AWS EC2 instance, execute `pg_dump` to create a backup file:
    ```bash
    docker exec -t hopwhistle-postgres-dev pg_dump -U callfabric -d callfabric -F c -b -v -f /tmp/callfabric_backup.dump
    ```
2.  Copy the backup file from the container to the host filesystem:
    ```bash
    docker cp hopwhistle-postgres-dev:/tmp/callfabric_backup.dump ./callfabric_backup.dump
    ```
3.  Verify the dump file was created and has non-zero size:
    ```bash
    ls -lh callfabric_backup.dump
    ```

---

### Step 2.3: Sync S3 Recordings to Hetzner MinIO/S3
Recordings are stored in AWS S3 (`hopwhistle-recordings-prod`). We need to sync them to the Hetzner S3-compatible storage (or local MinIO instance). AWS is the single source of truth; do not pull or migrate any recordings from Vultr.

#### Method A: Sync using `rclone` (Recommended Primary Method)
Configure `rclone` with two remotes (`aws` and `hetzner`) and execute the following to sync with optimal performance parameters:
```bash
rclone sync aws:hopwhistle-recordings-prod hetzner:hopwhistle-recordings --progress --transfers 16 --checkers 32
```

#### Method B: Two-Step Fallback Sync via Local Storage (AWS CLI)
If `rclone` is unavailable, use this safe two-step fallback using the `aws-cli`:
```bash
# Step 1: Sync from AWS S3 to local temporary backup folder
aws s3 sync s3://hopwhistle-recordings-prod ./recordings-backup --source-region us-east-1

# Step 2: Sync from local temporary backup folder to Hetzner S3-compatible recordings bucket
aws --endpoint-url "$HETZNER_S3_ENDPOINT" s3 sync ./recordings-backup s3://hopwhistle-recordings
```

*Note: Verify object counts and spot-check playback of recordings after the synchronization has completed.*

---

### Step 2.4: Copy Configurations, Certs, and Local Keys
Copy the configuration files, certificates, and TLS files from the AWS host to the Hetzner host.

1.  **Environment File**: Copy `/opt/hopwhistle/.env` to the Hetzner host. Update the environment variables to use Hetzner credentials (see **Section 3** for key update lists).
2.  **TLS Certificates**: Copy Let's Encrypt certificates located at `/etc/letsencrypt/live/hopwhistle.com/` to the corresponding path on the Hetzner host.
3.  **STIR/SHAKEN Key**: Copy your private carrier STIR/SHAKEN signing keys (typically located at `/opt/hopwhistle/certs/shaken/` or similar path) to the same directory on the Hetzner host.
4.  **Nginx Configuration**: Copy `/etc/nginx/sites-available/hopwhistle` (or `/opt/hopwhistle/infra/nginx/hopwhistle`) to the Hetzner host's Nginx configuration folder.
5.  **Local FreeSWITCH Audio**: Copy any local WAV recordings and custom sound files from `/var/recordings` or `/recordings` from AWS to Hetzner.

---

### Step 2.5: Restore PostgreSQL to Hetzner
1.  Transfer the `callfabric_backup.dump` from the AWS host to the Hetzner host:
    ```bash
    scp ./callfabric_backup.dump ubuntu@[HETZNER_IP]:/tmp/
    ```
2.  SSH into the Hetzner instance and copy the backup file into the postgres container:
    ```bash
    docker cp /tmp/callfabric_backup.dump [HETZNER_POSTGRES_CONTAINER_ID]:/tmp/
    ```
3.  Drop the target database (if it exists) and recreate it to ensure a clean slate, then restore the dump:
    ```bash
    docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] dropdb -U callfabric --if-exists callfabric
    docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] createdb -U callfabric callfabric
    docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] pg_restore -U callfabric -d callfabric -v /tmp/callfabric_backup.dump
    ```

### Step 2.5.1: Database and Recordings Verification Checklist

Perform these checks immediately after database restoration and recordings sync.

#### Database verification:
```bash
# List all tables in the database
docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] psql -U callfabric -d callfabric -c "\dt"

# Count total records in the Call table
docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] psql -U callfabric -d callfabric -c "select count(*) from \"Call\";"
```

> [!NOTE]
> Database table names may differ depending on the schema version. If the `Call` table does not exist or errors out, list the tables first using the `\dt` command above to verify the actual call/recording-related table names (such as lowercase `calls` or plural `Call`).

#### Recordings verification:
```bash
# Verify AWS source size and object count
rclone size aws:hopwhistle-recordings-prod

# Verify Hetzner target size and object count
rclone size hetzner:hopwhistle-recordings

# Compare source and target buckets
rclone check aws:hopwhistle-recordings-prod hetzner:hopwhistle-recordings --one-way
```

> [!IMPORTANT]
> Verify that the object counts match or are within expected ranges, and spot-check/validate the playback of a few migrated recording files. Do not pull or sync any recordings from Vultr.

---

### Step 2.6: Start Hetzner Stack
1.  Navigate to the project path on the Hetzner host:
    ```bash
    cd /opt/hopwhistle
    ```
2.  Launch the stack:
    ```bash
    docker compose --env-file .env up -d
    ```

---

### Step 2.7: Run Prisma Generate & Migrate
After restoring the database, run Prisma migrations to deploy any schema changes that might be in the codebase but not yet applied.

1.  Generate the client:
    ```bash
    docker compose exec api npx prisma generate
    ```
2.  Deploy migrations (this runs in non-interactive deploy mode):
    ```bash
    docker compose exec api npx prisma migrate deploy
    ```

---

## 3. Environment Variable Checklist

When setting up the Hetzner `.env` files, ensure the following variables are customized:

| Env Var | Description / Value |
| :--- | :--- |
| `PUBLIC_IP` | Public IP of the Hetzner host |
| `SIP_PUBLIC_IP` | Public SIP IP (identical to `PUBLIC_IP` unless utilizing multi-homing) |
| `SIP_DOMAIN` | Target domain name for SIP client registrations (e.g., `hopwhistle.com`) |
| `DATABASE_URL` | `postgresql://callfabric:[PASSWORD]@[HETZNER_DB_HOST]:5432/callfabric` |
| `REDIS_URL` | `redis://:[PASSWORD]@[HETZNER_REDIS_HOST]:6379` |
| `CLICKHOUSE_URL` | `http://[HETZNER_CLICKHOUSE_HOST]:8123` |
| `S3_ENDPOINT` | MinIO / S3 endpoint URL |
| `S3_BUCKET` | Recording bucket name |
| `S3_ACCESS_KEY` | MinIO / S3 access key |
| `S3_SECRET_KEY` | MinIO / S3 secret key |
| `S3_REGION` | Storage region (e.g., `us-east-1`) |
| `S3_FORCE_PATH_STYLE` | `true` |
| `API_PUBLIC_URL` | Public URL for the API (e.g., `https://api.hopwhistle.com`) |
| `NEXT_PUBLIC_API_URL` | Frontend client public API URL (e.g., `https://api.hopwhistle.com`) |
| `NEXT_PUBLIC_WS_URL` | Frontend client WebSocket URL (e.g., `wss://hopwhistle.com/ws`) |

> [!WARNING]
> Do not commit or hardcode credentials into any environment template files. Ensure all secrets are kept out of Git.

---

## 4. Verification Procedures

Execute these validation commands on the Hetzner host to ensure the platform is functioning correctly.

### 4.1. General Docker Status
Ensure all containers are running and healthy:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### 4.2. API /health and Readiness Checks
Verify the API is running and that its backend dependencies are reachable:
```bash
# Check service liveness
curl -s http://localhost:3001/health/live

# Check backend dependencies (DB, Redis, Clickhouse)
curl -s http://localhost:3001/health/ready
```

### 4.3. Prisma Database Connection
Confirm Prisma can query the database:
```bash
docker compose exec api npx prisma db pull --print
```

### 4.4. Redis Ping
Ensure Redis is active and accessible:
```bash
docker compose exec redis redis-cli ping
```
*Expected output: `PONG`*

### 4.5. ClickHouse Ping
Verify ClickHouse analytics database connection:
```bash
curl -s http://localhost:8123/ping
```
*Expected output: `Ok.`*

### 4.6. S3/MinIO List Bucket
Verify connection to the S3-compatible recordings bucket:
```bash
aws --endpoint-url http://localhost:9000 s3 ls s3://hopwhistle-recordings
```

### 4.7. Recording Upload/Playback
To test file uploads manually, trigger the upload script on a mock file:
```bash
# Create dummy recording
echo "test-audio" > /tmp/test_call.wav
# Run the upload script manually
docker compose exec freeswitch /usr/share/freeswitch/scripts/upload-recording.sh /tmp/test_call.wav test_call_id
```
Verify the file is uploaded to the bucket:
```bash
aws --endpoint-url http://localhost:9000 s3 ls s3://hopwhistle-recordings/test_call_id.wav
```

### 4.8. FreeSWITCH Status
Verify the FreeSWITCH core is running:
```bash
docker compose exec freeswitch fs_cli -x "status"
```

### 4.9. SIP OPTIONS & Registration Status
Check registration status and ensure external trunks/gateways (like BulkVS) are active:
```bash
# Verify internal profile registrations
docker compose exec freeswitch fs_cli -x "sofia status profile internal reg"

# Verify external gateway registration status
docker compose exec freeswitch fs_cli -x "sofia status"
```

### 4.10. Vapi SIP Trunk Validation
Check that the dedicated Vapi SIP profile on port 5070 is up and listening:
```bash
docker compose exec freeswitch fs_cli -x "sofia status profile vapi"
```

### 4.11. WebSockets (WSS) /ws Connectivity
Test that client WebRTC connections can reach the WSS port:
```bash
# Install wscat if not present, then connect to the WebSocket endpoint
npm install -g wscat
wscat -c wss://localhost:7443 -p sip
```
*Expected response: Connection established, protocol upgraded to SIP.*

---

## 5. DNS / Carrier Cutover Plan

1.  **TTL Reduction**: Reduce DNS TTL for `hopwhistle.com` and all subdomains (`api.hopwhistle.com`, `wss.hopwhistle.com`) to 300 seconds (5 minutes) at least 24 hours prior to migration.
2.  **DNS Switch**: Update A/AAAA records at your DNS registrar/provider to point to the new Hetzner Public IP.
3.  **Vapi Trunk Update**: Log in to the Vapi dashboard (or run carrier provisioning scripts) and update the SIP trunk IP addresses to point to the Hetzner IP.
4.  **BulkVS / DID Carrier Target Update**: Update inbound SIP trunk targets and DID routing rules at BulkVS (and other carriers) to route inbound traffic to port `5060` (Kamailio) or `5080` (FreeSWITCH) of the Hetzner public IP.

---

## 6. Rollback Plan

If critical verification steps fail during or immediately after the cutover:

1.  **Revert DNS**: Point all DNS records (A/AAAA) back to the AWS Public IP: `3.214.60.13`.
2.  **Revert Carriers**: Update carrier routing targets (BulkVS, Vapi, SignalWire) back to `3.214.60.13`.
3.  **Restart AWS Stack**: On the AWS host, start all application services:
    ```bash
    cd /opt/hopwhistle
    docker compose start api worker transcriber freeswitch
    ```
4.  **Verification**: Confirm services are operational on AWS using the validation steps in **Section 4**.
