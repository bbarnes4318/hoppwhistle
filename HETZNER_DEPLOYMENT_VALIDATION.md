# Hetzner Server Deployment Validation Checklist

This document details the exact verification commands and procedures to execute on the Hetzner server during deployment of the `edit-campaign-buyer-fix` branch, prior to DNS and carrier cutover.

---

## 1. Server basics

Execute these basic system and environment diagnostics on the Hetzner host:

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

---

## 2. Pull the correct branch

Ensure the server is running the exact validated release branch and commit:

```bash
cd /opt/hopwhistle
git fetch origin
git checkout edit-campaign-buyer-fix
git pull origin edit-campaign-buyer-fix
git rev-parse HEAD
git status
```
*Expected Commit SHA:* `561623972cb2d54ed0bbe872390414f9fd32484d`

---

## 3. Confirm .env exists

```bash
test -f .env && echo ".env exists" || echo "MISSING .env"
```

---

## 4. Confirm required env vars are present without printing secrets

Run this script block to verify that all required production keys are set in the `.env` file without exposing their secret values:

```bash
for key in DATABASE_URL REDIS_URL CLICKHOUSE_URL S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY S3_REGION S3_FORCE_PATH_STYLE PUBLIC_IP SIP_PUBLIC_IP SIP_DOMAIN NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL NEXT_PUBLIC_SIP_DOMAIN API_PUBLIC_URL; do
  if grep -q "^${key}=" .env; then
    echo "OK: ${key} is set"
  else
    echo "MISSING: ${key}"
  fi
done
```

---

## 5. Docker compose validation

Validate the syntax and variable interpolation of the compose configurations:

```bash
docker compose --env-file .env config
```

Also run these if applicable:

```bash
docker compose -f infra/docker/docker-compose.yml --env-file .env config
```

```bash
docker compose -f infra/docker/docker-compose.dev.yml -f infra/docker/docker-compose.prod.yml --env-file .env config
```

---

## 6. Docker build

Build the application images from source on the host:

```bash
docker compose --env-file .env build
```

---

## 7. Start stack

Run the services in detached mode:

```bash
docker compose --env-file .env up -d
```

---

## 8. Check containers

Verify container names, statuses, and ports:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

---

## 9. API health

```bash
curl -s http://localhost:3001/health/live
curl -s http://localhost:3001/health/ready
```

---

## 10. Web health

```bash
curl -I http://localhost:3000
```

---

## 11. PostgreSQL check

List the database tables (use the actual Hetzner PostgreSQL container name once known):

```bash
docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] psql -U callfabric -d callfabric -c "\dt"
```

Also verify call records count:

```bash
docker exec -it [HETZNER_POSTGRES_CONTAINER_ID] psql -U callfabric -d callfabric -c "select count(*) from \"Call\";"
```

> [!NOTE]
> If "Call" does not exist, list tables first and check the correct call/recording-related table name.

---

## 12. Redis check

```bash
docker compose exec redis redis-cli ping
```
*Expected:*
```
PONG
```

---

## 13. ClickHouse check

```bash
curl -s http://localhost:8123/ping
```
*Expected:*
```
Ok.
```

---

## 14. S3/MinIO bucket check

```bash
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET"
```

---

## 15. FreeSWITCH checks

```bash
docker compose exec freeswitch fs_cli -x "status"
docker compose exec freeswitch fs_cli -x "sofia status"
docker compose exec freeswitch fs_cli -x "sofia status profile external"
docker compose exec freeswitch fs_cli -x "sofia status profile vapi"
```

---

## 16. Confirm FreeSWITCH loaded Hetzner variables

Verify environment-substituted parameters are active:

```bash
docker compose exec freeswitch fs_cli -x "global_getvar public_ip"
docker compose exec freeswitch fs_cli -x "global_getvar sip_public_ip"
docker compose exec freeswitch fs_cli -x "global_getvar domain"
```
*Expected:*
- `public_ip` equals the Hetzner public IP
- `sip_public_ip` equals the Hetzner public IP
- `domain` equals SIP_DOMAIN / production SIP domain

---

## 17. WSS/SIP WebSocket check

```bash
wscat -c wss://hopwhistle.com/ws -p sip
```
> [!NOTE]
> If testing before DNS cutover, use the temporary Hetzner hostname or direct IP only if TLS/cert behavior is understood.

---

## 18. Recording upload test

```bash
echo "test-audio" > /tmp/test_call.wav
docker compose exec freeswitch /usr/share/freeswitch/scripts/upload-recording.sh /tmp/test_call.wav test_call_id
```

Then verify:

```bash
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET"
```

---

## 19. Logs to review

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

## 20. Final Cutover Checklist

Execute these steps during the migration maintenance window.

### Pre-cutover checklist:
- [ ] Reduce DNS TTL to 300 seconds.
- [ ] Confirm AWS database dump completed successfully.
- [ ] Confirm AWS recordings sync completed successfully.
- [ ] Confirm Hetzner database restore completed successfully.
- [ ] Confirm rclone size/check passes or differences are documented.
- [ ] Confirm Hetzner Docker compose config passes.
- [ ] Confirm Hetzner Docker build passes.
- [ ] Confirm Hetzner stack starts successfully.
- [ ] Confirm API health passes.
- [ ] Confirm web loads.
- [ ] Confirm PostgreSQL query works.
- [ ] Confirm Redis ping works.
- [ ] Confirm ClickHouse ping works.
- [ ] Confirm S3/MinIO bucket access works.
- [ ] Confirm FreeSWITCH status works.
- [ ] Confirm external SIP profile works.
- [ ] Confirm Vapi SIP profile works.
- [ ] Confirm WSS softphone registration works.
- [ ] Confirm outbound call works.
- [ ] Confirm inbound call works.
- [ ] Confirm two-way audio works.
- [ ] Confirm recording upload/playback works.
- [ ] Confirm rollback commands are ready.

### Cutover checklist:
- [ ] Update DNS A records to Hetzner IP.
- [ ] Update carrier inbound SIP routes to Hetzner.
- [ ] Update Vapi SIP trunk target to Hetzner.
- [ ] Update BulkVS routing if used.
- [ ] Update SignalWire routing if used.
- [ ] Update Telnyx routing if used.
- [ ] Update Anveo routing if used.
- [ ] Update any other DID/SIP provider routes.
- [ ] Monitor logs for at least 30–60 minutes after cutover.

### Rollback checklist:
- [ ] Repoint DNS to AWS IP 3.214.60.13.
- [ ] Repoint Vapi/carrier SIP routing to AWS IP 3.214.60.13.
- [ ] SSH into AWS:
    ```bash
    ssh -i ~/.ssh/hopwhistle-aws.pem ubuntu@3.214.60.13
    ```
- [ ] Restart AWS stack:
    ```bash
    cd /opt/hopwhistle
    docker compose start api worker transcriber freeswitch
    ```
- [ ] Confirm AWS health checks pass.
- [ ] Confirm calls work again.
