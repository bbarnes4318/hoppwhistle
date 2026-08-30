-- Per-carrier caller ID.
--
-- A carrier can only attest to a number it issued. Presenting a FracTEL DID on
-- Anveo's trunk earns C-attestation or a rejection — which is the spam-labeling
-- failure mode, not a fix for it. So when a call falls from one carrier to the
-- next, its caller ID has to move with it.
--
-- Defaults are chosen so this migration changes nothing on its own: every
-- carrier starts at PRESERVE, which is the behavior that existed before.

CREATE TYPE "CarrierCallerIdStrategy" AS ENUM ('PRESERVE', 'POOL', 'FIXED');

ALTER TABLE "carriers"
  ADD COLUMN "callerIdStrategy" "CarrierCallerIdStrategy" NOT NULL DEFAULT 'PRESERVE',
  ADD COLUMN "callerIdNumber"   TEXT,
  ADD COLUMN "numberProvider"   TEXT;

-- Link each seeded carrier to the `phone_numbers.provider` value that identifies
-- the DIDs it issued. This is what the POOL strategy searches. A carrier with no
-- matching numbers resolves to "keep the existing caller ID" and logs a warning
-- rather than presenting an empty one, which carriers reject outright.
UPDATE "carriers" SET "numberProvider" = 'fractel'    WHERE "code" = 'FRACTEL';
UPDATE "carriers" SET "numberProvider" = 'bulkvs'     WHERE "code" = 'BULKVS';
UPDATE "carriers" SET "numberProvider" = 'anveo'      WHERE "code" = 'ANVEO';
UPDATE "carriers" SET "numberProvider" = 'telnyx'     WHERE "code" = 'TELNYX';
UPDATE "carriers" SET "numberProvider" = 'signalwire' WHERE "code" = 'SIGNALWIRE';
UPDATE "carriers" SET "numberProvider" = 'voxbeam'    WHERE "code" = 'VOXBEAM';

-- Carriers we actually hold numbers with present their own; the rest stay on
-- PRESERVE until numbers exist for them, at which point flipping the strategy is
-- a one-field change.
UPDATE "carriers" c
SET "callerIdStrategy" = 'POOL'
WHERE c."numberProvider" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "phone_numbers" p
    WHERE p."tenantId" = c."tenantId"
      AND p."provider" = c."numberProvider"
      AND p."status" = 'ACTIVE'
  );
