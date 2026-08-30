-- Whether a number may be PRESENTED as outbound caller ID by the carrier
-- waterfall.
--
-- Separate from `status` on purpose: a number can be perfectly live for inbound
-- while being the wrong thing to dial out as. The Dograh AI numbers are the
-- case in point — presenting one on an agent's outbound call sends every
-- callback into the AI flow instead of back to the agent who placed it.

ALTER TABLE "phone_numbers"
  ADD COLUMN "callerIdEligible" BOOLEAN NOT NULL DEFAULT true;

-- The two Telnyx DIDs the Dograh AI voice agent answers on.
UPDATE "phone_numbers"
SET "callerIdEligible" = false
WHERE regexp_replace("number", '\D', '', 'g') IN ('16083966390', '19592222235');

-- Index the pool lookup: the resolver reads (tenantId, provider, status,
-- callerIdEligible) on every call that needs a caller-ID substitution.
CREATE INDEX "phone_numbers_callerid_pool_idx"
  ON "phone_numbers"("tenantId", "provider", "status", "callerIdEligible");
