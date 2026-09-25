# Choose which trunk Dograh's ARI calls use

The deployed Dograh hardcodes `@fractel` in
`api/services/telephony/providers/ari/provider.py`: on line ~90 for outbound AI
calls and on line ~413 for transfers. It also passes a destination through
untouched only when it starts with `SIP/` or `PJSIP/`, so the direct-transfer
destination `Local/...@hopwhistle-transfer/n` broke.

`apply_ari_trunk_patch.py` patches a staged copy of that file. The approach is
the same as the other `/opt/dograh-patches` files: copy the file out of the
container, patch the copy, and bind-mount it back in. The patch does three
things:

- **Outbound AI calls** dial `@${DOGRAH_ARI_TRUNK}`. The default is `fractel`, so
  nothing changes until you set it.
- **Transfers** dial `@${DOGRAH_ARI_TRANSFER_TRUNK}`. The default is whatever
  `DOGRAH_ARI_TRUNK` is set to.
- **Any `Tech/...` destination**, including `Local/`, is dialled as written.
- **Optional number prefix (V2)**: `DOGRAH_ARI_DIAL_PREFIX` goes in front of
  outbound US numbers as `<prefix>1XXXXXXXXXX`. Anveo Direct needs this, see
  `deploy/dograh/anveo-trunk`. It's unset by default and never used on transfers.
  Running the patcher on a file with the first version upgrades it in place.

## Apply

```bash
set -euo pipefail
P=/opt/dograh-patches/ari-trunk
mkdir -p "$P"
docker cp dograh-api-1:/app/api/services/telephony/providers/ari/provider.py "$P/provider.py"
cp /opt/hopwhistle/deploy/dograh/ari-trunk/apply_ari_trunk_patch.py "$P/"
python3 "$P/apply_ari_trunk_patch.py" --provider-file "$P/provider.py"            # must say would_change
python3 "$P/apply_ari_trunk_patch.py" --provider-file "$P/provider.py" --apply    # writes provider.py.bak-ari-trunk
```

The patcher refuses with exit code 2 if the file isn't the version it expects,
and it never writes a file Python can't load.

In `/opt/dograh/docker-compose.override.yaml`, under **every service that runs
the Dograh API image** (`api`, and any campaign or worker service built from it;
`docker compose config | grep -B3 "dograh.*api"` lists them), add:

```yaml
    volumes:
      - /opt/dograh-patches/ari-trunk/provider.py:/app/api/services/telephony/providers/ari/provider.py:ro
    environment:
      DOGRAH_ARI_TRUNK: twilio             # or fractel to go back
      # DOGRAH_ARI_TRANSFER_TRUNK: fractel # only if transfers should stay on FracTEL
```

Then check the file and restart only those services:

```bash
cd /opt/dograh && docker compose config >/dev/null && docker compose up -d --no-deps api   # plus any worker services
docker exec dograh-api-1 grep -c HOPWHISTLE_ARI_TRUNK_V1 /app/api/services/telephony/providers/ari/provider.py   # 1
```

## Rollback

To send calls through FracTEL again, set `DOGRAH_ARI_TRUNK: fractel` and restart
the services. To remove the patch completely, delete the volume and environment
lines and restart.

## Tested

`deploy/dograh/tests/test_ari_trunk_patch.py` patches a stand-in with the
deployed lines and runs it. The tests cover:

- the default is unchanged (`@fractel`);
- `DOGRAH_ARI_TRUNK=twilio` moves outbound calls and transfers;
- a transfer override works;
- `Local/` is dialled as written;
- re-running is idempotent, the patcher refuses unrecognised code, and a backup
  is written.
