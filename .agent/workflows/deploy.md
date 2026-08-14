---
description: How to deploy changes to the Hopwhistle platform on AWS
---

# Hopwhistle Deployment Workflow

// turbo-all

## ⚠️ CRITICAL: ALWAYS USE --no-cache FOR BUILDS ⚠️

Docker layer caching will cause builds to **skip code changes**! Always use:

```bash
docker compose -f docker-compose.yml build api --no-cache
docker compose -f docker-compose.yml build web --no-cache
```

**NEVER use `--build` alone** - it uses cache and won't pick up your changes!

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  LOCAL MACHINE (Windows)                                        │
│  - Code editing via VS Code                                     │
│  - Git repository at: c:\Users\jimbo\OneDrive\Documents\hopbot  │
│  - CANNOT reach PostgreSQL (port 5432 not exposed)              │
│  - CANNOT run Prisma commands against production                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ git push / SSH
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  AWS EC2 SERVER: 3.214.60.13                                    │
│  - Instance: i-0e219f63adc775d5a (t3.large, us-east-1)         │
│  - SSH: ubuntu@3.214.60.13 -i ~/.ssh/hopwhistle-aws.pem        │
│  - Project path: /opt/hopwhistle                                │
│  - Docker Compose files: /opt/hopwhistle/infra/docker/          │
├─────────────────────────────────────────────────────────────────┤
│  DOCKER CONTAINERS (ACTUAL NAMES - USE THESE!):                 │
│  ┌─────────────────────┐ ┌─────────────────────┐                │
│  │ docker-api-1        │ │ docker-web-1        │                │
│  │ Port: 3001          │ │ Port: 3000          │                │
│  └─────────────────────┘ └─────────────────────┘                │
│  ┌─────────────────────┐ ┌─────────────────────┐                │
│  │hopwhistle-postgres- │ │ docker-redis-1      │                │
│  │dev (Port 5432)      │ │ Port: 6379          │                │
│  └─────────────────────┘ └─────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## CRITICAL: Database Configuration

| Setting                  | Value                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Database Name**        | `callfabric` (NOT hopwhistle!)                                                   |
| **Username**             | `callfabric`                                                                     |
| **Password**             | `callfabric_dev`                                                                 |
| **Host (inside Docker)** | `hopwhistle-postgres-dev`                                                        |
| **Full DATABASE_URL**    | `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric` |

## CRITICAL: Container Names

| Service    | Container Name            | Network          |
| ---------- | ------------------------- | ---------------- |
| API        | `docker-api-1`            | `docker_default` |
| Web        | `docker-web-1`            | `docker_default` |
| PostgreSQL | `hopwhistle-postgres-dev` | `docker_default` |
| Redis      | `docker-redis-1`          | `docker_default` |

## CRITICAL: SSH Key

SSH uses a PEM key (not password auth):

```bash
ssh -i C:\Users\jimbo\.ssh\hopwhistle-aws.pem ubuntu@3.214.60.13
```

Note: User is `ubuntu` (not `root`). Use `sudo` for privileged operations.

## Standard Deployment Process

### 1. Push Code from Local Machine

```bash
git add -A
git commit -m "Your commit message" --no-verify
git push origin main
```

### 2. SSH into Server and Pull

```bash
ssh -i C:\Users\jimbo\.ssh\hopwhistle-aws.pem ubuntu@3.214.60.13
cd /opt/hopwhistle
sudo git pull origin main
```

### 3. If Schema Changes (Prisma) - MUST RUN INSIDE CONTAINER

```bash
# Apply schema changes to database
sudo docker exec -it docker-api-1 npx prisma db push

# Without --accept-data-loss, db push REFUSES any change that would destroy data
# and stops. A refusal is the safety mechanism doing its job: it means the diff
# it computed would drop a column, a table or an index. STOP AND THINK. Work out
# what it wants to drop and why. Do NOT add the flag back to make it proceed --
# that converts the refusal into silent deletion against a database holding call
# records and lead data.
#
# Ignore EACCES errors from prisma generate; those are unrelated to the schema.
```

### 4. Rebuild API Container

```bash
cd /opt/hopwhistle/infra/docker

# Stop and remove old container first (PREVENTS PORT CONFLICTS)
sudo docker stop docker-api-1 2>/dev/null; sudo docker rm docker-api-1 2>/dev/null

# Build fresh
sudo docker compose -f docker-compose.yml build api --no-cache

# Remove any auto-created redis that causes conflicts
sudo docker rm -f docker-redis-1 2>/dev/null

# Start Redis and API containers
sudo docker compose -f docker-compose.yml up -d redis api
```

### 5. Fix Network Connections (REQUIRED AFTER REBUILD)

```bash
# Connect postgres to API's network
sudo docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null

# Connect redis with alias
sudo docker network connect --alias redis docker_default docker-redis-1 2>/dev/null

# Restart API to pick up connections
sudo docker restart docker-api-1
```

### 6. Apply Schema Migration (if needed)

```bash
sudo docker exec -it docker-api-1 npx prisma db push
```

If this refuses, it is telling you the change would destroy data. See step 3 —
stop and work out what it wants to drop. Do not add `--accept-data-loss`.

### 7. Verify Everything Works

```bash
# Test health
curl -s http://localhost:3001/health

# Test an endpoint
curl -s http://localhost:3001/api/v1/buyers -H "x-demo-tenant-id: 00000000-0000-0000-0000-000000000000"
```

## ONE-LINER: Full API Rebuild (Copy-Paste This)

```bash
cd /opt/hopwhistle && sudo git pull origin main && cd infra/docker && sudo docker stop docker-api-1 2>/dev/null; sudo docker rm docker-api-1 2>/dev/null; sudo docker rm -f docker-redis-1 2>/dev/null; sudo docker compose -f docker-compose.yml build api --no-cache && sudo docker compose -f docker-compose.yml up -d redis api && sudo docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null; sudo docker network connect --alias redis docker_default docker-redis-1 2>/dev/null; sudo docker restart docker-api-1 && sleep 5 && sudo docker exec docker-api-1 npx prisma db push && curl -s http://localhost:3001/health
```

If the one-liner stops at `db push`, that is the destructive-change refusal, not a
broken deploy. Read what it says before doing anything else.

## ONE-LINER: Full Web Rebuild (Copy-Paste This)

```bash
cd /opt/hopwhistle && sudo git pull origin main && cd infra/docker && sudo docker stop docker-web-1 2>/dev/null; sudo docker rm docker-web-1 2>/dev/null; sudo docker compose -f docker-compose.yml build web --no-cache && sudo docker compose -f docker-compose.yml up -d web --no-deps
```

## Troubleshooting

### "Port already allocated" Error

```bash
# Find and kill the container using the port
sudo docker stop $(sudo docker ps -q --filter "publish=3001") 2>/dev/null
sudo docker rm $(sudo docker ps -aq --filter "name=api") 2>/dev/null

# For redis port conflicts
sudo docker rm -f docker-redis-1 2>/dev/null
```

### "ENOTFOUND redis" Error

```bash
sudo docker network connect --alias redis docker_default docker-redis-1
sudo docker restart docker-api-1
```

### "ENOTFOUND postgres" or "hopwhistle-postgres-dev" Error

```bash
sudo docker network connect docker_default hopwhistle-postgres-dev
sudo docker restart docker-api-1
```

### "Column does not exist" Error

The schema migration wasn't applied. Run:

```bash
sudo docker exec -it docker-api-1 npx prisma db push
```

If it refuses, the change it wants to make would destroy data. That is not a
reason to add `--accept-data-loss` — it is a reason to find out what it would
drop before going any further.

### "EACCES permission denied" on Prisma Generate

IGNORE THIS - it happens but the schema IS applied. The important thing is
that `prisma db push` succeeds with "Your database is now in sync".

### Container Won't Start - Check Logs

```bash
sudo docker logs docker-api-1 --tail 50
```

## Web Frontend Rebuild

```bash
cd /opt/hopwhistle/infra/docker
sudo docker stop docker-web-1 2>/dev/null; sudo docker rm docker-web-1 2>/dev/null
sudo docker compose -f docker-compose.yml build web --no-cache
sudo docker compose -f docker-compose.yml up -d web --no-deps
```

## Quick Command Reference

| Task            | Command                                                |
| --------------- | ------------------------------------------------------ |
| SSH to server   | `ssh -i ~/.ssh/hopwhistle-aws.pem ubuntu@3.214.60.13`  |
| Pull code       | `cd /opt/hopwhistle && sudo git pull`                  |
| List containers | `sudo docker ps`                                       |
| API logs        | `sudo docker logs docker-api-1 --tail 50`              |
| Web logs        | `sudo docker logs docker-web-1 --tail 50`              |
| Restart API     | `sudo docker restart docker-api-1`                     |
| Apply schema    | `sudo docker exec -it docker-api-1 npx prisma db push` |
| Test API        | `curl -s http://localhost:3001/health`                 |

## AWS Infrastructure Reference

| Resource         | ID / Value                   |
| ---------------- | ---------------------------- |
| Instance ID      | `i-0e219f63adc775d5a`        |
| Instance Type    | `t3.large` (2 vCPU, 8GB RAM) |
| Elastic IP       | `3.214.60.13`                |
| Security Group   | `sg-02a13c623a1319cec`       |
| Key Pair         | `hopwhistle-prod-key`        |
| S3 Bucket        | `hopwhistle-recordings-prod` |
| Region           | `us-east-1`                  |
| EBS Volume       | 200 GB gp3                   |
| SSH Key Location | `~/.ssh/hopwhistle-aws.pem`  |
