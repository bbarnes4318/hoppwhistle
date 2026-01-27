# Database Migration Instructions for Vultr Server

## The Problem

The PostgreSQL database runs in Docker on the Vultr server and is NOT exposed
publicly (for security). Therefore, database migrations must be run FROM the server,
not from your local machine.

## How to Run Migrations

### Option 1: SSH into the server and run directly

```bash
# SSH into Vultr server
ssh root@45.32.213.201

# Navigate to the project
cd /opt/hopwhistle

# Run migration using db push (applies schema changes)
docker exec -it hopwhistle-api-1 npx prisma db push

# Or run Prisma generate to update the client
docker exec -it hopwhistle-api-1 npx prisma generate
```

### Option 2: Run the SQL migration manually

```bash
# SSH into Vultr server
ssh root@45.32.213.201

# Connect to PostgreSQL
docker exec -it hopwhistle-postgres-1 psql -U hopwhistle -d hopwhistle

# Then paste the contents of:
# apps/api/prisma/migrations/20260126_add_buyer_targets_and_stats/migration.sql
```

### Option 3: Expose PostgreSQL temporarily (NOT RECOMMENDED for production)

```bash
# On Vultr server, edit docker-compose to expose port:
# ports:
#   - "5432:5432"

# Then add firewall rule:
ufw allow 5432/tcp

# After migration, REMOVE the firewall rule:
ufw delete allow 5432/tcp
```

## Current Migration to Apply

File: `apps/api/prisma/migrations/20260126_add_buyer_targets_and_stats/migration.sql`

This migration adds:

- `Buyer` fields: subId, canPauseTargets, canSetCaps, canDisputeConversions
- `BuyerEndpoint` fields: name, maxCap, capPeriod, maxConcurrency
- New `BuyerStats` table for pre-aggregated analytics

## After Migration

After running the migration, you must regenerate the Prisma client:

```bash
docker exec -it hopwhistle-api-1 npx prisma generate
```

Then rebuild and restart the API container:

```bash
cd /opt/hopwhistle
docker compose up -d --build api
```
