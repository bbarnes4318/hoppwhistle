# Hopwhistle Project Context Prompt

Copy this entire prompt and paste it at the START of any new AI conversation about this project.

---

## PROJECT: Hopwhistle - Call Tracking & Lead Distribution Platform

### Architecture

- **Monorepo** at `c:\Users\jimbo\OneDrive\Documents\hopbot` (local) / `/opt/hopwhistle` (server)
- **Production Server**: Vultr at `45.32.213.201` (SSH: `root@45.32.213.201`)
- **Tech Stack**: Next.js 14 (web), Fastify (api), Prisma (ORM), PostgreSQL, Redis, FreeSWITCH (telephony)
- **Docker**: All services run in containers via `docker-compose.prod.yml` in `/opt/hopwhistle/infra/docker/`

### Key Paths

| Component      | Local Path                             | Server Path                 |
| -------------- | -------------------------------------- | --------------------------- |
| API            | `apps/api/`                            | `/opt/hopwhistle/apps/api/` |
| Web            | `apps/web/`                            | `/opt/hopwhistle/apps/web/` |
| Prisma Schema  | `apps/api/prisma/schema.prisma`        | Same                        |
| Docker Compose | `infra/docker/docker-compose.prod.yml` | Same                        |
| Workflows      | `.agent/workflows/`                    | N/A                         |

### Database Access

**CRITICAL**: PostgreSQL runs in Docker and port 5432 is NOT publicly exposed.

- From inside containers: `postgres:5432`
- Credentials: `hopwhistle:ChangeMe123!`
- Database name: `hopwhistle`
- **You CANNOT run Prisma commands from local machine against production DB**
- **All Prisma commands must run inside the container via SSH**

### Deployment Commands (SSH into server first)

```bash
# Apply Prisma schema changes
docker exec -it hopwhistle-api npx prisma db push

# Regenerate Prisma client (must run as root)
docker exec -u 0 hopwhistle-api npx prisma generate

# Rebuild API
cd /opt/hopwhistle/infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate api

# Rebuild Web
cd /opt/hopwhistle/infra/docker && docker compose -f docker-compose.prod.yml up -d --build --force-recreate web

# Fix Redis network issues
docker network connect --alias redis docker_default hopwhistle-redis-1 && docker restart hopwhistle-api
```

### Common Issues

1. **"Port already allocated"**: Stop conflicting container first:

   ```bash
   docker stop $(docker ps -q --filter "publish=3001")
   ```

2. **"ENOTFOUND redis"**: Redis container needs network alias:

   ```bash
   docker network connect --alias redis docker_default hopwhistle-redis-1
   ```

3. **"Permission denied" on Prisma generate**: Run as root:
   ```bash
   docker exec -u 0 hopwhistle-api npx prisma generate
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
