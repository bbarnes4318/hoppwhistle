# Rolling out per-agent SIP credentials

This change gives every agent their own SIP extension and their own SIP
password. Both used to be shared, and the sharing was not a limitation — it was
a cross-agency call-interception hole and a twenty-agent ceiling.

Read §5 before deploying. The migration must land **before** the API.

---

## 1. What was actually wrong

An agent's SIP identity lived in `users.metadata.extension`, allocated inline by
`GET /api/v1/agent/webrtc/credentials`: read every user row **in the agency**,
collect the extensions in use, take the first free number in `1000..1019`, write
it back. The password was `SIP_AGENT_PASSWORD` — one value, platform-wide,
matching `$${default_password}` in all twenty static directory files.

FreeSWITCH's directory is a single flat `default` domain with no tenant
dimension. Three consequences followed, and all three were live:

| # | Defect | What it looked like on the floor |
| - | ------ | -------------------------------- |
| 1 | The allocator scanned **per agency** against a **global** directory | Agency A's `1000` and Agency B's `1000` were the same SIP user. Whichever browser registered last received **both agencies' calls**. |
| 2 | One password authenticated every extension | Any agent could register as any extension on the platform, including another agency's, and take their calls. |
| 3 | The pool was twenty wide, with a silent fallback to `'1000'` | An agency's twenty-first agent took over the first agent's registration. No error, no log — just another agent's calls arriving. |

Defect 1 is the one that blocks the product outright: the model is "agencies add
their own agents", and past the first agency, every agent added collided with
somebody.

---

## 2. What replaces it

`agent_sip_credentials`, one row per agent:

- **`extension` is `UNIQUE` across the whole table**, not per `tenantId`. This is
  the fix for defect 1, and the scope is the point — the constraint has to hold
  where FreeSWITCH resolves the name, and FreeSWITCH resolves it globally. A
  unique index scoped to the agency would re-create the collision it exists to
  stop.
- **`passwordEncrypted` is per agent**, AES-256-GCM via `lib/field-encryption.ts`
  (the same envelope the carrier application's SSN and bank fields use). Fix for
  defect 2.
- **The range is `1000..1999`**, so 1000 identities rather than 20. Fix for
  defect 3. It is that range and not a wider one because `dialplan/default.xml`
  matches local extensions with `^(1[0-9]{3})$` and tests `${local_ext}` against
  `^\d{4}$` in two further places. **Widening past 1999 is a dialplan change
  first**, in all three expressions.

FreeSWITCH reads it through `mod_xml_curl`: the module was already loaded and
had no configuration, so `autoload_configs/xml_curl.conf.xml` now binds the
`directory` section to `POST /api/v1/freeswitch/directory`.

---

## 3. The static files still work, and that is deliberate

When the endpoint answers `<result status="not found"/>`, FreeSWITCH falls
through to the next binding for the section — the XML still on disk. So
`vapi.xml`, `demo-agent.xml` and every `1000..1019` file resolve exactly as
before.

That means **there is no cutover**. Agents move onto database credentials one at
a time, as each one's browser next fetches credentials. Deleting the static
files is a later step, once no registration depends on them.

It also means `SIP_AGENT_PASSWORD` is **still required** — `vars.xml` expands it
as `$${default_password}` for those files. Do not remove it from the
environment. It is simply no longer what a provisioned agent authenticates with.

---

## 4. What the migration does, and the collisions it resolves

Existing agents **keep their current extension where it is still free**. An
agent whose extension changes under them has a registered softphone pointing at
a name that no longer authenticates.

Where several agents across the platform hold the same extension — which defect
1 guarantees for every agency past the first — **the oldest user row keeps it**.
Everyone else gets no row and is allocated a free extension by the application
on their next credential fetch.

Backfilled rows are **reservations**: the extension is claimed so the allocator
cannot hand it to somebody else, and `passwordEncrypted` is `NULL`. There was no
per-agent secret to migrate from, and writing the shared one into every row
would have carried defect 2 across the migration. The secret is generated on the
agent's next fetch, keeping their extension.

**A reservation cannot authenticate.** `lookupDirectoryPrincipal` returns
not-found for it, because there is no password to check against — so an agent
who has not fetched credentials since the deploy is served by the static file
for their extension if one exists, and cannot register if it does not.

### What this means operationally

Every agent should open the app once after deploy. Until they do:

- an agent on `1000..1019` keeps working, on the static file and the old shared
  password;
- an agent **outside** that range (there are none today, but there will be after
  the range widens) cannot register until their first fetch.

---

## 5. Deploy order

The API reads a table the migration creates, so:

```bash
# 1. Migration FIRST.
psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260920000000_agent_sip_credentials/migration.sql

# 2. Then the API.

# 3. Then FreeSWITCH, to pick up xml_curl.conf.xml.
docker compose restart freeswitch     # or: fs_cli -x 'reload mod_xml_curl'
```

Deploying the API **ahead** of the migration is survivable but degraded, and the
degradation is deliberately bounded: `services/routing.ts` wraps the credential
read in its own `try`/`catch` so a missing table falls back to
`users.metadata.extension` — the behaviour from before this change — rather than
throwing into the enclosing handler, which fails **open** and would skip the
**licensed-state gate** for every call on the platform. Agents on the old path
keep taking calls; nobody is provisioned until the table exists.

`FREESWITCH_INTERNAL_KEY` must be set on both the API and FreeSWITCH before
step 3, as it already must be for the carrier-route lookup. Without it every
directory lookup is refused 401, and the only extensions that resolve are the
static ones.

---

## 6. Verifying it

```bash
# A directory lookup, as mod_xml_curl makes it. Expect the agent's own password.
curl -s -X POST "http://localhost:3001/api/v1/freeswitch/directory?k=$FREESWITCH_INTERNAL_KEY" \
  -d 'section=directory&key_value=1000&domain=YOUR_SIP_DOMAIN&action=sip_auth'

# Unauthenticated. Expect 401 — this endpoint hands out passwords.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:3001/api/v1/freeswitch/directory" \
  -d 'section=directory&key_value=1000&domain=YOUR_SIP_DOMAIN'

# An extension with no credential. Expect the not-found document, which is what
# sends FreeSWITCH to the static XML.
curl -s -X POST "http://localhost:3001/api/v1/freeswitch/directory?k=$FREESWITCH_INTERNAL_KEY" \
  -d 'section=directory&key_value=1998&domain=YOUR_SIP_DOMAIN&action=sip_auth'
```

```sql
-- No extension is held twice. This must return zero rows, forever; it is the
-- property the whole change exists to establish.
SELECT extension, COUNT(*) FROM agent_sip_credentials GROUP BY extension HAVING COUNT(*) > 1;

-- Who is still on a reservation (has not fetched credentials since the deploy).
SELECT u.email, c.extension
FROM agent_sip_credentials c JOIN users u ON u.id = c."userId"
WHERE c."passwordEncrypted" IS NULL;

-- Agents whose metadata disagrees with their credential. Expected, not a fault:
-- these are the reallocated collisions from §4. Routing believes the credential.
SELECT u.email, u.metadata->>'extension' AS stale, c.extension AS issued
FROM users u JOIN agent_sip_credentials c ON c."userId" = u.id
WHERE u.metadata->>'extension' IS DISTINCT FROM c.extension;
```

---

## 7. What this does NOT do

- **It does not give an agency a way to manage its own agents.** Adding an agent
  still means an invite whose activation token the owner hand-delivers, and
  routing an agent still means a `BuyerEndpoint` that only NetEnroll staff can
  create. `CampaignAgent` exists in the schema and is still referenced nowhere.
- **It does not per-tenant the SIP domain.** Extensions are globally unique,
  which makes the flat domain *safe*; it does not make it *scoped*. A per-tenant
  realm is the follow-up that would let two agencies both use extension `1000`.
- **It does not rotate anything on a schedule.** `rotatePassword` exists and
  nothing calls it. A rotation is not instant either: the agent's softphone
  keeps working on the old secret until its registration expires and it
  re-registers.
- **It does not withdraw the static directory files**, or
  `SIP_AGENT_PASSWORD`. See §3.
