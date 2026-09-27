-- A number given back to the carrier is RELEASED, not INACTIVE.
--
-- DELETE /api/v1/numbers/:numberId releases the number at its carrier, removes
-- its DID routes and ends its monthly charge. The row stays for call history
-- and billing. INACTIVE keeps meaning "held but switched off", which is what
-- the phone-number quota still counts while the carrier holds the number.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260929010000_phone_number_released/migration.sql
--
-- Not wrapped in BEGIN..COMMIT: a value added by ALTER TYPE cannot be used in
-- the transaction that added it, and nothing here needs to. IF NOT EXISTS makes
-- a second run a no-op.

ALTER TYPE "PhoneNumberStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
