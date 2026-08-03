-- Lead dial reservations — operational state for the legacy Hopper.
--
-- Resolves audit finding F-1. The Hopper wrote `'DIALING'::"LeadStatus"`, a
-- member that enum does not contain, so PostgreSQL rejected the first lead of
-- every batch and `originateCall()` was never reached.
--
-- `DIALING` is deliberately NOT added to `LeadStatus`. That enum is a CRM
-- outcome ladder — every member answers "what came of this person" — while a
-- reservation answers "which worker holds this row for the next thirty
-- seconds", and needs an owner, a lease expiry and a fencing token that no enum
-- member can carry. A new member would also add a bucket to every consumer
-- grouping leads by status, and those consumers could not be enumerated.
--
-- Purely additive. One new enum, one new table, foreign keys pointing AT
-- existing tables. No existing table is altered, no column dropped, no row
-- rewritten, and `leads` in particular is untouched.
--
-- Rollback is `down.sql` in this directory, and it is a genuine rollback: this
-- migration adds a table, so dropping it restores the previous state exactly.
-- That is the concrete reason Design B was chosen — PostgreSQL has no
-- `DROP VALUE`, so adding to `LeadStatus` would have been forward-only.

-- CreateEnum
CREATE TYPE "LeadDialReservationState" AS ENUM (
  'RESERVED',
  'ORIGINATION_SUBMITTED',
  'ORIGINATION_ACCEPTED',
  'COMPLETED',
  'RELEASED',
  'NEEDS_RECONCILIATION'
);

-- CreateTable
CREATE TABLE "lead_dial_reservations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "state" "LeadDialReservationState" NOT NULL DEFAULT 'RESERVED',
    "outcome" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "recoveredBy" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "recoveryReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_dial_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_dial_reservations_tenantId_idx" ON "lead_dial_reservations"("tenantId");

-- CreateIndex
CREATE INDEX "lead_dial_reservations_campaignId_idx" ON "lead_dial_reservations"("campaignId");

-- CreateIndex
CREATE INDEX "lead_dial_reservations_leadId_idx" ON "lead_dial_reservations"("leadId");

-- The reaper's read: everything expired and still active.
-- CreateIndex
CREATE INDEX "lead_dial_reservations_state_leaseExpiresAt_idx"
  ON "lead_dial_reservations"("state", "leaseExpiresAt");

-- ── The constraint the whole design rests on ───────────────────────────────
--
-- At most ONE active reservation per lead, enforced by PostgreSQL rather than by
-- the application. Two workers polling the same second will both see the lead as
-- eligible; only one INSERT can win, and the loser gets a unique-violation it
-- can read as "somebody else has it" instead of dialling the same person twice.
--
-- A plain unique index on `leadId` would be wrong — it would permit a lead to be
-- dialled exactly once ever. The predicate scopes uniqueness to reservations
-- that are still live, so a completed or released attempt frees the lead again.
--
-- Prisma's schema language cannot express a partial unique index, so this exists
-- only here. `campaign_agents` has the same shape of constraint expressed the
-- ordinary way; this one has to be written out.
-- CreateIndex
CREATE UNIQUE INDEX "lead_dial_reservations_active_lead_key"
  ON "lead_dial_reservations"("leadId")
  WHERE "releasedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "lead_dial_reservations" ADD CONSTRAINT "lead_dial_reservations_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_dial_reservations" ADD CONSTRAINT "lead_dial_reservations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_dial_reservations" ADD CONSTRAINT "lead_dial_reservations_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
