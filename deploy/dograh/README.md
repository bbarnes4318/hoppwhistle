# Dograh state-matched outbound caller-ID — deploy kit

Everything in this directory targets the **self-hosted Dograh ("AI Voice") stack**
on the Hetzner box (`/opt/dograh`, containers `dograh-api-1` etc.), which places
Dograh AI outbound calls via Asterisk/ARI → FracTEL. It implements:

1. Import of the 264 state-tagged caller-ID DIDs into `telephony_phone_numbers`
   (Dograh's caller-ID rotation pool), tagged `extra_metadata.pool = "state_cid"`
   with `state`/`npa`.
2. State-matched caller-ID selection: a Dograh campaign call picks a caller ID
   whose area-code state matches the destination's area-code state.

The canonical inventory record also lives in the Hopwhistle DB (`phone_numbers` +
CallerIdPool "Dograh State Caller IDs") via
`apps/api/src/cli/dograh-callerid-import.ts` — run both imports.

## Files

| File                                  | Role                                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `areacode_state.py`                   | Canonical NPA→state map (generated from `apps/api/src/lib/geo.ts`) + US-E.164 normalization. Mounted as `api/services/campaign/areacode_state.py`.                                                   |
| `patches/rate_limiter.py`             | Full copy of `api/services/campaign/rate_limiter.py` with `acquire_from_number(..., allowed_numbers=)` subset support (atomic Lua filter).                                                           |
| `patches/campaign_call_dispatcher.py` | Full copy of the (already-patched) dispatcher from `/opt/dograh-patches` adding destination-state resolution, policy handling, fail-closed error, and per-run persistence of the selection decision. |
| `import_state_caller_ids.py`          | Idempotent, dry-run-first importer into `telephony_phone_numbers`.                                                                                                                                   |
| `pool_state_inventory.py`             | Ops report: pool by state, zero-inventory states, live in-use counts.                                                                                                                                |
| `tests/test_state_caller_id.py`       | Pure-python tests (also runnable in the container).                                                                                                                                                  |

## Related: inbound DID → workflow mapping

`inbound-dids/` is a separate kit that maps our FracTEL DIDs to an **inbound**
Dograh workflow. It writes the same `telephony_phone_numbers` table, so the two
interact: every active row for an (org, telephony config) is also an outbound
caller ID here. See `inbound-dids/README.md` → "Caller-ID pool collision" before
loading numbers with either importer.

## Policy model (kill-switchable, off by default)

Per campaign: `campaigns.orchestrator_metadata.state_cid_policy` = `off` | `prefer` | `strict`.
Global default when a campaign doesn't set it: env `DOGRAH_STATE_CID_POLICY` on the
`api` service (default `off`).

- `off` — original whole-pool random rotation (rollback state).
- `prefer` — same-state caller ID when the pool has one (with a 5s busy-wait
  cap), else any caller ID.
- `strict` — same-state only. When the pool has **no** number for the
  destination's state (or the destination is toll-free / invalid / non-US /
  unknown NPA), the call FAILS before carrier bridging with
  `NO_CALLER_ID_AVAILABLE_FOR_DESTINATION_STATE`; the queued run is marked
  failed and the reason (destination, state, campaign, org) is in the api logs.
  Same-state numbers all busy = transient: the run returns to the queue.

Every dispatched run persists on `workflow_runs.initial_context`:
`destination_state`, `destination_state_reason`, `caller_id_state`,
`state_cid_policy`, `caller_id_state_match`, plus the existing `caller_number`.

## Deploy (on the box)

```bash
# 1. Stage files
scp deploy/dograh/areacode_state.py deploy/dograh/patches/rate_limiter.py \
    deploy/dograh/patches/campaign_call_dispatcher.py \
    deploy/dograh/import_state_caller_ids.py deploy/dograh/pool_state_inventory.py \
    root@178.156.223.97:/opt/dograh-patches/
scp apps/api/data/dograh-state-caller-ids.csv root@178.156.223.97:/opt/dograh-patches/

# 2. Import numbers (dry-run first, then --apply) — no restart needed
docker exec dograh-api-1 python /patches/import_state_caller_ids.py \
    --csv /patches/dograh-state-caller-ids.csv --org-id 1 --tcid 1            # dry run
docker exec dograh-api-1 python /patches/import_state_caller_ids.py \
    --csv /patches/dograh-state-caller-ids.csv --org-id 1 --tcid 1 --apply

# 3. Mount the two patched modules + areacode_state in
#    /opt/dograh/docker-compose.override.yaml under services.api.volumes:
#      - /opt/dograh-patches/rate_limiter.py:/app/api/services/campaign/rate_limiter.py:ro
#      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/api/services/campaign/campaign_call_dispatcher.py:ro
#      - /opt/dograh-patches/areacode_state.py:/app/api/services/campaign/areacode_state.py:ro
#    (campaign_call_dispatcher was already mounted; the other two are new)
#    and set services.api.environment DOGRAH_STATE_CID_POLICY=strict (or prefer)

# 4. Restart api OUTSIDE campaign dialing hours if possible
cd /opt/dograh && docker compose up -d api
```

**Restart caveat (known):** restarting the api mid-campaign orphans concurrency
slots / caller-ID leases. Recovery: flush `concurrent_calls:*`,
`from_number_pool:1:1`, `workflow_slot_mapping:*`, `workflow_from_number_mapping:*`,
`ari:channel:*` in dograh-redis (with password), then wait out the orchestrator's
300s stuck-batch timer.

## Rollback

1. `DOGRAH_STATE_CID_POLICY=off` (or remove) in the override file, `docker compose up -d api` — selection reverts to whole-pool rotation even with mounts in place.
2. Full revert: remove the `rate_limiter.py` / `areacode_state.py` mounts and restore the previous `campaign_call_dispatcher.py` from `/opt/dograh-patches` backup (`*.bak-state-cid`).
3. Imported numbers are inert when policy is off; to remove them from rotation entirely: `update telephony_phone_numbers set is_active=false where extra_metadata->>'pool'='state_cid';` then `zrem` them from `from_number_pool:1:1` (or wait for pool re-init).

## Keeping the map in sync

`areacode_state.py`'s dict is generated from `apps/api/src/lib/geo.ts`. If geo.ts
changes, regenerate:

```bash
awk "/^export const AREA_CODE_TO_STATE/,/^};/" apps/api/src/lib/geo.ts \
  | grep -oE "'[0-9]{3}': '[A-Z]{2}'" \
  | sed "s/'\([0-9]*\)': '\([A-Z]*\)'/    \"\1\": \"\2\",/"
# paste into AREA_CODE_TO_STATE in areacode_state.py
```
