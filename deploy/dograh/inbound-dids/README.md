# FracTEL inbound DIDs → Dograh inbound workflow — deploy kit

Maps our 2777 FracTEL DIDs to the existing Dograh workflow

> `Final Expense Outbound Calls with goal of Live Transfers to licensed agents - outbound`

so inbound calls are answered by a voice agent instead of hung up.

This is **purely a Dograh-side database mapping** plus one dialplan change. It does
not buy, order, or provision numbers (we already own every DID here), touches
nothing in the FracTEL portal, and involves no SIP registration — the `fractel`
trunk is IP-authenticated via `pjsip identify`.

Target: `hopwhistle-prod-ash` / `178.156.223.97`, containers `dograh-asterisk`
and `dograh-api-1`. **Do not touch `167.235.206.206`** — that is the separate
hardened outbound-only SBC with ARI/Stasis deliberately noloaded.

## How inbound routing works

Asterisk sends every inbound number to the same `Stasis(dograh)`; Dograh picks
the agent from the dialed number (`api/services/telephony/ari_manager.py`):

1. `called_number = channel["dialplan"]["exten"]`
2. `find_active_phone_number_for_inbound(org_id, called_number, "ari")` matches on
   `telephony_phone_numbers.address_normalized`, `is_active = true`, config
   `provider = 'ari'`, and the row's `telephony_configuration_id` must equal the
   ARI connection's config id
3. `phone_row.inbound_workflow_id` selects the workflow
4. No matching row, or a row with no `inbound_workflow_id` → `_delete_channel()`

There is **no catch-all**. Every DID needs its own row.

## Files

| File | Role |
| --- | --- |
| `resolve_inbound_ids.py` | Read-only preflight: resolves the workflow id, the ARI telephony config id, current row counts, and the **shared-config check** below. Writes nothing. |
| `import_inbound_dids.py` | Idempotent, dry-run-first importer. Batch ordering, canary `--limit`, conflict handling, shared-config guard. |
| `extensions.conf.from-fractel` | Reference copy of the `[from-fractel]` context that must exist on the box. |
| `dograh-inbound-numbers.csv` | 2777 DIDs (`address,npa,batch`), already E.164. |
| `tests/test_inbound_dids.py` | Pure-python tests (no DB/Redis). Also validate the shipped CSV. |

```bash
python deploy/dograh/inbound-dids/tests/test_inbound_dids.py
```

## Two things to decide before loading anything

### 1. Caller-ID pool collision (blocking — verify on the box)

Dograh seeds the **outbound caller-ID rotation pool** from *every active row* in
`telephony_phone_numbers` for an (`organization_id`, `telephony_configuration_id`)
pair. There is no pool-tag filter anywhere in the selection path:

- `import_state_caller_ids.py` (docstring): *"Numbers become part of the Dograh
  from-number rotation pool automatically (the telephony factory loads all active
  numbers for the config on each campaign batch)."*
- `pool_state_inventory.py` counts `total_active_caller_ids` across **all** active
  rows; `extra_metadata.pool = "state_cid"` is read only for reporting, never for
  selection.
- `campaign_call_dispatcher.py` seeds the pool via
  `rate_limiter.initialize_from_number_pool(org, provider.from_numbers, tcid)`.

Inbound lookup requires `is_active = true`, so inbound rows **cannot** be hidden
from that pool by deactivating them. The two features collide on one flag.

So: **if the ARI config that answers inbound is also a config the campaigns dial
out on, loading 2777 inbound DIDs also adds 2777 outbound caller IDs.** That would

- dilute the state-matched caller-ID pool from 264 numbers to ~3041, wrecking the
  `prefer`/`strict` state-match rate, and
- start presenting the 1723 cold `book207-new` DIDs as outbound caller ID — numbers
  that are not warmed and are not in the SBC's `/opt/sbc/dids.csv` (still dated
  Aug 22).

`resolve_inbound_ids.py` reports this as `shared_config_check.verdict`:

- **CLEAR** — the ARI inbound config is not a campaign dialing config. No
  collision; proceed with the runbook as written.
- **COLLISION** — do not bulk-load yet. Options, best first:
  1. Give inbound its own `provider='ari'` telephony configuration and point the
     ARI connection at it. Pools are keyed per (org, config)
     (`_from_number_pool_key`), so a distinct config isolates inbound rows from
     outbound rotation completely. This is the clean fix.
  2. Load only the 1054 `live-since-aug22` numbers (already warmed and already in
     the outbound pool, so the caller-ID blast radius is far smaller) and hold the
     1723 `book207-new` until the SBC cutover.
  3. Accept the caller-ID impact explicitly and pass `--ack-shared-config`.

The importer refuses to apply more than `--canary-max` (default 1) rows into a
shared config without `--ack-shared-config`, so this cannot be tripped by accident.

### 2. The workflow is an outbound script (confirm intent)

The named workflow ends in **`- outbound`** and was authored as an outbound script.
Dograh does not validate direction — `_ensure_workflow_belongs_to_org` checks org
ownership only — so it will be accepted as `inbound_workflow_id` without error and
will **run its outbound opening turn on an inbound caller**. Someone returning our
missed call gets greeted as though we dialed them.

The mapping is mechanically correct either way; this is a script-content question.
Confirm this is intended, or supply an inbound-authored variant and re-run the
importer with `--workflow-id <new id>` (it will update the existing rows in place,
no delete needed).

## Runbook

Everything runs **in place**. Do not restart `dograh-asterisk` or `dograh-api-1` —
the Stasis app `dograh` is live and a restart drops the ARI websocket.

### Step 1 — preflight (read-only)

```bash
docker cp deploy/dograh/inbound-dids/. dograh-api-1:/tmp/inbound-dids/
docker exec dograh-api-1 python /tmp/inbound-dids/resolve_inbound_ids.py
```

Record `resolved_inbound_workflow_id`, `resolved_ari_config_id`,
`phone_number_counts_by_config`, and read `shared_config_check.verdict` before
going further.

### Step 2 — make the dialplan format-proof

Dograh's inbound lookup calls `normalize_telephony_address()` with **no country
hint**, so a bare 10-digit DNIS never matches:

```
+19138999080 -> +19138999080   MATCHES
 19138999080 -> +19138999080   MATCHES
  9138999080 -> +9138999080    DOES NOT MATCH   ("913" eaten as country code)
913-899-9080 -> +9138999080    DOES NOT MATCH
```

If FracTEL delivers DNIS as bare 10 digits, every call hangs up with "no matching
phone number" even when everything else is right. Fold every format to 11 digits
before Stasis sees it:

```bash
ssh root@178.156.223.97
cp /opt/dograh-asterisk/etc/extensions.conf \
   /opt/dograh-asterisk/etc/extensions.conf.bak-inbound-dids
# replace the [from-fractel] context with extensions.conf.from-fractel
docker exec dograh-asterisk asterisk -rx "dialplan reload"
docker exec dograh-asterisk asterisk -rx "dialplan show from-fractel"
```

Expect all three patterns (`_NXXNXXXXXX`, `_1NXXNXXXXXX`, `_+X.`) in the output.

### Step 3 — canary: one number, end to end

```bash
docker exec dograh-api-1 python /tmp/inbound-dids/import_inbound_dids.py \
    --csv /tmp/inbound-dids/dograh-inbound-numbers.csv \
    --org-id 1 --tcid <ARI_CONFIG_ID> --workflow-id <WORKFLOW_ID> \
    --batch live-since-aug22 --limit 1            # dry run, prints the plan
```

Re-run with `--apply` once the plan looks right. `--batch live-since-aug22`
matters: only those 1054 carry outbound traffic today, so they are the only ones
that can actually generate a callback before the SBC pool cutover.

### Step 4 — verify with a real call

```bash
docker logs -f dograh-asterisk 2>&1 | grep -E "from-fractel|Stasis"
docker logs -f dograh-api-1    2>&1 | grep -i inbound
```

| What you see | What it means |
| --- | --- |
| nothing at all | FracTEL is not routing to `178.156.223.97:5062` — carrier-side, not ours |
| `from-fractel` NoOp but no StasisStart | dialplan / Stasis problem |
| `no matching phone number` in the api log | compare the printed `called_number` against the stored `address_normalized` — usually the 10-digit trap, i.e. step 2 did not take |
| StasisStart → workflow starts | working; proceed to step 5 |

### Step 5 — bulk load

Only after a test call is answered.

```bash
# live numbers first
docker exec dograh-api-1 python /tmp/inbound-dids/import_inbound_dids.py \
    --csv /tmp/inbound-dids/dograh-inbound-numbers.csv \
    --org-id 1 --tcid <ARI_CONFIG_ID> --workflow-id <WORKFLOW_ID> \
    --batch live-since-aug22 --apply

# then the not-yet-live book207 numbers (harmless, future-proofs the cutover)
docker exec dograh-api-1 python /tmp/inbound-dids/import_inbound_dids.py \
    --csv /tmp/inbound-dids/dograh-inbound-numbers.csv \
    --org-id 1 --tcid <ARI_CONFIG_ID> --workflow-id <WORKFLOW_ID> \
    --batch book207-new --apply
```

Add `--ack-shared-config` only if step 1 reported COLLISION and the caller-ID
impact has been accepted. Omit `--batch` to do all 2777 in one pass.

The importer is re-runnable: rows already correct are counted and skipped, rows
missing `inbound_workflow_id` are updated in place, and numbers owned by another
org or sitting under another telephony config are reported as conflicts rather
than retried (`(provider, account_id, address_normalized)` is globally unique).

## Why direct SQL rather than the REST endpoint

`POST /telephony-configs/{config_id}/phone-numbers` requires an authenticated
browser session, which does not exist inside the container, and offers no
idempotence or conflict reporting across 2777 calls. This kit follows the pattern
already established by `deploy/dograh/import_state_caller_ids.py`, which writes
the same table directly with asyncpg over `DATABASE_URL`.

`address_normalized` is normally computed server-side. Every address here is
already `+1` + 10 digits, for which normalization is the identity (verified live:
`+19138999080 -> +19138999080`), so `address` and `address_normalized` are written
identically — exactly what the state-CID importer does. The importer rejects
anything that is not US E.164 rather than coercing it, so a malformed row surfaces
instead of silently landing unmatched.

## Rollback

```sql
-- unmap inbound without touching caller-ID rotation
update telephony_phone_numbers set inbound_workflow_id = null
 where extra_metadata->>'inbound_pool' = 'fe_inbound';

-- full removal of rows this kit inserted (leaves pre-existing state_cid rows,
-- which never carried inbound_pool before this import, intact)
delete from telephony_phone_numbers
 where extra_metadata->>'inbound_pool' = 'fe_inbound'
   and extra_metadata->>'pool' is null;
```

The importer never overwrites an existing `extra_metadata.pool`, so a DID that was
already a `state_cid` outbound caller ID keeps that tag and stays in the state-CID
reporting and rollback path. Inbound membership is tracked separately under
`inbound_pool`.

Dialplan rollback: restore `extensions.conf.bak-inbound-dids` and
`docker exec dograh-asterisk asterisk -rx "dialplan reload"`.
