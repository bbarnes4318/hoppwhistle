# Hetzner Server Deployment Validation Checklist

This document details the exact verification commands and procedures to execute on the Hetzner server during deployment of the `edit-campaign-buyer-fix` branch, prior to DNS and carrier cutover.

---

## 1. Pre-deployment Server Checks

Run these commands to verify the base server environment on the Hetzner host.

### A. Confirm Server Basics
```bash
hostname
date
whoami
pwd
docker --version
docker compose version
git --version
free -h
df -h
```

### B. Confirm Branch
Ensure the server is running the exact validated release branch.
```bash
cd /opt/hopwhistle
git fetch origin
git checkout edit-campaign-buyer-fix
git pull origin edit-campaign-buyer-fix
git rev-parse HEAD
git status
```
*Expected Commit SHA (or ancestor containing the validation checklist changes):* `5073c288efb3b1f6f4289f3df53b726f314a0d72`

### C. Validate env file exists
```bash
test -f .env && echo ".env exists" || echo "MISSING .env"
```

### D. Validate required env vars are set
Ensure all required configuration keys are set in the `.env` file (without exposing actual secrets in reports):
```bash
grep -E "^(DATABASE_URL|REDIS_URL|CLICKHOUSE_URL|S3_ENDPOINT|S3_BUCKET|S3_ACCESS_KEY|S3_SECRET_KEY|S3_REGION|S3_FORCE_PATH_STYLE|PUBLIC_IP|SIP_PUBLIC_IP|SIP_DOMAIN|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WS_URL|NEXT_PUBLIC_SIP_DOMAIN|API_PUBLIC_URL)=" .env
```
*(To verify presence without showing values in terminal output, you can run: `grep -E "^(DATABASE_URL|REDIS_URL|CLICKHOUSE_URL|S3_ENDPOINT|S3_BUCKET|S3_ACCESS_KEY|S3_SECRET_KEY|S3_REGION|S3_FORCE_PATH_STYLE|PUBLIC_IP|SIP_PUBLIC_IP|SIP_DOMAIN|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WS_URL|NEXT_PUBLIC_SIP_DOMAIN|API_PUBLIC_URL)=" .env | cut -d'=' -f1`)*

---

## 2. Docker Validation and Build

Since Docker validation could not be run on the local workstation, these checks must be executed on the Hetzner host.

### E. Validate Docker compose config
Ensure that Docker Compose can parse the compose file and resolve all variables cleanly:
```bash
docker compose --env-file .env config
```
If production uses specific compose files, also run:
```bash
docker compose -f infra/docker/docker-compose.yml --env-file .env config
```
And if applicable:
```bash
docker compose -f infra/docker/docker-compose.dev.yml -f infra/docker/docker-compose.prod.yml --env-file .env config
```

### F. Build Docker images
Build the container images on the host:
```bash
docker compose --env-file .env build
```

### G. Start stack
Start all services in detached mode:
```bash
docker compose --env-file .env up -d
```

---

## 3. Service Verification Checklist

Execute these validation commands on the Hetzner server to verify each component of the stack.

### H. Check containers
Verify that all containers are running and healthy:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### I. Check API health
Check the API liveness and backend dependencies status:
```bash
curl -s http://localhost:3001/health/live
curl -s http://localhost:3001/health/ready
```

### J. Check web
Verify the Next.js web application is up and responding:
```bash
curl -I http://localhost:3000
```

### K. Check PostgreSQL
Confirm the database is populated and the restored tables are present (Note: identify the Postgres container ID/name using `docker ps` first):
```bash
docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] psql -U callfabric -d callfabric -c "\dt"
```

### L. Check Redis
```bash
docker compose exec redis redis-cli ping
```
*Expected:*
```
PONG
```

### M. Check ClickHouse
```bash
curl -s http://localhost:8123/ping
```
*Expected:*
```
Ok.
```

### N. Check S3/MinIO bucket access
Verify the host can list the migrated recordings in the bucket:
```bash
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET"
```

### O. Check FreeSWITCH
Verify FreeSWITCH is healthy and listening on the designated SIP profiles:
```bash
docker compose exec freeswitch fs_cli -x "status"
docker compose exec freeswitch fs_cli -x "sofia status"
docker compose exec freeswitch fs_cli -x "sofia status profile external"
docker compose exec freeswitch fs_cli -x "sofia status profile vapi"
```

### P. Check that FreeSWITCH loaded the Hetzner IP/domain variables
Ensure FreeSWITCH loaded the environment-substituted Hetzner parameters instead of the old hardcoded AWS IP:
```bash
docker compose exec freeswitch fs_cli -x "global_getvar public_ip"
docker compose exec freeswitch fs_cli -x "global_getvar sip_public_ip"
docker compose exec freeswitch fs_cli -x "global_getvar domain"
```
*Expected:*
- `public_ip` should be Hetzner public IP
- `sip_public_ip` should be Hetzner public IP
- `domain` should be SIP_DOMAIN / production domain

### Q. Check WSS/SIP WebSocket
Test the softphone WebRTC signaling socket:
```bash
wscat -c wss://hopwhistle.com/ws -p sip
```
*(If testing before DNS cutover, use the temporary Hetzner hostname or direct IP with proper TLS caveats.)*

### R. Check recording upload path
Simulate a call recording completion and check if the upload script correctly transfers the asset to the bucket:
```bash
echo "test-audio" > /tmp/test_call.wav
docker compose exec freeswitch /usr/share/freeswitch/scripts/upload-recording.sh /tmp/test_call.wav test_call_id
```
Then verify:
```bash
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET"
```

### S. Check logs
Spot-check recent logs for errors or startup warnings:
```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 web
docker compose logs --tail=100 worker
docker compose logs --tail=100 transcriber
docker compose logs --tail=100 freeswitch
docker compose logs --tail=100 kamailio
docker compose logs --tail=100 rtpengine
```

---

## 4. Final Cutover Checklist

Follow this checklist during the maintenance window to execute the production cutover.

### Pre-cutover:
- [ ] Reduce DNS TTL to 300 seconds.
- [ ] Confirm AWS database dump is complete.
- [ ] Confirm AWS recordings sync is complete.
- [ ] Confirm Hetzner database restore is complete.
- [ ] Confirm rclone size/check passes or differences are documented.
- [ ] Confirm Hetzner stack health checks pass.
- [ ] Confirm outbound call test passes.
- [ ] Confirm inbound call test passes.
- [ ] Confirm Vapi SIP test passes.
- [ ] Confirm WSS softphone registration passes.
- [ ] Confirm audio works both directions.
- [ ] Confirm recording upload/playback works.
- [ ] Confirm rollback commands are ready.

### Cutover:
- [ ] Update DNS A records to Hetzner IP.
- [ ] Update carrier inbound SIP routes to Hetzner.
- [ ] Update Vapi SIP trunk target to Hetzner.
- [ ] Update BulkVS / SignalWire / Telnyx / Anveo / any DID provider routing as applicable.
- [ ] Monitor logs for 30–60 minutes after cutover.

### Rollback:
If critical verification steps fail after the cutover, immediately execute the following rollback:
1.  **Repoint DNS**: Revert DNS records to point to the AWS public IP: `3.214.60.13`.
2.  **Repoint Carriers**: Update carrier/Vapi SIP routing to AWS IP `3.214.60.13`.
3.  **Restart AWS Stack**: Restart the application stack on AWS:
    ```bash
    cd /opt/hopwhistle
    docker compose start api worker transcriber freeswitch
    ```
4.  **Verify AWS**: Confirm AWS health and calls work again.
