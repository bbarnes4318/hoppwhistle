# Database Setup Guide

## Quick Start

1. **Start PostgreSQL** (via Docker Compose):

   ```bash
   docker-compose -f infra/docker/docker-compose.yml up -d postgres
   ```

2. **Set up environment variables**:

   ```bash
   cp apps/api/env.example apps/api/.env
   # Edit apps/api/.env and update DATABASE_URL if needed
   ```

3. **Generate Prisma Client**:

   ```bash
   pnpm --filter @callfabric/api db:generate
   ```

4. **Run migrations**:

   ```bash
   pnpm db:migrate
   ```

   This will:
   - Create the initial migration
   - Apply it to your database
   - Create all tables, indexes, and constraints

5. **Seed the database**:
   ```bash
   pnpm db:seed
   ```

## Schema Overview

The database schema includes:

### Core Entities

- **Tenants** - Multi-tenant isolation
- **Users & Roles** - Authentication and authorization
- **API Keys** - API authentication

### Telephony

- **Phone Numbers** - DID management
- **Carriers & Trunks** - SIP infrastructure
- **Caller ID Pools** - Caller ID management

### Campaigns

- **Publishers** - Traffic sources
- **Buyers** - Traffic destinations
- **Buyer Endpoints** - SIP/PSTN endpoints
- **Campaigns** - Campaign management

### Routing

- **Flows** - Routing flow definitions
- **Flow Versions** - Versioned flows
- **Nodes** - Flow nodes (IVR, Queue, Buyer Forward, etc.)
- **Edges** - Node connections with conditions

### Call Tracking

- **Calls** - Call records
- **Call Legs** - Multi-leg call tracking
- **CDRs** - Normalized call detail records
- **Recordings** - Call recordings
- **Transcriptions** - AI transcriptions
- **Tags** - Call organization

### Billing

- **Billing Accounts** - Account management
- **Rate Cards** - Rate definitions
- **Invoices** - Invoice generation
- **Balances** - Account balances
- **Payouts** - Payout processing

### System

- **Webhooks** - Webhook endpoints
- **Events** - Event logging
- **Audit Logs** - Audit trail
- **Feature Flags** - Feature toggles

### Compliance

- **DNC Lists** - Do Not Call lists
- **Consent Tokens** - TrustedForm/Jornaya integration
- **STIR/SHAKEN** - Call verification status

## Multi-Tenant Architecture

All business tables include `tenant_id` for:

- **Data isolation** - Each tenant's data is isolated
- **Cascade deletion** - Deleting a tenant removes all related data
- **Performance** - Indexed for fast tenant-scoped queries

## Seed Data

The seed script (`apps/api/prisma/seed.ts`) creates:

- **Tenant**: `test-org` (Test Organization)
- **User**: `admin@test.callfabric.local` / `password123`
- **Roles**: admin, publisher, buyer
- **Carrier & Trunk**: Test SIP infrastructure
- **Phone Numbers**: +15551234567, +15559876543
- **Caller ID Pool**: Default pool with 2 numbers
- **Publisher**: Test Publisher
- **Buyer**: Test Buyer with SIP and PSTN endpoints
- **Flow**: IVR → Queue → Buyer Failover (3 nodes, 2 edges)
- **Campaign**: Test Campaign linked to flow
- **Billing Account**: With rate card and $1000 balance
- **DNC List**: Global list with 2 entries
- **Webhook**: Test webhook endpoint
- **Feature Flags**: 3 flags (analytics, transcription, STIR/SHAKEN)

## Common Tasks

### View Database Schema

```bash
pnpm --filter @callfabric/api db:studio
```

Opens Prisma Studio in your browser.

### Create New Migration

```bash
# After modifying schema.prisma
pnpm --filter @callfabric/api db:migrate
# Enter migration name when prompted
```

### Reset Database

```bash
# WARNING: Deletes all data
pnpm --filter @callfabric/api db:migrate:reset
pnpm db:seed
```

### Generate ERD Diagram

```bash
pnpm --filter @callfabric/api db:generate
# ERD saved to docs/erd.png
```

## Production Deployment

1. **Generate Prisma Client**:

   ```bash
   pnpm --filter @callfabric/api db:generate
   ```

2. **Deploy migrations** (does not prompt):

   ```bash
   pnpm --filter @callfabric/api db:migrate:deploy
   ```

3. **Seed production** (if needed):
   ```bash
   # Only seed initial data, not test data
   NODE_ENV=production pnpm --filter @callfabric/api db:seed
   ```

## Troubleshooting

### Migration fails

- Check DATABASE_URL is correct
- Ensure PostgreSQL is running
- Check database user has CREATE privileges

### Seed fails

- Ensure migrations have been applied
- Check for unique constraint violations
- Review seed script logs

### Prisma Client not found

- Run `pnpm --filter @callfabric/api db:generate`
- Ensure `@prisma/client` is installed

### Connection refused

- Verify PostgreSQL is running: `docker ps`
- Check DATABASE_URL format: `postgresql://user:password@host:port/database`
- Test connection: `psql $DATABASE_URL`
