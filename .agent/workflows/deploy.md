---
description: How to deploy changes to the Hopwhistle platform on Vultr
---

# Hopwhistle Deployment Workflow

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  LOCAL MACHINE (Windows)                                        │
│  - Code editing via VS Code                                     │
│  - Git repository at: c:\Users\jimbo\OneDrive\Documents\hopbot  │
│  - Cannot directly reach PostgreSQL (port 5432 not exposed)     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ git push / SSH
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  VULTR SERVER: 45.32.213.201                                    │
│  - SSH: root@45.32.213.201                                      │
│  - Project path: /opt/hopwhistle                                │
│  - Docker Compose files: /opt/hopwhistle/infra/docker/          │
├─────────────────────────────────────────────────────────────────┤
│  DOCKER CONTAINERS:                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │ hopwhistle-api  │ │hopwhistle-web   │ │hopwhistle-redis │   │
│  │ Port: 3001      │ │Port: 3000       │ │Port: 6379       │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│  ┌─────────────────┐ ┌─────────────────┐                        │
│  │hopwhistle-postgres│ │hopwhistle-fs  │                        │
│  │Port: 5432 (internal)│ │FreeSWITCH   │                        │
│  └─────────────────┘ └─────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

## Key Information

| Component             | Location/Value                                     |
| --------------------- | -------------------------------------------------- |
| Server IP             | 45.32.213.201                                      |
| SSH Access            | `ssh root@45.32.213.201`                           |
| Project Path (Server) | `/opt/hopwhistle`                                  |
| Docker Compose Dir    | `/opt/hopwhistle/infra/docker/`                    |
| Main Compose File     | `docker-compose.prod.yml`                          |
| Full Stack Compose    | `docker-compose.yml`                               |
| Web App URL           | http://45.32.213.201:3000                          |
| API URL               | http://45.32.213.201:3001                          |
| Database              | PostgreSQL in Docker (NOT publicly exposed)        |
| DB Credentials        | `hopwhistle:ChangeMe123!@postgres:5432/hopwhistle` |

## Standard Deployment Process

### 1. After Making Code Changes Locally

```bash
# Commit and push your changes
git add -A
git commit -m "Your commit message"
git push origin main
```

### 2. SSH into the Server

```bash
ssh root@45.32.213.201
cd /opt/hopwhistle
```

### 3. Pull Latest Code

```bash
git pull origin main
```

### 4. If Schema Changes (Prisma)

// turbo

```bash
# Apply schema changes to database
docker exec -it hopwhistle-api npx prisma db push

# Regenerate Prisma client (run as root inside container)
docker exec -u 0 hopwhistle-api npx prisma generate
```

### 5. Rebuild and Restart Containers

// turbo

```bash
cd /opt/hopwhistle/infra/docker

# Rebuild API only
docker compose -f docker-compose.prod.yml up -d --build --force-recreate api

# Rebuild Web only
docker compose -f docker-compose.prod.yml up -d --build --force-recreate web

# Rebuild both
docker compose -f docker-compose.prod.yml up -d --build --force-recreate api web
```

### 6. Fix Network Issues (if Redis/Postgres errors)

// turbo

```bash
# Connect Redis with proper alias
docker network connect --alias redis docker_default hopwhistle-redis-1

# Connect Postgres with proper alias
docker network connect --alias postgres docker_default hopwhistle-postgres-1

# Restart API
docker restart hopwhistle-api
```

### 7. Check Logs

// turbo

```bash
# API logs
docker logs hopwhistle-api --tail 50

# Web logs
docker logs hopwhistle-web --tail 50

# Follow logs in real-time
docker logs -f hopwhistle-api
```

## Quick Command Reference

| Task              | Command                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| SSH to server     | `ssh root@45.32.213.201`                                                                                          |
| Pull code         | `cd /opt/hopwhistle && git pull`                                                                                  |
| Apply DB changes  | `docker exec -it hopwhistle-api npx prisma db push`                                                               |
| Regen Prisma      | `docker exec -u 0 hopwhistle-api npx prisma generate`                                                             |
| Rebuild API       | `cd /opt/hopwhistle/infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate api` |
| Rebuild Web       | `cd /opt/hopwhistle/infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate web` |
| View API logs     | `docker logs hopwhistle-api --tail 50`                                                                            |
| Restart API       | `docker restart hopwhistle-api`                                                                                   |
| List containers   | `docker ps`                                                                                                       |
| Fix Redis network | `docker network connect --alias redis docker_default hopwhistle-redis-1`                                          |

## Troubleshooting

### "Port already allocated" Error

```bash
docker stop $(docker ps -q --filter "publish=3001") 2>/dev/null
docker rm $(docker ps -aq --filter "name=api") 2>/dev/null
# Then retry the rebuild
```

### "ENOTFOUND redis" Error

```bash
docker network connect --alias redis docker_default hopwhistle-redis-1
docker restart hopwhistle-api
```

### "ENOTFOUND postgres" Error

```bash
docker network connect --alias postgres docker_default hopwhistle-postgres-1
docker restart hopwhistle-api
```

### Prisma Permission Denied

```bash
# Run as root inside container
docker exec -u 0 hopwhistle-api npx prisma generate
```

### Container Won't Start

```bash
# Check logs for the error
docker logs hopwhistle-api

# Remove and recreate
docker rm -f hopwhistle-api
cd /opt/hopwhistle/infra/docker
docker compose -f docker-compose.prod.yml up -d api
```
