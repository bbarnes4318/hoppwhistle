# Hopwhistle Quick Reference Card

## 🚀 One-Line Deploy (After Push)

```bash
ssh root@45.32.213.201 "cd /opt/hopwhistle && git pull && cd infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate api web"
```

## 🔧 Essential Commands

| Task                   | Command                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **SSH to server**      | `ssh root@45.32.213.201`                                                                                              |
| **Pull latest code**   | `cd /opt/hopwhistle && git pull`                                                                                      |
| **Rebuild everything** | `cd /opt/hopwhistle/infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate api web` |
| **API logs**           | `docker logs hopwhistle-api --tail 50`                                                                                |
| **Web logs**           | `docker logs hopwhistle-web --tail 50`                                                                                |

## 🗄️ Database Changes (Prisma)

```bash
# 1. Apply schema to DB
docker exec -it hopwhistle-api npx prisma db push

# 2. Regenerate client (AS ROOT!)
docker exec -u 0 hopwhistle-api npx prisma generate

# 3. Restart API
docker restart hopwhistle-api
```

## 🔥 Fix Common Errors

### Port Already Allocated

```bash
docker stop $(docker ps -q --filter "publish=3001") 2>/dev/null
docker rm $(docker ps -aq --filter "name=api") 2>/dev/null
```

### Redis Not Found

```bash
docker network connect --alias redis docker_default hopwhistle-redis-1
docker restart hopwhistle-api
```

### Permission Denied (Prisma)

```bash
docker exec -u 0 hopwhistle-api npx prisma generate
```

## 📍 URLs

| Service     | URL                                 |
| ----------- | ----------------------------------- |
| Web App     | http://45.32.213.201:3000           |
| API         | http://45.32.213.201:3001           |
| Buyers Page | http://45.32.213.201:3000/buyers    |
| Campaigns   | http://45.32.213.201:3000/campaigns |

## 📁 Key Paths

| What                | Path                                   |
| ------------------- | -------------------------------------- |
| API Code            | `apps/api/src/`                        |
| Web Code            | `apps/web/src/`                        |
| Prisma Schema       | `apps/api/prisma/schema.prisma`        |
| Docker Compose      | `infra/docker/docker-compose.prod.yml` |
| Deployment Workflow | `.agent/workflows/deploy.md`           |
| AI Context Prompt   | `docs/AI_CONTEXT_PROMPT.md`            |
