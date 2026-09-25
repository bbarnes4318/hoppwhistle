# Dograh AI outbound calls over Anveo

This sends Dograh's AI calls out through Anveo Direct, the same carrier
Hopwhistle's FreeSWITCH uses. It uses only our Anveo DIDs as caller IDs and
places calls slowly.

Anveo has two requirements:

- **Tech prefix.** Anveo picks the outbound trunk from a prefix in front of the
  number: `012345` + `1` + 10 digits. Without the prefix, the call is refused as
  `UNALLOCATED_NUMBER`.
- **Caller ID.** The caller ID must be one of our Anveo numbers:
  +1 865-280-9894, -9893 and -9892.

There are three parts:

| Piece | What it does |
| --- | --- |
| `install_anveo_trunk.py` | Adds an `anveo` PJSIP trunk to `dograh-asterisk`. It uses the SIP server and credentials from the FreeSWITCH container. |
| `../ari-trunk` (V2) | `DOGRAH_ARI_TRUNK=anveo` sends Dograh's outbound calls to that trunk. `DOGRAH_ARI_DIAL_PREFIX=012345` adds the prefix. Transfers never get the prefix. |
| `set_caller_id_pool.py` | Leaves the 3 Anveo numbers as the only active caller IDs on the Dograh telephony configuration. It can also slow a campaign down: 1 call/s, 3 at once, same-state caller ID off. It saves a backup so this can be undone. |

`DOGRAH_ARI_TRUNK` applies to every call Dograh places through Asterisk (ARI).
Campaigns on a different Dograh telephony provider, such as Telnyx, don't go
through Asterisk and aren't affected.

## Run it (on the server, as root)

Get these files onto the server's checkout. Only `deploy/dograh` changes.

```bash
cd /opt/hopwhistle
git fetch origin claude/friendly-lamport-ocz4ok
git checkout origin/claude/friendly-lamport-ocz4ok -- deploy/dograh
```

**1. Trunk, then one test call to your own cell.** Nothing in Dograh changes yet.

```bash
python3 deploy/dograh/anveo-trunk/install_anveo_trunk.py            # dry run: shows the Anveo server it found
python3 deploy/dograh/anveo-trunk/install_anveo_trunk.py --apply
python3 deploy/dograh/anveo-trunk/install_anveo_trunk.py --test-call YOURCELL --caller-id 8652809894
```

Your phone should ring from 865-280-9894 and play a short recording. If it
doesn't, run:
`docker logs --since 2m dograh-asterisk 2>&1 | grep -iE 'anveo|40[0-9]|50[0-9]'`.

**2. Caller IDs and pacing.** Start with a dry run. It shows how many caller IDs
would be turned off, and the campaign's current and new settings.

```bash
docker cp deploy/dograh/anveo-trunk/set_caller_id_pool.py dograh-api-1:/tmp/
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid 1 --campaign-id CAMPAIGN_ID
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid 1 --campaign-id CAMPAIGN_ID --apply
docker cp dograh-api-1:/tmp/anveo-pool-backup.json /root/anveo-pool-backup.json   # keep this
```

Defaults are `--rate 1` (at most one new call per second) and
`--max-concurrency 3` (one live call per caller ID). Lower or raise them as
needed.

**3. Point Dograh at Anveo.** Patch the ARI provider as described in
`deploy/dograh/ari-trunk/README.md`. If it's already patched, re-run the patcher
on the staged file; it upgrades the patch in place. Then set these under the
Dograh API services in `/opt/dograh/docker-compose.override.yaml`:

```yaml
    environment:
      DOGRAH_ARI_TRUNK: anveo
      DOGRAH_ARI_DIAL_PREFIX: "012345"
```

```bash
cd /opt/dograh && docker compose config >/dev/null && docker compose up -d --no-deps api
docker exec dograh-api-1 grep -c HOPWHISTLE_ARI_DIAL_PREFIX_V2 /app/api/services/telephony/providers/ari/provider.py   # 1
```

Run one campaign call and watch it:
`docker logs -f dograh-asterisk 2>&1 | grep -i anveo`.

## Telnyx caller IDs

The same script sets the caller IDs for Dograh's Telnyx telephony
configuration. Find that configuration's id first. This lists every
configuration, never its credentials:

```bash
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --list-configs
```

Then run it with that id (`TELNYX_ID` below), as a dry run first:

```bash
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid TELNYX_ID \
  --pool-tag telnyx --label "Telnyx CID" --backup /tmp/telnyx-pool-backup.json \
  --numbers +19592222235 +19792325093 +19362766091 +18395009524 +18395009511 \
            +18283889161 +18283761225 +17275584088 +16563338182 +16083966390 +16083966279
```

Add `--apply` to write it, then run
`docker cp dograh-api-1:/tmp/telnyx-pool-backup.json /root/`. Leave out
`--campaign-id` unless you also want that campaign slowed to 1/s with 3 calls at
once.

## Rollback

```bash
# Dograh back to its previous trunk: set DOGRAH_ARI_TRUNK back (fractel), remove DOGRAH_ARI_DIAL_PREFIX, then
cd /opt/dograh && docker compose up -d --no-deps api
# caller IDs and campaign settings back
docker cp /root/anveo-pool-backup.json dograh-api-1:/tmp/anveo-pool-backup.json
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --restore /tmp/anveo-pool-backup.json --apply
# remove the trunk (optional)
python3 deploy/dograh/anveo-trunk/install_anveo_trunk.py --rollback --apply
```

## Tested

`deploy/dograh/tests/test_anveo_trunk.py` covers config generation,
credential redaction, the test-call dial string and number parsing.
`deploy/dograh/tests/test_ari_trunk_patch.py` covers the prefix: it applies only
to outbound US numbers, never to transfers, and an existing V1 patch is upgraded
in place. None of this has been run against the live Asterisk or Dograh
database yet, which is why each step starts with a dry run.
