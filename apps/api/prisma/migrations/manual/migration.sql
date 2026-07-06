-- Geo-Routing Migration: Add acceptedStates to BuyerEndpoint, callerZipCode to Call
--
-- Run on production (Legacy Vultr 45.32.213.201):
--   docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric < add_geo_routing_fields.sql
--
-- Or run inline:
--   docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "ALTER TABLE buyer_endpoints ADD COLUMN IF NOT EXISTS \"acceptedStates\" TEXT[] DEFAULT ARRAY[]::TEXT[];"

-- Add acceptedStates column to buyer_endpoints table
-- Empty array = "National" (accepts calls from all states)
ALTER TABLE "buyer_endpoints" ADD COLUMN IF NOT EXISTS "acceptedStates" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add callerZipCode column to calls table for future ZIP-based routing
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "callerZipCode" VARCHAR(10);

-- Create index on acceptedStates for performance (optional, use GIN for array contains queries)
CREATE INDEX IF NOT EXISTS "buyer_endpoints_accepted_states_idx" ON "buyer_endpoints" USING GIN ("acceptedStates");

-- Show migration result
SELECT 'Geo-routing migration complete. BuyerEndpoints now have acceptedStates field.' AS status;
