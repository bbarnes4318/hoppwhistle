# Hopwhistle Project Context Prompt

**Copy this entire prompt and paste it at the START of any new AI conversation about this project.**

---

## PROJECT: Hopwhistle - Call Tracking & Lead Distribution Platform

### Architecture

- **Monorepo** at `c:\Users\jimbo\OneDrive\Documents\hopbot` (local) / `/opt/hopwhistle` (server)
- **Production Server**: Vultr at `45.32.213.201` (SSH: `root@45.32.213.201`)
- **Tech Stack**: Next.js 14 (web), Fastify (api), Prisma (ORM), PostgreSQL, Redis, FreeSWITCH (telephony)
- **Docker**: All services run in containers via `docker-compose.yml` in `/opt/hopwhistle/infra/docker/`

### CRITICAL: Container Names (USE THESE EXACT NAMES)

| Service        | Container Name            |
| -------------- | ------------------------- |
| **API**        | `docker-api-1`            |
| **Web**        | `hopwhistle-web-1`        |
| **PostgreSQL** | `hopwhistle-postgres-dev` |
| **Redis**      | `hopwhistle-redis-1`      |

### CRITICAL: Database Configuration

| Setting                  | Value                                                                            |
| ------------------------ | -------------------------------------------------------------------------------- |
| **Database Name**        | `callfabric` (NOT hopwhistle!)                                                   |
| **Username**             | `callfabric`                                                                     |
| **Password**             | `callfabric_dev`                                                                 |
| **Host (inside Docker)** | `hopwhistle-postgres-dev`                                                        |
| **DATABASE_URL**         | `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric` |

### Key Paths

| Component      | Local Path                        | Server Path                 |
| -------------- | --------------------------------- | --------------------------- |
| API            | `apps/api/`                       | `/opt/hopwhistle/apps/api/` |
| Web            | `apps/web/`                       | `/opt/hopwhistle/apps/web/` |
| Prisma Schema  | `apps/api/prisma/schema.prisma`   | Same                        |
| Docker Compose | `infra/docker/docker-compose.yml` | Same                        |
| Workflows      | `.agent/workflows/`               | N/A                         |

### Database Access

**CRITICAL**: PostgreSQL runs in Docker and port 5432 is NOT publicly exposed.

- From inside containers: `hopwhistle-postgres-dev:5432`
- Database name: `callfabric`
- Credentials: `callfabric:callfabric_dev`
- **You CANNOT run Prisma commands from local machine against production DB**
- **All Prisma commands must run inside the container via SSH**

### Docker Network Issues (COMMON PROBLEM)

After rebuilding containers, networks get disconnected. **ALWAYS run these after rebuild:**

```bash
docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null
docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null
docker restart docker-api-1
```

### Full API Rebuild Command Sequence

```bash
# On server via SSH
cd /opt/hopwhistle && git pull origin main
cd infra/docker
docker stop docker-api-1 2>/dev/null; docker rm docker-api-1 2>/dev/null
docker rm -f docker-redis-1 2>/dev/null
docker compose -f docker-compose.yml build api --no-cache
docker compose -f docker-compose.yml up -d api --no-deps
docker network connect docker_default hopwhistle-postgres-dev 2>/dev/null
docker network connect --alias redis docker_default hopwhistle-redis-1 2>/dev/null
docker restart docker-api-1
docker exec -it docker-api-1 npx prisma db push --accept-data-loss
```

### Common Issues & Fixes

1. **"Port already allocated"**: Stop conflicting container first:

   ```bash
   docker stop docker-api-1; docker rm docker-api-1
   docker rm -f docker-redis-1
   ```

2. **"ENOTFOUND redis"**: Redis needs network alias:

   ```bash
   docker network connect --alias redis docker_default hopwhistle-redis-1
   docker restart docker-api-1
   ```

3. **"ENOTFOUND hopwhistle-postgres-dev"**: Postgres needs network connection:

   ```bash
   docker network connect docker_default hopwhistle-postgres-dev
   docker restart docker-api-1
   ```

4. **"Column does not exist"**: Schema migration not applied:

   ```bash
   docker exec -it docker-api-1 npx prisma db push --accept-data-loss
   ```

5. **"EACCES permission denied" on Prisma**: IGNORE IT - the schema is still applied

### Route Registration Pattern

Routes in `apps/api/src/index.ts` use two patterns:

- Static imports at top (e.g., `registerCampaignRoutes` from `./routes/index.js`)
- Dynamic imports inline (e.g., `await import('./routes/buyer-billing.js')`)

**When adding new route files**, add this to `index.ts`:

```typescript
const { registerYourRoutes } = await import('./routes/your-file.js');
await server.register(registerYourRoutes);
```

### Production-Grade Architecture Standards

This project follows three mandatory rules:

1. **Separation of State & Config**: Volatile data (live call counts, concurrency) is NEVER stored in configuration tables. Use separate services like `buyer-live-status-service.ts`.

2. **Aggregate on Write**: Analytics (revenue, call counts) are pre-calculated in summary tables (like `BuyerStats`), updated incrementally on each call. Never compute in real-time.

3. **Async UI**: Dashboard loads instantly with skeleton loaders. Secondary data (stats, live status) fetches in parallel after initial render.

### UI Design Philosophy

- **Ringba-inspired high-density layout**: 12px table data, compact rows, maximum information density
- **Brand Colors**: Electric Indigo (`#4F46E5`), Vibrant Teal (`#10B981`), Dark Navy sidebar (`#111827`)
- **Components**: shadcn/ui, Radix primitives, Lucide icons

### Existing Workflows

Type `/deploy` to get the full deployment workflow with step-by-step commands.

---

**End of context prompt. Now state your task clearly.**
