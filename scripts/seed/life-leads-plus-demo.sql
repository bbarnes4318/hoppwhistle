-- Life Leads Plus: turn on the white-label tier and brand, and seed demo data.
--
-- Plain SQL for a host with no node_modules and no Prisma CLI:
--
--   cat scripts/seed/life-leads-plus-demo.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric -v ON_ERROR_STOP=1
--
-- Undo with scripts/seed/life-leads-plus-demo-remove.sql.
--
-- ── What it writes ───────────────────────────────────────────────────────────
--
-- In the existing tenant named 'Life Leads Plus': the white-label flag and the
-- 'life-leads-plus' brand, an ADMIN and 12 AGENTs, 3 publishers, 4 buyers, 2
-- campaigns, ~30 days of inbound calls plus today (3 of them in flight),
-- submitted applications on the agent-answered calls, and two weeks of
-- recorded publisher payments. Two child agencies under it, each with an OWNER,
-- agents, calls and applications.
--
-- It never creates phone_numbers, did_routes, buyer_endpoints,
-- agency_billing_profiles, credit ledger, settlement or rating rows, in any
-- tenant. With no number attached, no live call can reach a seeded campaign,
-- buyer or child agency.
--
-- ── Markers ──────────────────────────────────────────────────────────────────
--
-- Every seeded row carries one, and the deletes below match only on them:
--   child tenants                   slug LIKE 'llp-demo-%' AND "parentTenantId" = Life Leads Plus
--   users                           email LIKE '%@demo.lifeleadsplus.test'
--   publishers / buyers             code LIKE 'LLPDEMO%'
--   campaigns                       metadata->>'seed' = 'llp-demo'
--   calls                           "callSid" LIKE 'LLPDEMO-%'
--   insurance_carrier_applications  "clientRequestId" LIKE 'llp-demo-%'
--   publisher_payments              reference LIKE 'LLPDEMO-%'
--
-- ── Re-running ───────────────────────────────────────────────────────────────
--
-- One transaction. It deletes every marked row first, then inserts, so a second
-- run leaves exactly one copy. The draws come from setseed(0.4318), so the same
-- run on the same day gives the same shape; the window moves with the clock.

BEGIN;

-- Every timestamp column is `timestamp(3)` holding UTC, as Prisma writes it.
-- Pin the session zone so now() and every timestamptz below store as UTC
-- whatever the server's own TimeZone setting is.
SET LOCAL TIME ZONE 'UTC';

-- ─────────────────────────────────────────────────────────────────────────────
-- Guards
-- ─────────────────────────────────────────────────────────────────────────────

DO $guard$
DECLARE
  found_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tenants'
      AND column_name = 'whiteLabel'
  ) THEN
    RAISE EXCEPTION 'Apply migration 20260926000000_tenant_white_label first';
  END IF;

  SELECT count(*) INTO found_count FROM tenants WHERE name = 'Life Leads Plus';
  IF found_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one tenant named Life Leads Plus, found %', found_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agency_billing_profiles b
    JOIN tenants t ON t.id = b."tenantId"
    WHERE t.name = 'Life Leads Plus'
      AND b."billingEnrolledAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Life Leads Plus is enrolled in billing; seeded applications would be settled. Aborting.';
  END IF;

  SELECT count(*) INTO found_count FROM roles WHERE name::text IN ('OWNER', 'ADMIN', 'AGENT');
  IF found_count <> 3 THEN
    RAISE EXCEPTION 'Expected the OWNER, ADMIN and AGENT roles to exist, found % of them', found_count;
  END IF;

  CREATE TEMP TABLE llp ON COMMIT DROP AS
    SELECT id FROM tenants WHERE name = 'Life Leads Plus';
END
$guard$;

-- Life Leads Plus and the child agencies this script seeded under it.
CREATE TEMP TABLE llp_scope ON COMMIT DROP AS
  SELECT id FROM llp
  UNION ALL
  SELECT t.id FROM tenants t
  WHERE t.slug LIKE 'llp-demo-%' AND t."parentTenantId" = (SELECT id FROM llp);

-- ─────────────────────────────────────────────────────────────────────────────
-- Delete every marked row, children first
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM publisher_payments
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND reference LIKE 'LLPDEMO-%';

DELETE FROM insurance_carrier_applications
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND "clientRequestId" LIKE 'llp-demo-%';

DELETE FROM calls
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND "callSid" LIKE 'LLPDEMO-%';

DELETE FROM campaign_buyers
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND (
    "campaignId" IN (
      SELECT id FROM campaigns
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo'
    )
    OR "buyerId" IN (
      SELECT id FROM buyers
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%'
    )
  );

DELETE FROM campaign_publishers
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND (
    "campaignId" IN (
      SELECT id FROM campaigns
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo'
    )
    OR "publisherId" IN (
      SELECT id FROM publishers
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%'
    )
  );

DELETE FROM campaigns
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo';

DELETE FROM buyers
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%';

DELETE FROM publishers
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%';

DELETE FROM user_roles
WHERE "userId" IN (
  SELECT id FROM users
  WHERE "tenantId" IN (SELECT id FROM llp_scope) AND email LIKE '%@demo.lifeleadsplus.test'
);

DELETE FROM users
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND email LIKE '%@demo.lifeleadsplus.test';

DELETE FROM tenants
WHERE slug LIKE 'llp-demo-%' AND "parentTenantId" = (SELECT id FROM llp);

-- From here on every random() is reproducible.
SELECT setseed(0.4318);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Turn on what is already built
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE tenants SET
  "whiteLabel" = true,
  "brandTheme" = 'life-leads-plus',
  "brandName" = 'Life Leads Plus',
  "isNonProduction" = true,
  "nonProductionNote" = 'White-label demo tenant, seeded by scripts/seed/life-leads-plus-demo.sql',
  "nonProductionMarkedAt" = now(),
  "updatedAt" = now()
WHERE id = (SELECT id FROM llp);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9a. The two child agencies (created first: their people and calls need them)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_tenant ON COMMIT DROP AS
  SELECT 'llp'::text AS tenant_key, id, NULL::text AS name, NULL::text AS slug FROM llp
  UNION ALL
  SELECT v.tenant_key, gen_random_uuid()::text, v.name, v.slug
  FROM (VALUES
    ('riverbend', 'Riverbend Senior Insurance', 'llp-demo-riverbend'),
    ('magnolia',  'Magnolia Family Agency',     'llp-demo-magnolia')
  ) AS v(tenant_key, name, slug);

INSERT INTO tenants (
  id, name, slug, status, "createdAt", "updatedAt",
  "parentTenantId", "brandTheme", "brandName", "whiteLabel",
  "isNonProduction", "nonProductionNote", "nonProductionMarkedAt"
)
SELECT
  t.id, t.name, t.slug, 'ACTIVE'::"TenantStatus", now(), now(),
  (SELECT id FROM llp), 'life-leads-plus', 'Life Leads Plus', false,
  true, 'White-label demo tenant, seeded by scripts/seed/life-leads-plus-demo.sql', now()
FROM llp_tenant t
WHERE t.tenant_key <> 'llp';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 & 9b. People
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_person ON COMMIT DROP AS
  SELECT
    gen_random_uuid()::text AS id,
    t.id AS tenant_id,
    v.tenant_key, v.ord, v.first_name, v.last_name, v.role, v.tier,
    lower(v.first_name || '.' || v.last_name) || '@demo.lifeleadsplus.test' AS email
  FROM (VALUES
    ('llp',        0, 'Renee',    'Castillo',  'ADMIN', NULL),
    ('llp',        1, 'Marcus',   'Bell',      'AGENT', 'A'),
    ('llp',        2, 'Tanya',    'Rodriguez', 'AGENT', 'A'),
    ('llp',        3, 'Derek',    'Owens',     'AGENT', 'A'),
    ('llp',        4, 'Keisha',   'Grant',     'AGENT', 'B'),
    ('llp',        5, 'Brandon',  'Hayes',     'AGENT', 'B'),
    ('llp',        6, 'Lauren',   'Mitchell',  'AGENT', 'B'),
    ('llp',        7, 'Andre',    'Coleman',   'AGENT', 'B'),
    ('llp',        8, 'Nicole',   'Barrett',   'AGENT', 'C'),
    ('llp',        9, 'Jason',    'Pryor',     'AGENT', 'C'),
    ('llp',       10, 'Monique',  'Ellis',     'AGENT', 'C'),
    ('llp',       11, 'Travis',   'Cole',      'AGENT', 'D'),
    ('llp',       12, 'Heather',  'Lane',      'AGENT', 'D'),
    ('riverbend',  0, 'Carla',    'Jennings',  'OWNER', NULL),
    ('riverbend',  1, 'Owen',     'Pratt',     'AGENT', NULL),
    ('riverbend',  2, 'Gina',     'Russo',     'AGENT', NULL),
    ('riverbend',  3, 'Tyrell',   'Banks',     'AGENT', NULL),
    ('riverbend',  4, 'Amy',      'Fowler',    'AGENT', NULL),
    ('riverbend',  5, 'Luis',     'Ortega',    'AGENT', NULL),
    ('magnolia',   0, 'Denise',   'Whitaker',  'OWNER', NULL),
    ('magnolia',   1, 'Ray',      'Sutton',    'AGENT', NULL),
    ('magnolia',   2, 'Kim',      'Doyle',     'AGENT', NULL),
    ('magnolia',   3, 'Paul',     'Henson',    'AGENT', NULL)
  ) AS v(tenant_key, ord, first_name, last_name, role, tier)
  JOIN llp_tenant t ON t.tenant_key = v.tenant_key;

INSERT INTO users (
  id, "tenantId", email, "passwordHash", "authMethod", "firstName", "lastName",
  status, metadata, "createdAt", "updatedAt"
)
SELECT
  p.id, p.tenant_id, p.email, NULL, 'EMAIL'::"AuthMethod", p.first_name, p.last_name,
  'ACTIVE'::"UserStatus", '{"seed":"llp-demo"}'::jsonb, now(), now()
FROM llp_person p
ORDER BY p.tenant_key, p.ord;

INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid()::text, p.id, r.id, now()
FROM llp_person p
JOIN roles r ON r.name::text = p.role;

-- Who answers calls, and how often. Life Leads Plus weights by closing tier
-- (A 3, B 2, C 2, D 1); the child agencies weight every agent equally. Each
-- agent owns the slice [lo, hi) of [0, 1).
CREATE TEMP TABLE llp_agent ON COMMIT DROP AS
  WITH weighted AS (
    SELECT
      p.id AS user_id, p.tenant_key, p.ord, p.tier,
      CASE p.tier WHEN 'A' THEN 3 WHEN 'B' THEN 2 WHEN 'C' THEN 2 WHEN 'D' THEN 1 ELSE 1 END
        AS weight,
      CASE p.tier
        WHEN 'A' THEN 0.22 WHEN 'B' THEN 0.15 WHEN 'C' THEN 0.10 WHEN 'D' THEN 0.06
        ELSE 0.13
      END AS app_probability
    FROM llp_person p
    WHERE p.role = 'AGENT'
  )
  SELECT
    w.*,
    (sum(w.weight) OVER (PARTITION BY w.tenant_key ORDER BY w.ord) - w.weight)::float8
      / sum(w.weight) OVER (PARTITION BY w.tenant_key) AS lo,
    sum(w.weight) OVER (PARTITION BY w.tenant_key ORDER BY w.ord)::float8
      / sum(w.weight) OVER (PARTITION BY w.tenant_key) AS hi
  FROM weighted w;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Publishers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_pub ON COMMIT DROP AS
  SELECT gen_random_uuid()::text AS id, v.code, v.name
  FROM (VALUES
    ('LLPDEMOPUB1', 'Senior Direct Mail'),
    ('LLPDEMOPUB2', 'TV Response Line'),
    ('LLPDEMOPUB3', 'Digital Inbound')
  ) AS v(code, name);

INSERT INTO publishers (id, "tenantId", name, code, email, status, metadata, "createdAt", "updatedAt")
SELECT
  p.id, (SELECT id FROM llp), p.name, p.code, NULL, 'ACTIVE'::"PublisherStatus",
  '{"seed":"llp-demo"}'::jsonb, now(), now()
FROM llp_pub p
ORDER BY p.code;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Buyers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_buyer ON COMMIT DROP AS
  SELECT gen_random_uuid()::text AS id, v.code, v.name, v.price, v.destination
  FROM (VALUES
    ('LLPDEMOBUY1', 'Heritage Final Expense Group', 45.00::numeric, '+12025550141'),
    ('LLPDEMOBUY2', 'Summit Senior Advisors',       40.00::numeric, '+12025550142'),
    ('LLPDEMOBUY3', 'Evergreen Life Agency',        38.00::numeric, '+12025550143'),
    ('LLPDEMOBUY4', 'Cornerstone Benefits',         50.00::numeric, '+12025550144')
  ) AS v(code, name, price, destination);

INSERT INTO buyers (
  id, "tenantId", name, code, status, "billingType", "billableDuration",
  metadata, "createdAt", "updatedAt"
)
SELECT
  b.id, (SELECT id FROM llp), b.name, b.code, 'ACTIVE'::"BuyerStatus", 'TERMS'::"BuyerBillingType", 120,
  '{"seed":"llp-demo"}'::jsonb, now(), now()
FROM llp_buyer b
ORDER BY b.code;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Campaigns
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_campaign ON COMMIT DROP AS
  SELECT gen_random_uuid()::text AS id, v.*
  FROM (VALUES
    ('FE',  'Final Expense Inbound', 'Final Expense', 'LLPDEMOPUB1', 20.00::numeric, 45.00::numeric, '+18885550100'),
    ('MED', 'Medicare Inbound',      'Medicare',      'LLPDEMOPUB3', 22.00::numeric, 50.00::numeric, '+18885550101')
  ) AS v(campaign_key, name, offer_name, publisher_code, payout, price, did);

INSERT INTO campaigns (
  id, "tenantId", "publisherId", name, "offerName", status, "routingMode", metadata,
  "billableDurationSeconds", "publisherPayoutPerBillableCall", "buyerPricePerBillableCall",
  "createdAt", "updatedAt"
)
SELECT
  c.id, (SELECT id FROM llp), p.id, c.name, c.offer_name, 'ACTIVE'::"CampaignStatus",
  'STATIC'::"RoutingMode", '{"seed":"llp-demo"}'::jsonb,
  120, c.payout, c.price,
  now(), now()
FROM llp_campaign c
JOIN llp_pub p ON p.code = c.publisher_code
ORDER BY c.campaign_key;

INSERT INTO campaign_publishers (
  id, "tenantId", "campaignId", "publisherId", status, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, (SELECT id FROM llp), c.id, p.id,
  'ACTIVE'::"CampaignPublisherStatus", now(), now()
FROM (VALUES
  ('FE',  'LLPDEMOPUB1'),
  ('FE',  'LLPDEMOPUB2'),
  ('MED', 'LLPDEMOPUB3')
) AS v(campaign_key, publisher_code)
JOIN llp_campaign c ON c.campaign_key = v.campaign_key
JOIN llp_pub p ON p.code = v.publisher_code;

INSERT INTO campaign_buyers (
  id, "tenantId", "campaignId", "buyerId", "destinationNumber", "pricePerBillableCall",
  status, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, (SELECT id FROM llp), c.id, b.id, b.destination, b.price,
  'ACTIVE'::"CampaignBuyerStatus", now(), now()
FROM (VALUES
  ('FE',  'LLPDEMOBUY1'),
  ('FE',  'LLPDEMOBUY2'),
  ('FE',  'LLPDEMOBUY3'),
  ('MED', 'LLPDEMOBUY4')
) AS v(campaign_key, buyer_code)
JOIN llp_campaign c ON c.campaign_key = v.campaign_key
JOIN llp_buyer b ON b.code = v.buyer_code;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 & 9c. Call slots
--
-- The previous 30 calendar days in America/New_York, 09:00-18:00 ET, plus
-- today. Life Leads Plus: 170 a weekday, 60 on Saturday, none on Sunday, and
-- today 22 an hour from 09:00 ET (or now() - 6h if later). Riverbend 45 and
-- Magnolia 25 a weekday, none on weekends, and today pro rata from 09:00 ET.
--
-- Today's slots stop two minutes short of now(), so every completed call has
-- ended before the script ran; the three in-flight calls are added after.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_clock ON COMMIT DROP AS
  SELECT
    (now() AT TIME ZONE 'America/New_York')::date AS today,
    now() AS run_at,
    now() - interval '2 minutes' AS last_slot;

CREATE TEMP TABLE llp_window ON COMMIT DROP AS
  -- The previous 30 days.
  SELECT
    r.tenant_key,
    d::date AS day,
    ((d::date + time '09:00') AT TIME ZONE 'America/New_York') AS starts,
    ((d::date + time '18:00') AT TIME ZONE 'America/New_York') AS ends,
    CASE
      WHEN extract(isodow FROM d) = 7 THEN 0
      WHEN extract(isodow FROM d) = 6 THEN r.saturday
      ELSE r.weekday
    END AS calls
  FROM llp_clock k
  CROSS JOIN generate_series((k.today - 30)::timestamp, (k.today - 1)::timestamp, interval '1 day') AS d
  CROSS JOIN (VALUES
    ('llp',       1, 170, 60),
    ('riverbend', 2,  45,  0),
    ('magnolia',  3,  25,  0)
  ) AS r(tenant_key, tenant_order, weekday, saturday)
  UNION ALL
  -- Today, Life Leads Plus: 22 an hour.
  SELECT
    'llp', k.today, w.starts, k.last_slot,
    greatest(0, floor(22 * extract(epoch FROM (k.last_slot - w.starts)) / 3600))::int
  FROM llp_clock k
  CROSS JOIN LATERAL (
    SELECT greatest(
      (k.today + time '09:00') AT TIME ZONE 'America/New_York',
      k.run_at - interval '6 hours'
    ) AS starts
  ) w
  UNION ALL
  -- Today, the child agencies: their weekday volume, pro rata over 09:00-18:00.
  SELECT
    r.tenant_key, k.today, w.starts, w.ends,
    CASE
      WHEN extract(isodow FROM k.today) >= 6 THEN 0
      ELSE greatest(0, floor(r.weekday * extract(epoch FROM (w.ends - w.starts)) / (9 * 3600)))::int
    END
  FROM llp_clock k
  CROSS JOIN (VALUES ('riverbend', 45), ('magnolia', 25)) AS r(tenant_key, weekday)
  CROSS JOIN LATERAL (
    SELECT
      (k.today + time '09:00') AT TIME ZONE 'America/New_York' AS starts,
      least((k.today + time '18:00') AT TIME ZONE 'America/New_York', k.last_slot) AS ends
  ) w;

-- One row per call. Past days come first and today last, so a second run a few
-- minutes later, whose today has a call more or less, draws the same numbers
-- for every earlier day.
CREATE TEMP TABLE llp_slot ON COMMIT DROP AS
  SELECT
    row_number() OVER (
      ORDER BY w.day = (SELECT today FROM llp_clock), o.tenant_order, w.day, i
    ) AS seq,
    w.tenant_key, w.day, w.starts, w.ends, w.calls, i AS slot
  FROM llp_window w
  JOIN (VALUES ('llp', 1), ('riverbend', 2), ('magnolia', 3)) AS o(tenant_key, tenant_order)
    ON o.tenant_key = w.tenant_key
  CROSS JOIN LATERAL generate_series(0, w.calls - 1) AS i
  WHERE w.calls > 0 AND w.ends > w.starts;

-- Every draw a call needs, taken once, in slot order. Each call is spread
-- evenly over its window with a little jitter.
CREATE TEMP TABLE llp_draw ON COMMIT DROP AS
  SELECT
    s.seq, s.tenant_key, s.day,
    s.starts + (((s.slot + random()) * extract(epoch FROM (s.ends - s.starts)) / s.calls)
      * interval '1 second') AS started,
    random() AS r_campaign, random() AS r_publisher, random() AS r_outcome,
    random() AS r_buyer,    random() AS r_agent,     random() AS r_ring,
    random() AS r_connect,  random() AS r_area,      random() AS r_line,
    random() AS r_disposition, random() AS r_dispute, random() AS r_app,
    random() AS r_carrier,  random() AS r_plan,      random() AS r_face,
    random() AS r_premium,  random() AS r_first,     random() AS r_last,
    random() AS r_age,      random() AS r_submit
  FROM (SELECT * FROM llp_slot ORDER BY seq) s;

CREATE TEMP TABLE llp_area ON COMMIT DROP AS
  SELECT *
  FROM unnest(
    ARRAY[205, 251, 256, 334, 479, 501, 601, 662, 865, 901, 423, 615, 731, 850, 904, 352, 727, 813, 318, 504],
    ARRAY['AL','AL','AL','AL','AR','AR','MS','MS','TN','TN','TN','TN','TN','FL','FL','FL','FL','FL','LA','LA']
  ) WITH ORDINALITY AS a(area_code, state_code, idx);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Each call's outcome, timing and money
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_call ON COMMIT DROP AS
  WITH picked AS (
    SELECT
      d.*,
      t.id AS tenant_id,
      CASE WHEN d.tenant_key <> 'llp' THEN NULL
           WHEN d.r_campaign < 0.80 THEN 'FE' ELSE 'MED' END AS campaign_key,
      CASE
        WHEN d.tenant_key <> 'llp' THEN CASE WHEN d.r_outcome < 0.85 THEN 'AGENT' ELSE 'NONE' END
        WHEN d.r_campaign >= 0.80 THEN 'BUYER'
        WHEN d.r_outcome < 0.55 THEN 'AGENT'
        WHEN d.r_outcome < 0.90 THEN 'BUYER'
        ELSE 'NONE'
      END AS outcome,
      a.area_code, a.state_code,
      '+1' || a.area_code || '555' || lpad((100 + floor(d.r_line * 100))::int::text, 4, '0') AS caller_id
    FROM llp_draw d
    JOIN llp_tenant t ON t.tenant_key = d.tenant_key
    JOIN llp_area a ON a.idx = 1 + floor(d.r_area * 20)::int
  ),
  routed AS (
    SELECT
      p.*,
      c.id AS campaign_id, c.name AS campaign_name, c.payout AS campaign_payout,
      COALESCE(c.did, '+18885550100') AS did,
      CASE
        WHEN p.campaign_key = 'MED' THEN 'LLPDEMOPUB3'
        WHEN p.campaign_key = 'FE' AND p.r_publisher < 0.60 THEN 'LLPDEMOPUB1'
        WHEN p.campaign_key = 'FE' THEN 'LLPDEMOPUB2'
      END AS publisher_code,
      CASE
        WHEN p.outcome <> 'BUYER' THEN NULL
        WHEN p.campaign_key = 'MED' THEN 'LLPDEMOBUY4'
        WHEN p.r_buyer < 0.45 THEN 'LLPDEMOBUY1'
        WHEN p.r_buyer < 0.80 THEN 'LLPDEMOBUY2'
        ELSE 'LLPDEMOBUY3'
      END AS buyer_code,
      CASE p.outcome
        WHEN 'AGENT' THEN 8 + floor(p.r_ring * 18)::int
        WHEN 'BUYER' THEN 6 + floor(p.r_ring * 10)::int
        ELSE 15 + floor(p.r_ring * 31)::int
      END AS ring_drawn,
      CASE p.outcome
        WHEN 'AGENT' THEN 90 + floor(p.r_connect * 1411)::int
        WHEN 'BUYER' THEN 20 + floor(p.r_connect * 881)::int
        ELSE 0
      END AS connected_drawn,
      -- How long ago the call started; a call from today must end before now().
      floor(extract(epoch FROM ((SELECT run_at FROM llp_clock) - p.started)))::int - 5 AS room
    FROM picked p
    LEFT JOIN llp_campaign c ON c.campaign_key = p.campaign_key
  ),
  timed AS (
    SELECT
      r.*,
      pub.id AS publisher_id, pub.name AS publisher_name,
      b.id AS buyer_id, b.name AS buyer_name, b.price AS buyer_price, b.destination AS buyer_destination,
      ag.user_id AS agent_id, ag.app_probability,
      CASE WHEN r.outcome = 'NONE' THEN least(r.ring_drawn, greatest(r.room, 1)) ELSE r.ring_drawn END AS ring,
      CASE WHEN r.outcome = 'NONE' THEN 0
           ELSE least(r.connected_drawn, greatest(r.room - r.ring_drawn, 0)) END AS connected
    FROM routed r
    LEFT JOIN llp_pub pub ON pub.code = r.publisher_code
    LEFT JOIN llp_buyer b ON b.code = r.buyer_code
    LEFT JOIN llp_agent ag
      ON r.outcome = 'AGENT'
     AND ag.tenant_key = r.tenant_key
     AND r.r_agent >= ag.lo AND r.r_agent < ag.hi
  ),
  billed AS (
    SELECT
      t.*,
      (t.outcome = 'BUYER' AND t.connected >= 120) AS is_billable,
      CASE WHEN t.outcome = 'NONE' THEN NULL
           ELSE t.started + t.ring * interval '1 second' END AS answered,
      t.started + (t.ring + t.connected) * interval '1 second' AS ended
    FROM timed t
  )
  SELECT
    gen_random_uuid()::text AS id,
    'LLPDEMO-' || gen_random_uuid()::text AS call_sid,
    b.*,
    (b.is_billable AND b.r_dispute < 0.02) AS is_disputed,
    (b.outcome = 'AGENT' AND b.campaign_key IS DISTINCT FROM 'MED'
       AND b.connected >= 480 AND b.r_app < b.app_probability) AS has_application,
    least(
      b.ended + (60 + floor(b.r_submit * 181)::int) * interval '1 second',
      (SELECT run_at FROM llp_clock)
    ) AS submitted
  FROM billed b;

INSERT INTO calls (
  id, "tenantId", "campaignId", "toNumber", "callSid", status, direction,
  duration, "createdAt", "updatedAt", "startedAt", "answeredAt", "endedAt",
  "callCompleteTimestamp", "callConnectedTimestamp",
  "publisherId", "buyerId", "campaignName", "publisherName", "buyerName",
  "callerId", "callerIdAreaCode", "callerIdState", did, "targetNumber",
  "connectedDuration", "durationFormatted", "connectedDurationFormatted",
  revenue, payout, profit, billable, "billableDurationThreshold",
  "publisherPayoutAmount", "buyerBillableAmount", "billingCalculatedAt",
  "buyerChargeStatus", "buyerChargedAt", "publisherPayoutStatus", "publisherPayableAt",
  "disputeStatus", converted, "missedCall",
  "answeredByUserId", disposition, "callSource"
)
SELECT
  c.id, c.tenant_id, c.campaign_id, c.did, c.call_sid,
  (CASE WHEN c.outcome = 'NONE' THEN 'NO_ANSWER' ELSE 'COMPLETED' END)::"CallStatus",
  'INBOUND'::"CallDirection",
  c.ring + c.connected, c.started, now(), c.started, c.answered, c.ended,
  c.ended, c.answered,
  c.publisher_id, c.buyer_id, c.campaign_name, c.publisher_name, c.buyer_name,
  c.caller_id, c.area_code, c.state_code, c.did, c.buyer_destination,
  c.connected,
  to_char((c.ring + c.connected) * interval '1 second', 'HH24:MI:SS'),
  to_char(c.connected * interval '1 second', 'HH24:MI:SS'),
  -- Money: billable buyer calls carry it; other buyer calls carry zero; the
  -- agency's own calls and unanswered calls carry none.
  CASE WHEN c.is_billable THEN c.buyer_price WHEN c.outcome = 'BUYER' THEN 0 END,
  CASE WHEN c.is_billable THEN c.campaign_payout WHEN c.outcome = 'BUYER' THEN 0 END,
  CASE WHEN c.is_billable THEN c.buyer_price - c.campaign_payout WHEN c.outcome = 'BUYER' THEN 0 END,
  c.is_billable,
  CASE WHEN c.outcome = 'BUYER' THEN 120 END,
  CASE WHEN c.is_billable THEN c.campaign_payout WHEN c.outcome = 'BUYER' THEN 0 END,
  CASE WHEN c.is_billable THEN c.buyer_price WHEN c.outcome = 'BUYER' THEN 0 END,
  CASE WHEN c.outcome = 'BUYER' THEN c.ended END,
  CASE WHEN c.is_billable THEN 'CHARGED' END,
  CASE WHEN c.is_billable THEN c.ended END,
  CASE
    WHEN c.is_disputed THEN 'HELD'
    WHEN c.is_billable THEN 'PAYABLE'
    WHEN c.outcome = 'BUYER' THEN 'NOT_PAYABLE'
  END,
  CASE WHEN c.is_billable THEN c.ended END,
  CASE WHEN c.is_disputed THEN 'OPEN' END,
  c.has_application,
  c.outcome = 'NONE',
  c.agent_id,
  CASE
    WHEN c.outcome = 'NONE' THEN 'NO_ANSWER'
    WHEN c.has_application THEN 'SALE'
    WHEN c.r_disposition < 0.40 THEN 'NOT_INTERESTED'
    WHEN c.r_disposition < 0.65 THEN 'FOLLOW_UP'
    WHEN c.r_disposition < 0.85 THEN 'NOT_QUALIFIED'
    ELSE 'SET_CALLBACK'
  END,
  CASE WHEN c.outcome = 'AGENT' THEN 'SOFTPHONE' END
FROM llp_call c
ORDER BY c.seq;

-- In flight: three Final Expense calls on PUB1, still connected.
INSERT INTO calls (
  id, "tenantId", "campaignId", "toNumber", "callSid", status, direction,
  "createdAt", "updatedAt", "startedAt", "answeredAt", "callConnectedTimestamp",
  "publisherId", "buyerId", "campaignName", "publisherName", "buyerName",
  "callerId", "callerIdAreaCode", "callerIdState", did, "targetNumber",
  billable, "billableDurationThreshold", "answeredByUserId", "callSource"
)
SELECT
  gen_random_uuid()::text, (SELECT id FROM llp), c.id, c.did, 'LLPDEMO-' || gen_random_uuid()::text,
  'ANSWERED'::"CallStatus", 'INBOUND'::"CallDirection",
  f.started, now(), f.started, f.started + interval '10 seconds', f.started + interval '10 seconds',
  pub.id, b.id, c.name, pub.name, b.name,
  '+1' || a.area_code || '555' || lpad((100 + floor(f.r_line * 100))::int::text, 4, '0'),
  a.area_code, a.state_code, c.did, b.destination,
  false, CASE WHEN b.id IS NOT NULL THEN 120 END,
  u.id, CASE WHEN u.id IS NOT NULL THEN 'SOFTPHONE' END
FROM (
  SELECT
    v.ord, now() - v.ago AS started, v.agent_email, v.buyer_code,
    random() AS r_area, random() AS r_line
  FROM (VALUES
    (1, interval '2 minutes', 'marcus.bell@demo.lifeleadsplus.test',  NULL),
    (2, interval '5 minutes', 'keisha.grant@demo.lifeleadsplus.test', NULL),
    (3, interval '9 minutes', NULL,                                   'LLPDEMOBUY1')
  ) AS v(ord, ago, agent_email, buyer_code)
  ORDER BY v.ord
) f
JOIN llp_campaign c ON c.campaign_key = 'FE'
JOIN llp_pub pub ON pub.code = 'LLPDEMOPUB1'
JOIN llp_area a ON a.idx = 1 + floor(f.r_area * 20)::int
LEFT JOIN llp_person u ON u.email = f.agent_email
LEFT JOIN llp_buyer b ON b.code = f.buyer_code
ORDER BY f.ord;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7 & 9c. Submitted applications
--
-- Agent-answered Final Expense calls of 480s or more, at the agent's tier
-- probability (A 0.22, B 0.15, C 0.10, D 0.06; child agents 0.13).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO insurance_carrier_applications (
  id, "tenantId", "callId", "callAttribution",
  carrier, product, "planType", "monthlyPremium", "faceAmount", status,
  "firstName", "lastName", state, phone, age,
  "submittedAt", source, "paymentMode", "annualizedPremium", "modalPremium",
  "clientRequestId", "voidedAt", "createdAt", "updatedAt", "createdById"
)
SELECT
  gen_random_uuid()::text, c.tenant_id, c.id, 'CLIENT'::"CallAttribution",
  CASE
    WHEN c.r_carrier < 0.30 THEN 'Mutual of Omaha'
    WHEN c.r_carrier < 0.55 THEN 'Aetna'
    WHEN c.r_carrier < 0.75 THEN 'Americo'
    WHEN c.r_carrier < 0.90 THEN 'Corebridge'
    ELSE 'Transamerica'
  END,
  '',
  CASE WHEN c.r_plan < 0.70 THEN 'Level' WHEN c.r_plan < 0.90 THEN 'Graded' ELSE 'ROP' END,
  m.premium,
  (ARRAY[10000, 12500, 15000, 20000, 25000])[1 + floor(c.r_face * 5)::int],
  'SUBMITTED',
  (ARRAY['Dorothy','Harold','Linda','James','Barbara','Robert','Shirley','Gerald',
         'Patricia','Walter','Carol','Donald','Betty','Raymond'])[1 + floor(c.r_first * 14)::int],
  (ARRAY['Whitfield','Crawford','Pruitt','Hensley','Gaines','Mayfield','Tolbert',
         'Sutton','Brewer','Holloway','Pickett','Rowland'])[1 + floor(c.r_last * 12)::int],
  CASE c.state_code
    WHEN 'AL' THEN 'Alabama'   WHEN 'AR' THEN 'Arkansas' WHEN 'MS' THEN 'Mississippi'
    WHEN 'TN' THEN 'Tennessee' WHEN 'FL' THEN 'Florida'  WHEN 'LA' THEN 'Louisiana'
  END,
  substr(c.caller_id, 3),
  55 + floor(c.r_age * 30)::int,
  c.submitted, 'AGENT_ENTRY', 'MONTHLY', m.premium * 12, m.premium,
  'llp-demo-' || c.id, NULL, c.submitted, now(), c.agent_id
FROM llp_call c
CROSS JOIN LATERAL (SELECT round((38 + c.r_premium * 80)::numeric, 2) AS premium) m
WHERE c.has_application
ORDER BY c.seq;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Publisher payments: the weeks starting 28 and 21 days before this Monday
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_period ON COMMIT DROP AS
  SELECT
    w.monday,
    (w.monday + time '00:00') AT TIME ZONE 'America/New_York' AS period_from,
    ((w.monday + 6) + time '23:59:59.999') AT TIME ZONE 'America/New_York' AS period_to
  FROM llp_clock k
  CROSS JOIN LATERAL (VALUES
    (date_trunc('week', k.today)::date - 28),
    (date_trunc('week', k.today)::date - 21)
  ) AS w(monday);

CREATE TEMP TABLE llp_payment ON COMMIT DROP AS
  SELECT
    gen_random_uuid()::text AS id,
    p.id AS publisher_id, p.code, w.monday, w.period_from, w.period_to,
    w.period_to + interval '3 days' AS paid_at,
    COALESCE((
      SELECT sum(x."publisherPayoutAmount")
      FROM calls x
      WHERE x."tenantId" = (SELECT id FROM llp)
        AND x."callSid" LIKE 'LLPDEMO-%'
        AND x."publisherId" = p.id
        AND x."publisherPayoutStatus" = 'PAYABLE'
        AND x."disputeStatus" IS NULL
        AND x.billable
        AND x."createdAt" >= w.period_from
        AND x."createdAt" <= w.period_to
    ), 0) AS amount
  FROM llp_pub p
  CROSS JOIN llp_period w;

DELETE FROM llp_payment WHERE amount <= 0;

INSERT INTO publisher_payments (
  id, "tenantId", "publisherId", amount, "periodFrom", "periodTo",
  method, reference, "paidAt", "createdById", "createdAt"
)
SELECT
  y.id, (SELECT id FROM llp), y.publisher_id, round(y.amount, 2), y.period_from, y.period_to,
  'ACH', 'LLPDEMO-' || y.code || '-' || to_char(y.monday, 'YYYYMMDD'), y.paid_at,
  (SELECT id FROM llp_person WHERE email = 'renee.castillo@demo.lifeleadsplus.test'),
  y.paid_at
FROM llp_payment y
ORDER BY y.code, y.monday;

UPDATE calls x SET
  "publisherPayoutStatus" = 'PAID',
  "publisherPaidAt" = y.paid_at,
  "paidOut" = true,
  "updatedAt" = now()
FROM llp_payment y
WHERE x."tenantId" = (SELECT id FROM llp)
  AND x."callSid" LIKE 'LLPDEMO-%'
  AND x."publisherId" = y.publisher_id
  AND x."publisherPayoutStatus" = 'PAYABLE'
  AND x."disputeStatus" IS NULL
  AND x.billable
  AND x."createdAt" >= y.period_from
  AND x."createdAt" <= y.period_to;

COMMIT;
