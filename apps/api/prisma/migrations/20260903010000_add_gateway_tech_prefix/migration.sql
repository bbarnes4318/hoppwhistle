-- Per-gateway tech prefix.
--
-- Anveo Direct selects the outbound trunk a call belongs to by a tech prefix
-- dialed in front of the destination. An INVITE without it matches no trunk and
-- is refused with `404 Not Found ipp` — which reads as an IP-peering failure and
-- is really "I cannot tell which of your trunks this is".
--
-- Every hardcoded Anveo dial string in this repository carried it:
--   infra/freeswitch/dialplan_default.xml  sofia/gateway/anveo/0123451${dest}
--   docs/SOFTPHONE_SETUP_GUIDE.md §3.2     "0123451 + <10-digit-number>"
--
-- The waterfall dropped it when carrier choice moved into the database, because
-- there was nowhere on a gateway to record it. There is now.
--
-- NULL means "dial the destination as-is", which is what every other carrier
-- here wants, so this migration changes nothing except for Anveo.

ALTER TABLE "carrier_gateways" ADD COLUMN "techPrefix" TEXT;

-- The prefix is "012345"; the trailing "1" in the historical 0123451XXXXXXXXXX
-- dial string is the country code, which numberFormat=NANP11 already supplies.
UPDATE "carrier_gateways" SET "techPrefix" = '012345' WHERE "name" = 'anveo';
