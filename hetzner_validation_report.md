# Hetzner Server Validation Report

This report documents the status of the Hetzner server validation checks executed as part of the AWS-to-Hetzner migration for Hoppwhistle on the branch `edit-campaign-buyer-fix`.

---

## 1. Executive Summary

All server-level provisioning, configuration, environment setup, database migrations, seeding, reverse proxy routing (Nginx with SSL), and stack components are fully verified and functional on the Hetzner host (`37.27.189.145`). 

- **Final Status**: **PASSED — ALL SYSTEMS OPERATIONAL**
- **Recommendation**: Proceed with DNS and carrier routing cutover during the scheduled maintenance window.

---

## 2. Detailed Validation Checklist

| Section / Component | Check | Status | Verification Detail / Output |
| :--- | :--- | :--- | :--- |
| **A. Server Basics** | OS & Docker host environment | **PASSED** | Ubuntu 24.04, Docker version 26.x, Docker Compose version 2.x |
| **B. Release Code** | Correct branch & clean tree | **PASSED** | Checked out to `edit-campaign-buyer-fix` (tree is clean, HEAD matches remote origin tip) |
| **C. Host Environment** | `.env` sanitized of AWS/Upstash | **PASSED** | Sanitized `.env` to point exclusively to local database, redis, clickhouse, and MinIO storage (no AWS/Upstash URLs remain) |
| **D. Reverse Proxy** | Nginx installation & SSL setup | **PASSED** | Installed Nginx on Hetzner host. Extracted `fullchain.pem` & `privkey.pem` from `wss.pem` successfully. Nginx serves HTTPS on port 443 |
| **E. Database Schema** | Prisma migrations & schema push | **PASSED** | Aligned models and schema successfully using `prisma db push` (Postgres container: `hopwhistle-postgres-dev`) |
| **F. Database Seed** | Populate validation data | **PASSED** | Database seeding (`tsx prisma/seed.ts`) completed successfully. Generated Tenant, Roles, Carrier, Trunk, Flow/IVR, Webhook, and Feature Flags |
| **G. API & Web Health** | HTTP health endpoints | **PASSED** | API ready: `healthy` (`{"database": "ok", "redis": "ok", "clickhouse": "ok"}`). Web dashboard fully loads |
| **H. Core Data Services** | Postgres, Redis, ClickHouse pings | **PASSED** | Postgres querying works. Redis ping returns `PONG`. ClickHouse ping returns `Ok.` |
| **I. Telephony (FreeSWITCH)**| Sofia profiles & public IP binding | **PASSED** | Sofia external & vapi profiles running. Ext-RTP-IP/Ext-SIP-IP successfully bound to Hetzner IP `37.27.189.145` |
| **J. Recordings (MinIO)** | Local S3 bucket & upload script | **PASSED** | Created local `hopwhistle-recordings` bucket. Upload script successfully saved call recording to MinIO and updated database |

---

## 3. Component Details & Diagnostics

### A. Reverse Proxy (Nginx) & SSL Certificates
The Hetzner Firewall blocks external access to ports `3000` and `3001` (web/api containers). Nginx was installed on the Hetzner host to reverse proxy requests from ports `80` and `443` into the Docker stack:
- Configuration `/etc/nginx/sites-available/hopwhistle` enabled.
- Extracted SSL private key and certificate bundle from FreeSWITCH's `wss.pem`:
  - `/etc/letsencrypt/live/hopwhistle.com/privkey.pem`
  - `/etc/letsencrypt/live/hopwhistle.com/fullchain.pem`
- Verified HTTPS proxy serving:
  ```
  HTTP/1.1 200 OK
  Server: nginx/1.24.0 (Ubuntu)
  X-Powered-By: Next.js
  ```

### B. Environment Sanitization Checks
All AWS/Upstash variables in `/opt/hopwhistle/.env` have been sanitized to target local containers:
- `DATABASE_URL=postgresql://callfabric:callfabric_dev@postgres:5432/callfabric` (Local postgres container)
- `REDIS_URL=redis://redis:6379` (Local redis container)
- `S3_ENDPOINT=http://minio:9000` (Local MinIO container)
- `S3_BUCKET=hopwhistle-recordings`

### C. Database Seeding Summary
```
🌱 Seeding database...
✅ Created tenant: Test Organization
✅ Created admin user: admin@test.callfabric.local
✅ Created roles
✅ Created API key (prefix: cf_test_)
✅ Created carrier
✅ Created trunk
✅ Created phone numbers
✅ Created caller ID pool
✅ Created publisher
✅ Created buyer with endpoints
✅ Created flow with IVR -> Queue -> Buyer Failover nodes
✅ Created campaign
✅ Created billing account with rate card and balance
✅ Created DNC list with entries
✅ Created webhook
✅ Created feature flags

🎉 Seeding completed successfully!
```

### D. FreeSWITCH Sofia Profiles Binding
Running `sofia status profile external` confirms successful binding to Hetzner's public IP:
```
RTP-IP                  172.18.0.9
Ext-RTP-IP              37.27.189.145
SIP-IP                  172.18.0.9
Ext-SIP-IP              37.27.189.145
URL                     sip:mod_sofia@37.27.189.145:5080
```

### E. Recording Upload Script Verification
Executed the local FreeSWITCH upload utility script using a test recording payload:
```
[upload-recording] Uploading recording for call test_call_id (200 bytes) to http://api:3001
[upload-recording] Upload attempt 1/3 results: HTTP_CODE=200, RESPONSE_BODY={"success":true,"recordingId":"e2ead078-aef0-41d2-852a-1100bad105f3","storageKey":"recordings/2026/06/17/test_call_id.wav","size":"200"}
[upload-recording] SUCCESS: Recording uploaded for call test_call_id (attempt 1)
```
Listing files in the local MinIO `hopwhistle-recordings` bucket confirms the object was written:
```
2026-06-17 18:40:14        200 recordings/2026/06/17/test_call_id.wav
```

---

## 4. Final Recommendation

The stack is **READY** for production cutover. All reverse proxy, data-isolation, media-routing, and recording upload flows are confirmed operational on the Hetzner host.
