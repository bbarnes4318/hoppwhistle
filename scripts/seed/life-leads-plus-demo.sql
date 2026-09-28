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
-- campaigns, the seven days before today and today so far of inbound calls
-- (every one of them ended), submitted applications on the agent-answered
-- calls, and a recorded publisher payment for the first three of those days. Two child agencies under it, each with an OWNER,
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
--   publisher_payments              reference LIKE 'LLPDEMO-%', or any row for a
--                                   seeded publisher: the clawbacks an accepted
--                                   return writes, and payments recorded in the
--                                   app against a demo publisher
--
-- ── Re-running ───────────────────────────────────────────────────────────────
--
-- One transaction. It deletes every marked row first, then inserts, so a second
-- run leaves exactly one copy. The draws come from setseed(0.4318), so the same
-- run on the same day gives the same shape; the window moves with the clock.
-- Every timestamp is relative to now() in America/New_York, so the demo is
-- always "today": run it again each morning, or before a demo.

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
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND ("reference" LIKE 'LLPDEMO-%'
       OR "publisherId" IN (SELECT id FROM publishers
                            WHERE "tenantId" IN (SELECT id FROM llp_scope)
                              AND code LIKE 'LLPDEMO%'));

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
-- The seven full calendar days before today in America/New_York, plus today
-- from 08:00 ET up to now. Every day runs 08:00-20:00 ET, weighted to the
-- working day: each hour's share of the day is its weight over 50 --
--
--   08:00 1   09:00 2   10:00-18:00 5 each   19:00 2
--
-- so nine calls in ten land between 10:00 and 19:00.
--
-- A day's total is its base volume times a factor between 0.85 and 1.15 drawn
-- from a hash of the tenant and the date, so re-running on the same day gives
-- every day the same total, and a day keeps its total as the window moves on.
--
--   Life Leads Plus   170 a weekday, 60 on Saturday, 40 on Sunday
--   Riverbend          45 a weekday, none on weekends
--   Magnolia           25 a weekday, none on weekends
--
-- Today is the same day total, cut off at now(): every hour already over in
-- full, and the current hour pro rata to the minute. Nothing is seeded before
-- 08:00 ET, so a run before then leaves today empty.
--
-- Today's slots stop two minutes short of now() and every call's length is
-- clipped to end before the script ran: no seeded call is left open, so
-- nothing seeded here reads as in progress.
-- ─────────────────────────────────────────────────────────────────────────────

-- "Now" is the server's clock, unless the session names another instant to
-- rehearse a demo at (or to screenshot one), e.g.
--
--   PGOPTIONS="-c llp.now=2026-09-28T14:30:00-04:00" psql ... -f life-leads-plus-demo.sql
CREATE TEMP TABLE llp_clock ON COMMIT DROP AS
  SELECT
    (c.run_at AT TIME ZONE 'America/New_York')::date AS today,
    c.run_at,
    c.run_at - interval '2 minutes' AS last_slot
  FROM (
    SELECT COALESCE(NULLIF(current_setting('llp.now', true), '')::timestamptz, now()) AS run_at
  ) c;

CREATE TEMP TABLE llp_hour_weight ON COMMIT DROP AS
  SELECT h AS hour,
         CASE WHEN h = 8 THEN 1 WHEN h IN (9, 19) THEN 2 ELSE 5 END AS weight
  FROM generate_series(8, 19) AS h;

CREATE TEMP TABLE llp_day ON COMMIT DROP AS
  SELECT
    r.tenant_key, r.tenant_order, d::date AS day,
    round(
      CASE
        WHEN extract(isodow FROM d) = 7 THEN r.sunday
        WHEN extract(isodow FROM d) = 6 THEN r.saturday
        ELSE r.weekday
      END
      * (0.85 + 0.30 * ((abs(hashtext(r.tenant_key || ':' || d::date::text)) % 1000) / 999.0))
    )::int AS total
  FROM llp_clock k
  CROSS JOIN generate_series((k.today - 7)::timestamp, k.today::timestamp, interval '1 day') AS d
  CROSS JOIN (VALUES
    ('llp',       1, 170, 60, 40),
    ('riverbend', 2,  45,  0,  0),
    ('magnolia',  3,  25,  0,  0)
  ) AS r(tenant_key, tenant_order, weekday, saturday, sunday);

-- One row per tenant, day and hour: the hour's window and its share of the day.
CREATE TEMP TABLE llp_window ON COMMIT DROP AS
  SELECT
    x.tenant_key, x.tenant_order, x.day, x.starts, x.ends,
    CASE
      WHEN x.ends <= x.starts THEN 0
      ELSE floor(
        x.total * x.weight / 50.0
        * extract(epoch FROM (x.ends - x.starts)) / 3600
        + 0.5
      )::int
    END AS calls
  FROM (
    SELECT
      d.tenant_key, d.tenant_order, d.day, d.total, w.weight,
      (d.day + make_time(w.hour, 0, 0)) AT TIME ZONE 'America/New_York' AS starts,
      least(
        (d.day + make_time(w.hour, 0, 0) + interval '1 hour') AT TIME ZONE 'America/New_York',
        k.last_slot
      ) AS ends
    FROM llp_day d
    CROSS JOIN llp_hour_weight w
    CROSS JOIN llp_clock k
  ) x;

-- One row per call. Past days come first and today last, so a second run a few
-- minutes later, whose today has a call more or less, draws the same numbers
-- for every earlier day.
CREATE TEMP TABLE llp_slot ON COMMIT DROP AS
  SELECT
    row_number() OVER (
      ORDER BY w.day = (SELECT today FROM llp_clock), w.tenant_order, w.day, w.starts, i
    ) AS seq,
    w.tenant_key, w.day, w.starts, w.ends, w.calls, i AS slot
  FROM llp_window w
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
  ),
  -- The newest billable calls of the last two days that ended at least an hour
  -- ago, so a fresh demo always has returns waiting on Today, and none of them
  -- was disputed before it ended.
  recent AS (
    SELECT
      b.*,
      row_number() OVER (
        ORDER BY (
          b.is_billable
          AND b.started >= (SELECT run_at FROM llp_clock) - interval '2 days'
          AND b.ended <= (SELECT run_at FROM llp_clock) - interval '1 hour'
        ) DESC,
        b.started DESC
      ) AS recent_rank,
      (
        b.is_billable
        AND b.started >= (SELECT run_at FROM llp_clock) - interval '2 days'
        AND b.ended <= (SELECT run_at FROM llp_clock) - interval '1 hour'
      ) AS is_recent_billable
    FROM billed b
  )
  SELECT
    gen_random_uuid()::text AS id,
    'LLPDEMO-' || gen_random_uuid()::text AS call_sid,
    b.*,
    (b.is_billable AND (b.r_dispute < 0.02 OR (b.is_recent_billable AND b.recent_rank <= 3)))
      AS is_disputed,
    (b.outcome = 'AGENT' AND b.campaign_key IS DISTINCT FROM 'MED'
       AND b.connected >= 480 AND b.r_app < b.app_probability) AS has_application,
    least(
      b.ended + (60 + floor(b.r_submit * 181)::int) * interval '1 second',
      (SELECT run_at FROM llp_clock)
    ) AS submitted
  FROM recent b;

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
  "disputeStatus", metadata, converted, "missedCall",
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
  -- A buyer's return waiting for a decision: 'DISPUTED' is what every screen
  -- reads as open (lib/dispute-status.ts), with the reason, when and who on
  -- the call's metadata, where POST /api/v1/calls/:callId/dispute puts them.
  CASE WHEN c.is_disputed THEN 'DISPUTED' END,
  CASE WHEN c.is_disputed THEN jsonb_build_object(
    'disputeReason', (ARRAY[
      'Caller already has coverage',
      'Duplicate caller within 30 days',
      'Caller outside the age range',
      'Caller hung up before the pitch',
      'Wrong number'
    ])[1 + ((row_number() OVER (PARTITION BY c.is_disputed ORDER BY c.seq) - 1) % 5)::int],
    'disputedAt', to_char((c.ended + interval '1 hour') AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'disputedBy', 'returns@demo.lifeleadsplus.test'
  ) END,
  c.has_application,
  c.outcome = 'NONE',
  c.agent_id,
  CASE
    WHEN c.outcome = 'NONE' THEN 'NO_ANSWER'
    WHEN c.has_application THEN 'APPLICATION_SUBMITTED'
    WHEN c.r_disposition < 0.40 THEN 'NOT_INTERESTED'
    WHEN c.r_disposition < 0.65 THEN 'FOLLOW_UP'
    WHEN c.r_disposition < 0.85 THEN 'NOT_QUALIFIED'
    ELSE 'SET_CALLBACK'
  END,
  CASE WHEN c.outcome = 'AGENT' THEN 'SOFTPHONE' END
FROM llp_call c
ORDER BY c.seq;

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
-- 8. Publisher payments: the first three days of the window, paid four days ago
--
-- One payment per publisher for days today-7 to today-5, recorded at 10:00 ET
-- four days ago. The four days after that are still owed, so Today and
-- Payouts always have something to pay.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE llp_period ON COMMIT DROP AS
  SELECT
    k.today - 7 AS first_day,
    ((k.today - 7) + time '00:00') AT TIME ZONE 'America/New_York' AS period_from,
    ((k.today - 5) + time '23:59:59.999') AT TIME ZONE 'America/New_York' AS period_to,
    ((k.today - 4) + time '10:00') AT TIME ZONE 'America/New_York' AS paid_on
  FROM llp_clock k;

CREATE TEMP TABLE llp_payment ON COMMIT DROP AS
  SELECT
    gen_random_uuid()::text AS id,
    p.id AS publisher_id, p.code, w.first_day, w.period_from, w.period_to,
    w.paid_on AS paid_at,
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
  'ACH', 'LLPDEMO-' || y.code || '-' || to_char(y.first_day, 'YYYYMMDD'), y.paid_at,
  (SELECT id FROM llp_person WHERE email = 'renee.castillo@demo.lifeleadsplus.test'),
  y.paid_at
FROM llp_payment y
ORDER BY y.code, y.first_day;

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
