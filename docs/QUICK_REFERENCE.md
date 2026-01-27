# Hopwhistle Quick Reference Card

## 🚀 ONE-LINER: Full API Rebuild (Copy-Paste This)

```bash
cd /opt/hopwhistle && git pull origin main && cd infra/docker && docker stop docker-api-1 2>/dev/null; docker rm docker-api-1 2>/dev/null; docker rm -f docker-redis-1 2>/dev/null; docker compose -f docker-compose.yml build api --no-cache && docker compose -f docker-compose.yml up -d api --no-deps && docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null; docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null; docker restart docker-api-1 && sleep 5 && docker exec docker-api-1 npx prisma db push --accept-data-loss && curl -s http://localhost:3001/health
```

## 📦 Container Names (MEMORIZE THESE)

| Service        | Container Name            |
| -------------- | ------------------------- |
| **API**        | `docker-api-1`            |
| **Web**        | `hopwhistle-web-1`        |
| **PostgreSQL** | `hopwhistle-postgres-dev` |
| **Redis**      | `hopwhistle-redis-1`      |

## 🗄️ Database (CRITICAL)

| Setting      | Value                          |
| ------------ | ------------------------------ |
| **Database** | `callfabric` (NOT hopwhistle!) |
| **User**     | `callfabric`                   |
| **Password** | `callfabric_dev`               |
| **Host**     | `hopwhistle-postgres-dev`      |

## 🔧 Essential Commands

| Task                 | Command                                  |
| -------------------- | ---------------------------------------- |
| **SSH to server**    | `ssh root@45.32.213.201`                 |
| **Pull latest code** | `cd /opt/hopwhistle && git pull`         |
| **API logs**         | `docker logs docker-api-1 --tail 50`     |
| **Web logs**         | `docker logs hopwhistle-web-1 --tail 50` |
| **Restart API**      | `docker restart docker-api-1`            |
| **Test health**      | `curl -s http://localhost:3001/health`   |

## 🗄️ Schema Changes (Prisma)

```bash
# Apply schema to DB (run on server)
docker exec -it docker-api-1 npx prisma db push --accept-data-loss
```

## 🔥 Fix Network Issues (ALWAYS DO THIS AFTER REBUILD)

```bash
docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null
docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null
docker restart docker-api-1
```

## 🔥 Fix Port Conflicts

```bash
# API port conflict (3001)
docker stop docker-api-1; docker rm docker-api-1

# Redis port conflict (6379)
docker rm -f docker-redis-1
```

## 📍 URLs

| Service     | URL                                 |
| ----------- | ----------------------------------- |
| Web App     | http://45.32.213.201:3000           |
| API         | http://45.32.213.201:3001           |
| API Health  | http://45.32.213.201:3001/health    |
| Buyers Page | http://45.32.213.201:3000/buyers    |
| Campaigns   | http://45.32.213.201:3000/campaigns |

## 📁 Key Paths

| What                | Path                              |
| ------------------- | --------------------------------- |
| API Code            | `apps/api/src/`                   |
| Web Code            | `apps/web/src/`                   |
| Prisma Schema       | `apps/api/prisma/schema.prisma`   |
| Docker Compose      | `infra/docker/docker-compose.yml` |
| Route Registration  | `apps/api/src/index.ts`           |
| Deployment Workflow | `.agent/workflows/deploy.md`      |
| AI Context Prompt   | `docs/AI_CONTEXT_PROMPT.md`       |

## 🆕 Adding New API Routes

Add to `apps/api/src/index.ts`:

```typescript
const { registerYourRoutes } = await import('./routes/your-file.js');
await server.register(registerYourRoutes);
```

## ⚠️ Common Gotchas

1. **Database is `callfabric`** - NOT `hopwhistle`
2. **After rebuild, networks disconnect** - Always run network connect commands
3. **`docker-redis-1` conflicts** - Remove it, use `hopwhistle-redis-1` instead
4. **EACCES on prisma generate** - IGNORE IT, schema still applies
5. **Can't run Prisma locally** - Must SSH and run inside container
