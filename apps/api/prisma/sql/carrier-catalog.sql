-- The carrier catalog: the rows the Carrier Routing settings page renders.
--
-- ── Why this file exists rather than only a migration ────────────────────────
--
-- Nothing in this repository runs `prisma/migrations/*/migration.sql` except
-- scripts/deploy-netenroll.sh, and only for the handful of files hardcoded in
-- its REQUIRED_MIGRATIONS list. `prisma migrate deploy` is refused outright
-- (apps/api/scripts/refuse-migrate-deploy.sh) because production has no
-- _prisma_migrations table, and both CI workflows build their schema with
-- `prisma db push`, which applies schema.prisma and never looks at a migration.
--
-- So a carrier added as a data-only migration reaches no database at all: not
-- production, not CI, not a fresh developer checkout. That is exactly what
-- happened to Twilio and Vonage, which were added in
-- 20260921030000_add_twilio_vonage_carriers and never appeared on the settings
-- page anywhere.
--
-- This file is the catalog as it should be, applied the way this repository
-- actually applies SQL: `pnpm --filter @hopwhistle/api db:carriers`, and by the
-- deploy script beside prisma/sql/db-push-constraints.sql.
--
-- ── Re-runnable, and non-destructive ─────────────────────────────────────────
--
-- Every statement is INSERT ... ON CONFLICT DO NOTHING or guarded by NOT
-- EXISTS. It never updates a row that is already there, so an operator's
-- carrier order, their enabled/disabled choices, their tech prefixes and their
-- caller-ID strategies all survive a re-run untouched. It only ever adds what
-- is missing.

-- ── Carriers ────────────────────────────────────────────────────────────────
--
-- Twilio and Vonage are seeded POOL rather than PRESERVE because both REFUSE an
-- outbound call whose From number the account does not own. A leg that falls to
-- them has to present a DID they issued. With no such DIDs yet the resolver
-- keeps the call's existing caller ID and flags it, which is what renders the
-- "no caller ID of its own" warning on the settings page -- the warning an
-- operator wants before enabling the carrier, not after.
INSERT INTO "carriers" (
  "id", "tenantId", "name", "code", "status",
  "callerIdStrategy", "numberProvider", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, t."id", c."name", c."code", 'ACTIVE',
  c."strategy"::"CarrierCallerIdStrategy", c."provider", NOW(), NOW()
FROM "tenants" t
CROSS JOIN (VALUES
  ('FRACTEL',    'FracTEL',    'fractel',    'PRESERVE'),
  ('BULKVS',     'BulkVS',     'bulkvs',     'PRESERVE'),
  ('SIGNALWIRE', 'SignalWire', 'signalwire', 'PRESERVE'),
  ('TELNYX',     'Telnyx',     'telnyx',     'PRESERVE'),
  ('ANVEO',      'Anveo',      'anveo',      'PRESERVE'),
  ('VOXBEAM',    'Voxbeam',    'voxbeam',    'PRESERVE'),
  ('TWILIO',     'Twilio',     'twilio',     'POOL'),
  ('VONAGE',     'Vonage',     'vonage',     'POOL')
) AS c("code", "name", "provider", "strategy")
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- ── Gateways ────────────────────────────────────────────────────────────────
--
-- `name` is interpolated straight into sofia/gateway/<name>/<number>, so each
-- must match a <gateway name="..."> FreeSWITCH has loaded -- see
-- apps/freeswitch/conf/sip_profiles/external/.
--
-- The number formats are not cosmetic and the carriers disagree:
--   Twilio requires E.164 with the `+`   (sip:+1XXXXXXXXXX@<trunk>.pstn.twilio.com)
--   Vonage requires digits with NO `+`   (sip:1XXXXXXXXXX@sip.nexmo.com)
-- Each rejects the other's spelling, so a fallback dialed in the wrong format
-- is a dead call on a carrier that is perfectly healthy.
INSERT INTO "carrier_gateways" (
  "id", "tenantId", "carrierId", "name", "priority", "enabled", "numberFormat",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, ca."tenantId", ca."id", g."name", g."priority", true,
  g."fmt"::"CarrierNumberFormat", NOW(), NOW()
FROM "carriers" ca
JOIN (VALUES
  ('FRACTEL',    'fractel1',   0, 'NANP11'),
  ('FRACTEL',    'fractel2',   1, 'NANP11'),
  ('FRACTEL',    'fractel3',   2, 'NANP11'),
  ('FRACTEL',    'fractel4',   3, 'NANP11'),
  ('FRACTEL',    'fractel5',   4, 'NANP11'),
  ('FRACTEL',    'fractel6',   5, 'NANP11'),
  ('BULKVS',     'bulkvs',     0, 'NANP11'),
  ('SIGNALWIRE', 'signalwire', 0, 'E164'),
  ('TELNYX',     'telnyx',     0, 'E164'),
  ('ANVEO',      'anveo',      0, 'NANP11'),
  ('VOXBEAM',    'voxbeam',    0, 'E164'),
  ('TWILIO',     'twilio',     0, 'E164'),
  ('VONAGE',     'vonage',     0, 'NANP11')
) AS g("code", "name", "priority", "fmt") ON g."code" = ca."code"
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- ── One waterfall per call type, per tenant ─────────────────────────────────
INSERT INTO "carrier_routes" (
  "id", "tenantId", "callType", "enabled", "legTimeoutSeconds", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, t."id", ct."v"::"CallRouteType", true, 20, NOW(), NOW()
FROM "tenants" t
CROSS JOIN (VALUES
  ('INBOUND'),
  ('CC_MANUAL'),
  ('CC_POWER_DIALER'),
  ('SOFTPHONE_MANUAL'),
  ('PREDICTIVE_DIALER'),
  ('DOGRAH_AI')
) AS ct("v")
ON CONFLICT ("tenantId", "callType") DO NOTHING;

-- ── Waterfall steps ─────────────────────────────────────────────────────────
--
-- Only carriers that are not already on a waterfall are added, and they are
-- appended BELOW whatever is there rather than at fixed positions: tenants have
-- reordered their waterfalls, and two carriers claiming one position is exactly
-- the ambiguity the settings page's full-replacement PUT exists to avoid.
--
-- Everything except FracTEL lands disabled, so applying this file never changes
-- where a call goes. Turning a carrier on stays a deliberate toggle.
INSERT INTO "carrier_route_steps" (
  "id", "routeId", "carrierId", "position", "enabled", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  r."id",
  ca."id",
  COALESCE(m."maxPosition", -1)
    + ROW_NUMBER() OVER (PARTITION BY r."id" ORDER BY s."rank")::int,
  s."enabled",
  NOW(),
  NOW()
FROM "carrier_routes" r
JOIN "carriers" ca ON ca."tenantId" = r."tenantId"
JOIN (VALUES
  ('FRACTEL',    0, true),
  ('BULKVS',     1, false),
  ('SIGNALWIRE', 2, false),
  ('TELNYX',     3, false),
  ('ANVEO',      4, false),
  ('VOXBEAM',    5, false),
  ('TWILIO',     6, false),
  ('VONAGE',     7, false)
) AS s("code", "rank", "enabled") ON s."code" = ca."code"
LEFT JOIN LATERAL (
  SELECT MAX(st."position") AS "maxPosition"
  FROM "carrier_route_steps" st
  WHERE st."routeId" = r."id"
) m ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM "carrier_route_steps" st
  WHERE st."routeId" = r."id" AND st."carrierId" = ca."id"
)
ON CONFLICT ("routeId", "carrierId") DO NOTHING;
