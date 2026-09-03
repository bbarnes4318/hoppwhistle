-- Per-carrier STIR/SHAKEN attestation claim.
--
-- Carrier choice used to be hardcoded per dialplan, and the Anveo-only
-- extension (`01_anveo_outbound.xml`) set `P-Attestation-Indicator=A` before
-- every bridge. When routing moved into the configurable waterfall that header
-- was not carried across, so legs that used to claim an attestation stopped
-- claiming one.
--
-- NULL means "send no header", so this migration changes nothing on its own.
-- Only a carrier explicitly given a value starts asserting one.

ALTER TABLE "carriers" ADD COLUMN "attestation" TEXT;

-- Anveo reads the header to decide how to sign; it is the carrier the original
-- dialplan set it for, and the only one we know consumes it. FracTEL signs from
-- its own records (A when the caller ID is a FracTEL DID, otherwise B) and is
-- deliberately left NULL so we keep asserting nothing there.
UPDATE "carriers" SET "attestation" = 'A' WHERE "code" = 'ANVEO';
