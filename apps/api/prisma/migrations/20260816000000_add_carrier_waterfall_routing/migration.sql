-- Carrier waterfall routing.
--
-- The seed at the bottom is written to preserve today's behavior exactly:
-- FracTEL is the only ENABLED step in every waterfall, which is what every
-- hardcoded call path already did. The other carriers are inserted as
-- DISABLED steps so that turning one on is a single toggle in the settings UI
-- rather than a data-entry exercise during an outage.

CREATE TYPE "CallRouteType" AS ENUM (
  'INBOUND',
  'CC_MANUAL',
  'CC_POWER_DIALER',
  'SOFTPHONE_MANUAL',
  'PREDICTIVE_DIALER',
  'DOGRAH_AI'
);

CREATE TYPE "CarrierNumberFormat" AS ENUM ('E164', 'NANP11', 'NANP10');

CREATE TABLE "carrier_gateways" (
  "id"                  TEXT                  NOT NULL,
  "tenantId"            TEXT                  NOT NULL,
  "carrierId"           TEXT                  NOT NULL,
  "name"                TEXT                  NOT NULL,
  "priority"            INTEGER               NOT NULL DEFAULT 0,
  "enabled"             BOOLEAN               NOT NULL DEFAULT true,
  "numberFormat"        "CarrierNumberFormat" NOT NULL DEFAULT 'NANP11',
  "consecutiveFailures" INTEGER      NOT NULL DEFAULT 0,
  "circuitOpenUntil"    TIMESTAMP(3),
  "lastFailureAt"       TIMESTAMP(3),
  "lastFailureCause"    TEXT,
  "lastSuccessAt"       TIMESTAMP(3),
  "totalAttempts"       BIGINT       NOT NULL DEFAULT 0,
  "totalFailures"       BIGINT       NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carrier_gateways_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carrier_routes" (
  "id"                TEXT            NOT NULL,
  "tenantId"          TEXT            NOT NULL,
  "callType"          "CallRouteType" NOT NULL,
  "enabled"           BOOLEAN         NOT NULL DEFAULT true,
  "legTimeoutSeconds" INTEGER         NOT NULL DEFAULT 20,
  "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "carrier_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "carrier_route_steps" (
  "id"        TEXT         NOT NULL,
  "routeId"   TEXT         NOT NULL,
  "carrierId" TEXT         NOT NULL,
  "position"  INTEGER      NOT NULL,
  "enabled"   BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carrier_route_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "carrier_gateways_tenantId_name_key" ON "carrier_gateways"("tenantId", "name");
CREATE INDEX "carrier_gateways_tenantId_idx"  ON "carrier_gateways"("tenantId");
CREATE INDEX "carrier_gateways_carrierId_idx" ON "carrier_gateways"("carrierId");

CREATE UNIQUE INDEX "carrier_routes_tenantId_callType_key" ON "carrier_routes"("tenantId", "callType");
CREATE INDEX "carrier_routes_tenantId_idx" ON "carrier_routes"("tenantId");

CREATE UNIQUE INDEX "carrier_route_steps_routeId_carrierId_key" ON "carrier_route_steps"("routeId", "carrierId");
CREATE INDEX "carrier_route_steps_routeId_idx"   ON "carrier_route_steps"("routeId");
CREATE INDEX "carrier_route_steps_carrierId_idx" ON "carrier_route_steps"("carrierId");

ALTER TABLE "carrier_gateways"
  ADD CONSTRAINT "carrier_gateways_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carrier_gateways"
  ADD CONSTRAINT "carrier_gateways_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carrier_routes"
  ADD CONSTRAINT "carrier_routes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carrier_route_steps"
  ADD CONSTRAINT "carrier_route_steps_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "carrier_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carrier_route_steps"
  ADD CONSTRAINT "carrier_route_steps_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Seed
-- ───────────────────────────────────────────────────────────────────────────

-- Carriers. Only the six that have a real gateway definition in
-- apps/freeswitch/conf/sip_profiles/external/ are seeded. `didcentral` is
-- deliberately absent: it is referenced by old code but no gateway of that
-- name has ever existed, so any call routed to it is guaranteed to fail.
INSERT INTO "carriers" ("id", "tenantId", "name", "code", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", c."name", c."code", 'ACTIVE', NOW(), NOW()
FROM "tenants" t
CROSS JOIN (VALUES
  ('FRACTEL',    'FracTEL'),
  ('BULKVS',     'BulkVS'),
  ('SIGNALWIRE', 'SignalWire'),
  ('TELNYX',     'Telnyx'),
  ('ANVEO',      'Anveo'),
  ('VOXBEAM',    'Voxbeam')
) AS c("code", "name")
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- Gateways. `name` is interpolated straight into sofia/gateway/<name>/<number>,
-- so each of these must match a <gateway name="..."> that FreeSWITCH has loaded.
-- The numberFormat column reproduces what each carrier's existing dialplan
-- entry already sent: fractel/bulkvs/didcentral got `1${dest}`, signalwire got
-- `+1${dest}`.
INSERT INTO "carrier_gateways" ("id", "tenantId", "carrierId", "name", "priority", "enabled", "numberFormat", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, ca."tenantId", ca."id", g."name", g."priority", true, g."fmt"::"CarrierNumberFormat", NOW(), NOW()
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
  ('VOXBEAM',    'voxbeam',    0, 'E164')
) AS g("code", "name", "priority", "fmt") ON g."code" = ca."code"
ON CONFLICT ("tenantId", "name") DO NOTHING;

-- One waterfall per call type per tenant.
INSERT INTO "carrier_routes" ("id", "tenantId", "callType", "enabled", "legTimeoutSeconds", "createdAt", "updatedAt")
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

-- Steps. FracTEL enabled at position 0 reproduces the previous hardcoded
-- behavior byte for byte; everything below it is staged but off.
INSERT INTO "carrier_route_steps" ("id", "routeId", "carrierId", "position", "enabled", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."id", ca."id", s."position", s."enabled", NOW(), NOW()
FROM "carrier_routes" r
JOIN "carriers" ca ON ca."tenantId" = r."tenantId"
JOIN (VALUES
  ('FRACTEL',    0, true),
  ('BULKVS',     1, false),
  ('SIGNALWIRE', 2, false),
  ('TELNYX',     3, false),
  ('ANVEO',      4, false),
  ('VOXBEAM',    5, false)
) AS s("code", "position", "enabled") ON s."code" = ca."code"
ON CONFLICT ("routeId", "carrierId") DO NOTHING;
