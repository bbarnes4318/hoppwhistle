# Prisma Database Setup - Summary

## ✅ Completed Tasks

### 1. Prisma Dependencies Added

- `@prisma/client` (v5.7.1) - Prisma Client
- `prisma` (v5.7.1) - Prisma CLI
- `prisma-erd-generator` (v1.10.0) - ERD diagram generator
- `bcryptjs` - Password hashing for seed script

### 2. Comprehensive Schema Created

**Location**: `apps/api/prisma/schema.prisma`

**Schema includes**:

- ✅ Multi-tenant core (tenants, users, roles, api_keys)
- ✅ Telephony infrastructure (phone_numbers, carriers, trunks, caller_id_pools)
- ✅ Campaigns (campaigns, publishers, buyers, buyer_endpoints)
- ✅ Flow routing (flows, flow_versions, nodes, edges)
- ✅ Call tracking (calls, call_legs, cdrs, recordings, transcriptions, tags)
- ✅ Billing (billing_accounts, rate_cards, invoices, invoice_lines, balances, payouts)
- ✅ System integration (webhooks, events, audit_logs, feature_flags)
- ✅ Compliance (dnc_lists, consent_tokens, stir_shaken_status)

**Key Features**:

- Multi-tenant scoping (`tenant_id` on all business tables)
- Proper indexes and unique constraints
- `created_at`/`updated_at` timestamps
- Enum types for status fields
- JSON fields for flexible metadata
- Cascade deletes for data integrity

### 3. Database Scripts Added

**Root level** (`package.json`):

- `pnpm db:migrate` - Run migrations
- `pnpm db:seed` - Seed database

**API app** (`apps/api/package.json`):

- `db:migrate` - Create and apply migration
- `db:migrate:deploy` - Deploy migrations (production)
- `db:migrate:reset` - Reset database
- `db:seed` - Seed database
- `db:studio` - Open Prisma Studio
- `db:generate` - Generate Prisma Client + ERD
- `db:push` - Push schema (dev only)

### 4. Seed Script Created

**Location**: `apps/api/prisma/seed.ts`

**Creates**:

- ✅ Test tenant (`test-org`)
- ✅ Admin user (`admin@test.callfabric.local` / `password123`)
- ✅ Roles (admin, publisher, buyer)
- ✅ API key
- ✅ Carrier, trunk, phone numbers
- ✅ Caller ID pool
- ✅ Publisher and buyer with endpoints
- ✅ Flow with 3 nodes: IVR → Queue → Buyer Failover
- ✅ Campaign linked to flow
- ✅ Billing account with rate card and balance
- ✅ DNC list with entries
- ✅ Webhook configuration
- ✅ Feature flags

### 5. Documentation Created

- ✅ `docs/SCHEMA.md` - Schema documentation
- ✅ `docs/DATABASE_SETUP.md` - Setup guide
- ✅ `README.md` - Updated with database section
- ✅ ERD generator configured (generates `docs/erd.png`)

### 6. Configuration Files

- ✅ Prisma seed configuration in `package.json`
- ✅ Updated `.env.example` with correct DATABASE_URL format
- ✅ `.gitignore` for Prisma migrations directory

## 🚀 Next Steps

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start PostgreSQL

```bash
docker-compose -f infra/docker/docker-compose.yml up -d postgres
```

### 3. Set Up Environment

```bash
cp apps/api/env.example apps/api/.env
# Edit apps/api/.env if needed
```

### 4. Generate Prisma Client & ERD

```bash
pnpm --filter @callfabric/api db:generate
```

This generates:

- Prisma Client in `node_modules/.prisma/client`
- ERD diagram at `docs/erd.png`

### 5. Run Initial Migration

```bash
pnpm db:migrate
```

When prompted, enter migration name: `init`

### 6. Seed Database

```bash
pnpm db:seed
```

## ✅ Success Criteria Met

- ✅ `pnpm -w run db:migrate` - Script exists and ready
- ✅ `pnpm -w run db:seed` - Script exists and ready
- ✅ ERD diagram generator configured (generates on `db:generate`)
- ✅ Comprehensive schema with all requested entities
- ✅ Multi-tenant scoping implemented
- ✅ Proper indexes and constraints
- ✅ Seed script creates test data as specified

## 📊 Schema Statistics

- **Total Models**: 40+
- **Enums**: 20+
- **Relationships**: 50+
- **Indexes**: 80+
- **Multi-tenant tables**: All business tables

## 🔍 Verification

After setup, verify:

1. **Database connection**:

   ```bash
   pnpm --filter @callfabric/api db:studio
   ```

2. **Check tables**:

   ```sql
   \dt  -- List all tables
   ```

3. **Verify seed data**:

   ```bash
   # Check tenant exists
   SELECT * FROM tenants WHERE slug = 'test-org';

   # Check user exists
   SELECT * FROM users WHERE email = 'admin@test.callfabric.local';

   # Check flow has 3 nodes
   SELECT COUNT(*) FROM nodes WHERE "flowVersionId" IN (
     SELECT id FROM flow_versions WHERE "flowId" IN (
       SELECT id FROM flows WHERE name = 'Sample Campaign Flow'
     )
   );
   ```

## 📝 Notes

- The ERD diagram will be generated automatically when running `pnpm db:generate`
- Migrations are stored in `apps/api/prisma/migrations/`
- Prisma Client is generated in `node_modules/.prisma/client`
- Seed script uses bcryptjs for password hashing
- All timestamps use `DateTime` type with `@default(now())` and `@updatedAt`
