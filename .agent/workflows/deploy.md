---
description: How to deploy changes to the Hopwhistle platform on Vultr
---

# Hopwhistle Deployment Workflow

// turbo-all

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
│  VULTR SERVER: 45.32.213.201                                    │
│  - SSH: root@45.32.213.201                                      │
│  - Project path: /opt/hopwhistle                                │
│  - Docker Compose files: /opt/hopwhistle/infra/docker/          │
├─────────────────────────────────────────────────────────────────┤
│  DOCKER CONTAINERS (ACTUAL NAMES - USE THESE!):                 │
│  ┌─────────────────────┐ ┌─────────────────────┐                │
│  │ docker-api-1        │ │ hopwhistle-web-1    │                │
│  │ Port: 3001          │ │ Port: 3000          │                │
│  └─────────────────────┘ └─────────────────────┘                │
│  ┌─────────────────────┐ ┌─────────────────────┐                │
│  │hopwhistle-postgres- │ │ hopwhistle-redis-1  │                │
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

| Service    | Container Name                         | Network                |
| ---------- | -------------------------------------- | ---------------------- |
| API        | `docker-api-1`                         | `docker_default`       |
| Web        | `hopwhistle-web-1` or `hopwhistle-web` | varies                 |
| PostgreSQL | `hopwhistle-postgres-dev`              | needs `docker_default` |
| Redis      | `hopwhistle-redis-1`                   | needs `docker_default` |

## Standard Deployment Process

### 1. Push Code from Local Machine

```bash
git add -A
git commit -m "Your commit message" --no-verify
git push origin main
```

### 2. SSH into Server and Pull

```bash
ssh root@45.32.213.201
cd /opt/hopwhistle
git pull origin main
```

### 3. If Schema Changes (Prisma) - MUST RUN INSIDE CONTAINER

```bash
# Apply schema changes to database
docker exec -it docker-api-1 npx prisma db push --accept-data-loss

# The above command IS SUFFICIENT - ignore EACCES errors for prisma generate
# The schema is applied to the database, that's what matters
```

### 4. Rebuild API Container

```bash
cd /opt/hopwhistle/infra/docker

# Stop and remove old container first (PREVENTS PORT CONFLICTS)
docker stop docker-api-1 2>/dev/null; docker rm docker-api-1 2>/dev/null

# Build fresh
docker compose -f docker-compose.yml build api --no-cache

# Remove any auto-created redis that causes conflicts
docker rm -f docker-redis-1 2>/dev/null

# Start API only (not redis - it already exists)
docker compose -f docker-compose.yml up -d api --no-deps
```

### 5. Fix Network Connections (REQUIRED AFTER REBUILD)

```bash
# Connect postgres to API's network
docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null

# Connect redis with alias
docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null

# Restart API to pick up connections
docker restart docker-api-1
```

### 6. Apply Schema Migration (if needed)

```bash
docker exec -it docker-api-1 npx prisma db push --accept-data-loss
```

### 7. Verify Everything Works

```bash
# Test health
curl -s http://localhost:3001/health

# Test an endpoint
curl -s http://localhost:3001/api/v1/buyers -H "x-demo-tenant-id: 00000000-0000-0000-0000-000000000000"
```

## ONE-LINER: Full Rebuild (Copy-Paste This)

```bash
cd /opt/hopwhistle && git pull origin main && cd infra/docker && docker stop docker-api-1 2>/dev/null; docker rm docker-api-1 2>/dev/null; docker rm -f docker-redis-1 2>/dev/null; docker compose -f docker-compose.yml build api --no-cache && docker compose -f docker-compose.yml up -d api --no-deps && docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null; docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null; docker restart docker-api-1 && sleep 5 && docker exec docker-api-1 npx prisma db push --accept-data-loss && curl -s http://localhost:3001/health
```

## Troubleshooting

### "Port already allocated" Error

```bash
# Find and kill the container using the port
docker stop $(docker ps -q --filter "publish=3001") 2>/dev/null
docker rm $(docker ps -aq --filter "name=api") 2>/dev/null

# For redis port conflicts
docker rm -f docker-redis-1 2>/dev/null
```

### "ENOTFOUND redis" Error

```bash
docker network connect --alias redis docker_default hopwhistle-redis-1
docker restart docker-api-1
```

### "ENOTFOUND postgres" or "hopwhistle-postgres-dev" Error

```bash
docker network connect docker_default hopwhistle-postgres-dev
docker restart docker-api-1
```

### "Column does not exist" Error

The schema migration wasn't applied. Run:

```bash
docker exec -it docker-api-1 npx prisma db push --accept-data-loss
```

### "EACCES permission denied" on Prisma Generate

IGNORE THIS - it happens but the schema IS applied. The important thing is
that `prisma db push` succeeds with "Your database is now in sync".

### Container Won't Start - Check Logs

```bash
docker logs docker-api-1 --tail 50
```

## Web Frontend Rebuild

```bash
cd /opt/hopwhistle/infra/docker
docker stop hopwhistle-web-1 2>/dev/null; docker rm hopwhistle-web-1 2>/dev/null
docker compose -f docker-compose.yml build web --no-cache
docker compose -f docker-compose.yml up -d web --no-deps
```

## Quick Command Reference

| Task            | Command                                                              |
| --------------- | -------------------------------------------------------------------- |
| SSH to server   | `ssh root@45.32.213.201`                                             |
| Pull code       | `cd /opt/hopwhistle && git pull`                                     |
| List containers | `docker ps`                                                          |
| API logs        | `docker logs docker-api-1 --tail 50`                                 |
| Web logs        | `docker logs hopwhistle-web-1 --tail 50`                             |
| Restart API     | `docker restart docker-api-1`                                        |
| Apply schema    | `docker exec -it docker-api-1 npx prisma db push --accept-data-loss` |
| Test API        | `curl -s http://localhost:3001/health`                               |
