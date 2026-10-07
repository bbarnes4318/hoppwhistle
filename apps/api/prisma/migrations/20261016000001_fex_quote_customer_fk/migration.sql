-- A saved quote's customer becomes a real foreign key.
--
-- `fex_quotes."insuranceLeadId"` has been written only after a tenant and
-- ownership check, but nothing stopped it outliving its customer. Any link to
-- a customer that no longer exists (or to one in another agency) is cleared
-- first, so the constraint can be added on a live table. Deleting a customer
-- keeps their quotes -- they are the agency's record of what was offered --
-- and unlinks them.

UPDATE "fex_quotes" q
SET "insuranceLeadId" = NULL
WHERE q."insuranceLeadId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "insurance_leads" l
    WHERE l."id" = q."insuranceLeadId" AND l."tenantId" = q."tenantId"
  );

ALTER TABLE "fex_quotes"
  ADD CONSTRAINT "fex_quotes_insuranceLeadId_fkey"
  FOREIGN KEY ("insuranceLeadId") REFERENCES "insurance_leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
