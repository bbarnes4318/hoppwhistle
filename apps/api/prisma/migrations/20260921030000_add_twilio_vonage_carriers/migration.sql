-- Twilio and Vonage as routable carriers.
--
-- Both already exist as provisioning adapters (numbers can be bought from
-- them); this is the other half — the rows that let the waterfall dial them and
-- that put them on the Carrier Routing settings page next to FracTEL, Anveo and
-- the rest.
--
-- Nothing here changes where a call goes. Both carriers are appended to every
-- waterfall as DISABLED steps, below whatever is already configured, exactly
-- as the original carrier seed staged BulkVS and Telnyx. Turning one on is
-- then a single toggle rather than a data-entry exercise during an outage.

-- ───────────────────────────────────────────────────────────────────────────
-- Carriers
-- ───────────────────────────────────────────────────────────────────────────
--
-- callerIdStrategy is POOL for both, which is a stronger claim than the
-- PRESERVE the other carriers were seeded with, and deliberate: Twilio and
-- Vonage both REFUSE an outbound call whose From number the account does not
-- own or has not verified. PRESERVE would hand them a FracTEL DID and every
-- leg that fell to them would be rejected.
--
-- POOL with an empty pool is the honest state for an account that has not
-- bought numbers there yet: the resolver keeps the call's existing caller ID
-- and flags `callerIdUnavailable`, which is what renders the "no caller ID of
-- its own" warning on the settings page. That is the warning an operator needs
-- before enabling the carrier, not after.
INSERT INTO "carriers" (
  "id", "tenantId", "name", "code", "status",
  "callerIdStrategy", "numberProvider", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, t."id", c."name", c."code", 'ACTIVE',
  'POOL'::"CarrierCallerIdStrategy", c."provider", NOW(), NOW()
FROM "tenants" t
CROSS JOIN (VALUES
  ('TWILIO', 'Twilio', 'twilio'),
  ('VONAGE', 'Vonage', 'vonage')
) AS c("code", "name", "provider")
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Gateways
-- ───────────────────────────────────────────────────────────────────────────
--
-- `name` is interpolated straight into sofia/gateway/<name>/<number>, so each
-- must match a <gateway name="..."> FreeSWITCH has loaded — see
-- apps/freeswitch/conf/sip_profiles/external/{twilio,vonage}.xml.
--
-- The formats are not the same and the difference is not cosmetic:
--   Twilio requires E.164 with the leading `+` (sip:+1XXXXXXXXXX@…pstn.twilio.com)
--   Vonage requires international digits with NO `+`  (sip:1XXXXXXXXXX@sip.nexmo.com)
-- Each rejects the other's spelling, so a fallback dialed in the wrong format
-- is a dead call on a carrier that is perfectly healthy.
INSERT INTO "carrier_gateways" (
  "id", "tenantId", "carrierId", "name", "priority", "enabled", "numberFormat",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, ca."tenantId", ca."id", g."name", 0, true,
  g."fmt"::"CarrierNumberFormat", NOW(), NOW()
FROM "carriers" ca
JOIN (VALUES
  ('TWILIO', 'twilio', 'E164'),
  ('VONAGE', 'vonage', 'NANP11')
) AS g("code", "name", "fmt") ON g."code" = ca."code"
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Waterfall steps
-- ───────────────────────────────────────────────────────────────────────────
--
-- Appended below the existing rungs rather than at fixed positions 6 and 7:
-- tenants have reordered their waterfalls since the original seed, and two
-- carriers claiming a position another carrier already holds is exactly the
-- ambiguity the settings page's full-replacement PUT exists to avoid.
--
-- Both rows are disabled, so the effective chain is byte-for-byte what it was
-- before this migration ran.
INSERT INTO "carrier_route_steps" (
  "id", "routeId", "carrierId", "position", "enabled", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  r."id",
  ca."id",
  COALESCE(m."maxPosition", -1) + s."offset",
  false,
  NOW(),
  NOW()
FROM "carrier_routes" r
JOIN "carriers" ca ON ca."tenantId" = r."tenantId"
JOIN (VALUES
  ('TWILIO', 1),
  ('VONAGE', 2)
) AS s("code", "offset") ON s."code" = ca."code"
LEFT JOIN LATERAL (
  SELECT MAX(st."position") AS "maxPosition"
  FROM "carrier_route_steps" st
  WHERE st."routeId" = r."id"
) m ON TRUE
ON CONFLICT ("routeId", "carrierId") DO NOTHING;
