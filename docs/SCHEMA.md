# Database Schema Documentation

## Overview

The CallFabric database schema is designed for multi-tenant call tracking with comprehensive support for:

- Multi-tenant isolation (all business tables include `tenant_id`)
- Telephony infrastructure (carriers, trunks, phone numbers)
- Campaign management (publishers, buyers, campaigns)
- Flow-based routing (visual flow builder with nodes and edges)
- Call tracking and CDRs
- Billing and invoicing
- Compliance (DNC lists, consent tokens, STIR/SHAKEN)
- System integration (webhooks, events, audit logs)

## Entity Relationship Diagram

To generate the ERD diagram:

```bash
cd apps/api
pnpm db:generate
```

This will generate `docs/erd.png` using the Prisma ERD generator.

## Schema Groups

### Multi-Tenant Core

- **Tenant** - Top-level organization isolation
- **User** - User accounts with email/password authentication
- **Role** - Permission-based roles
- **UserRole** - Many-to-many relationship between users and roles
- **ApiKey** - API authentication keys

### Telephony Infrastructure

- **PhoneNumber** - DID numbers (E.164 format)
- **Carrier** - Carrier providers
- **Trunk** - SIP/IAX2/WebRTC trunks
- **CallerIdPool** - Pool of caller ID numbers
- **CallerIdPoolPhoneNumber** - Many-to-many relationship

### Campaigns & Publishers/Buyers

- **Campaign** - Marketing campaigns
- **Publisher** - Traffic publishers
- **Buyer** - Traffic buyers
- **BuyerEndpoint** - SIP URIs or PSTN numbers for buyers

### Flow Routing

- **Flow** - Routing flow definition
- **FlowVersion** - Versioned flow configurations
- **Node** - Flow nodes (IVR, Queue, Buyer Forward, etc.)
- **Edge** - Connections between nodes with conditions

### Call Tracking

- **Call** - Call records with enterprise tracking fields:
  - **Timestamps**: callCompleteTimestamp, callConnectedTimestamp, previouslyConnectedDate
  - **Identity IDs**: publisherId, buyerId, targetId, targetGroupId (FK relations)
  - **Identity Names**: campaignName, publisherName, buyerName, targetName, targetGroupName (denormalized)
  - **Telephony**: callerId, callerIdAreaCode, callerIdState, did, targetNumber, connectedDuration, durationFormatted, connectedDurationFormatted, recordingUrl
  - **Financials**: revenue, payout, profit, cost (Decimal 10,4)
  - **Status Flags**: isDuplicate, converted, missedCall, blocked, paidOut, previouslyConnected
  - **Reason Codes**: noPayoutReason, noConversionReason, blockReason, previouslyConnectedTarget
- **CallLeg** - Individual call legs (for multi-leg calls)
- **Cdr** - Normalized Call Detail Records
- **Recording** - Call recordings
- **Transcription** - AI transcriptions with metadata
- **Tag** - Call tags for organization
- **CallTag** - Many-to-many relationship

### Billing

- **BillingAccount** - Billing accounts per tenant
- **RateCard** - Rate card definitions
- **Invoice** - Invoices
- **InvoiceLine** - Invoice line items
- **Balance** - Account balances (available, pending, held)
- **Payout** - Payout records

### System & Integration

- **Webhook** - Webhook endpoints
- **Event** - Event log
- **AuditLog** - Audit trail
- **FeatureFlag** - Feature flags per tenant

### Compliance & Security

- **DncList** - Do Not Call lists
- **DncListEntry** - DNC list entries
- **ConsentToken** - TrustedForm/Jornaya consent tokens
- **StirShakenStatus** - STIR/SHAKEN verification status

## Multi-Tenant Isolation

All business tables include `tenant_id` with:

- Foreign key constraint to `Tenant.id`
- Cascade delete on tenant deletion
- Indexed for performance

## Indexes

Key indexes are created on:

- `tenant_id` on all tenant-scoped tables
- `tenant_id + created_at` for time-series queries
- Foreign key columns
- Status/enum columns for filtering
- Unique constraints where appropriate

## Timestamps

All tables include:

- `createdAt` - Record creation timestamp
- `updatedAt` - Auto-updated timestamp (via Prisma `@updatedAt`)

## Enums

Enums are used for:

- Status fields (ACTIVE, INACTIVE, etc.)
- Types (SIP, PSTN, etc.)
- Directions (INBOUND, OUTBOUND)
- Various state machines

## JSON Fields

Several tables use JSON fields for flexible metadata:

- `metadata` - General-purpose JSON storage
- `config` - Node-specific configurations
- `permissions` - Role permissions array
- `rates` - Rate card structure
- `payload` - Event payloads

## Relationships

### Key Relationships

1. **Tenant → All Business Tables** (One-to-Many)
2. **Campaign → Flow** (Many-to-One)
3. **Flow → FlowVersion → Nodes/Edges** (One-to-Many cascading)
4. **Call → CallLeg** (One-to-Many)
5. **Call → Cdr** (One-to-One)
6. **BillingAccount → RateCard/Invoice/Balance/Payout** (One-to-Many)

## Migration Strategy

1. Run `pnpm db:migrate` to create initial migration
2. Review migration SQL in `prisma/migrations/`
3. Apply migration: `pnpm db:migrate:deploy` (production)
4. Seed data: `pnpm db:seed`

## Seed Data

The seed script creates:

- Test tenant
- Admin user
- Roles (admin, publisher, buyer)
- Carrier, trunk, phone numbers
- Caller ID pool
- Publisher and buyer with endpoints
- Sample flow (IVR → Queue → Buyer Failover)
- Campaign
- Billing account with rate card
- DNC list
- Webhook
- Feature flags
