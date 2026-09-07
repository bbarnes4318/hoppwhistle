# Anveo numbers and the Numbers page

## Why Anveo DIDs were missing

The Numbers page (`/numbers`) renders exactly one source: `GET /api/v1/numbers`,
which reads the `phone_numbers` table for the acting tenant. Nothing on that page
talks to a carrier.

A row only ever reached `phone_numbers` three ways:

| Path                                                 | Writes `phone_numbers`?  |
| ---------------------------------------------------- | ------------------------ |
| `POST /api/v1/anveo/purchase` (in-app buy)           | yes, `provider: 'anveo'` |
| `POST /api/v1/numbers` (provisioning service)        | yes                      |
| `prisma/seed.ts`, `seed-bulkvs.ts`, `numbers:import` | yes                      |

The account's seven Anveo DIDs were bought in the Anveo portal, not through any
of those. They are live — they forward to FreeSWITCH on the `hopwhistle[sip]`
trunk and appear throughout the dialplan and docs — but no code ever wrote them
to our database, so the page had nothing to show. The BulkVS DIDs, by contrast,
show up because `prisma/seed-bulkvs.ts` inserted them directly.

`AnveoDIDService.listDids()` (the `DID.LIST` action) had been implemented since
the service was written and was called from nowhere.

## The fix: inventory sync

`syncAnveoNumbers()` (`apps/api/src/services/provisioning/anveo-sync.ts`) reads
Anveo's own inventory and reconciles it into `phone_numbers`.

From the UI: **Numbers → Sync Anveo** (ADMIN/OWNER).

From the API:

```bash
curl -X POST https://<host>/api/v1/anveo/sync \
  -H "Authorization: Bearer <token>"
```

From a shell with database and Anveo credentials:

```bash
pnpm --filter @hopwhistle/api numbers:sync:anveo --tenant=<tenantId>
```

Requires `ANVEO_API_KEY`, `ANVEO_EMAIL` and `ANVEO_SECURE_PHRASE`. Without them
the service cannot sign a request and the sync returns `ANVEO_SYNC_FAILED`.

### What the sync does and does not own

Anveo knows which DIDs exist on the account, what they cost, and where they
forward. It knows nothing about which campaign or agent a number serves, or
whether someone parked it deliberately. So:

- **New number** → created with `provider: 'anveo'`, `importSource:
'anveo-sync'`, the Anveo metadata, and the Anveo carrier link when one exists.
- **Existing number** → only provenance is corrected (`provider`, `carrierId`,
  metadata). `status`, `campaignId`, `userId` and pool membership are local
  decisions and are left alone.

The sync never creates a `Carrier` row. A carrier is a routing participant in
the caller-ID waterfall, and inventing one as a side effect of an inventory
import would add an unconfigured leg to it.

## Grouping by carrier

The Numbers page groups by carrier. The group is the linked `Carrier.name` when
the number has one, and falls back to `phone_numbers.provider` otherwise — so
freshly synced Anveo DIDs land under "Anveo Direct" even before a carrier exists
for them.

To have them group under a real carrier instead, give the tenant a `Carrier` row
with `numberProvider = 'anveo'` (the `20260816010000_add_per_carrier_caller_id`
migration already sets that for any carrier whose `code` is `ANVEO`). Re-running
the sync then links the numbers to it.

`GET /api/v1/numbers` returns both `carrier` and `provider` for this reason, and
accepts `?limit=` up to 500 — its former fixed page of 20 could hide an entire
carrier's inventory below the fold.
