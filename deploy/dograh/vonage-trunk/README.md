# Dograh AI outbound calls over Vonage

Dograh places AI calls from its own Asterisk (`dograh-asterisk`) through ARI. They
never pass through Hopwhistle's FreeSWITCH, so switching Vonage on for the
**Dograh AI Auto Dialer** waterfall in Settings → Carrier Routing does **not**
move them. (That waterfall serves the FreeSWITCH `vapi` profile on 5070, which
the host firewall closes.) Dograh calls change carrier only when Asterisk dials a
different trunk. This kit adds that trunk:

```
Dograh ─ARI─► dograh-asterisk ─PJSIP/1XXXXXXXXXX@vonage─► sip.nexmo.com ─► PSTN
```

| Piece | What it does |
| --- | --- |
| `install_vonage_trunk.py` | Adds a `vonage` PJSIP trunk to `dograh-asterisk`. It uses the SIP server and credentials from the FreeSWITCH container (`VONAGE_SIP_*`, written by `scripts/vonage-setup.ps1`). |
| `../ari-trunk` (V3) | `DOGRAH_ARI_TRUNK=vonage` sends Dograh's outbound calls to that trunk. `DOGRAH_ARI_DIAL_FORMAT=nanp11` dials `1XXXXXXXXXX`, because Vonage refuses a `+`. |
| `../anveo-trunk/set_caller_id_pool.py` | Leaves only your Vonage numbers active as Dograh caller IDs. Vonage rejects any caller ID that isn't on the account. |
| `scripts/install-persistent-sip-firewall.sh` | Lets Vonage reach FreeSWITCH on 5080 (inbound DIDs) and Asterisk on 5062 (the callee's BYE). |

## One command

On the server as root (the Hetzner Cloud web console works, no SSH key needed):

```bash
cd /opt/hopwhistle && git pull && python3 deploy/dograh/vonage-trunk/setup_vonage.py
```

`setup_vonage.py` asks for the Vonage API key and secret, checks them against
Vonage, and runs every step below. It stops, with Dograh untouched, if the test
call fails. It installs the ARI provider patch itself when it isn't mounted yet.
The caller IDs and the carrier then switch together, on one confirmation. If
Dograh doesn't come back up on Vonage, both are rolled back automatically. The rest of this
page is the same thing step by step.

## Before you start

- **Vonage settings on the host.** Run `scripts/vonage-setup.ps1` from your PC,
  or put the `VONAGE_*` lines in `/opt/hopwhistle/.env` and redeploy FreeSWITCH.
  `docker exec hopwhistle-freeswitch-dev printenv | grep VONAGE_SIP_` should list
  them.
- **Outbound auth at Vonage.** Use one of these:
  - authorise this host's public IP for SIP in the Vonage dashboard; or
  - set both `VONAGE_SIP_USERNAME` (API key) and `VONAGE_SIP_PASSWORD` (API
    secret). The setup script's default option does this.
- **Vonage numbers for caller ID.** You need at least one number you own on the
  Vonage account. Dograh's state-matched caller ID can only pick from these, so
  the more states they cover, the better.

## Run it (on the server, as root)

```bash
cd /opt/hopwhistle && git pull
```

**1. Trunk and one test call to your own cell.** Nothing in Dograh changes yet.

```bash
python3 deploy/dograh/vonage-trunk/install_vonage_trunk.py            # dry run: shows server and auth mode
python3 deploy/dograh/vonage-trunk/install_vonage_trunk.py --apply
python3 deploy/dograh/vonage-trunk/install_vonage_trunk.py --test-call YOURCELL --caller-id YOUR_VONAGE_NUMBER
sudo bash scripts/install-persistent-sip-firewall.sh
```

Your phone should ring from the Vonage number; answer and speak, and you should hear
yourself echoed back. If it
doesn't, run:
`docker logs --since 2m dograh-asterisk 2>&1 | grep -iE 'vonage|40[0-9]|50[0-9]'`.

- `401`/`407` that keeps repeating means bad credentials.
- `403` means the IP isn't authorised or the caller ID isn't on the account.
- `404`/`484` means a number-format problem.

**2. Caller IDs.** Find the ARI telephony configuration your campaigns use, then
make your Vonage numbers its only active caller IDs. Start with a dry run.
`--restore` reverses it.

```bash
docker cp deploy/dograh/anveo-trunk/set_caller_id_pool.py dograh-api-1:/tmp/
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --list-configs
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --tcid 1 \
  --pool-tag vonage --label "Vonage CID" --backup /tmp/vonage-pool-backup.json \
  --numbers +1XXXXXXXXXX +1XXXXXXXXXX
# add --apply, then keep the backup:
docker cp dograh-api-1:/tmp/vonage-pool-backup.json /root/vonage-pool-backup.json
```

Add `--campaign-id N` only if you also want that campaign slowed down. It drops
to 1 call/s and 3 concurrent calls, and same-state caller ID is turned off. Do
that when you have only a few Vonage numbers.

**3. Point Dograh at Vonage.** Patch the ARI provider as described in
`deploy/dograh/ari-trunk/README.md`. If it's already patched, re-run the patcher
on the staged file and it upgrades to V3 in place. Then, under every Dograh API
service in `/opt/dograh/docker-compose.override.yaml`:

```yaml
    environment:
      DOGRAH_ARI_TRUNK: vonage
      DOGRAH_ARI_DIAL_FORMAT: nanp11
      DOGRAH_ARI_TRANSFER_TRUNK: fractel   # transfers stay off Vonage
      # remove DOGRAH_ARI_DIAL_PREFIX if it is set (Anveo only)
```

```bash
cd /opt/dograh && docker compose config >/dev/null && docker compose up -d --no-deps api
docker exec dograh-api-1 grep -c HOPWHISTLE_ARI_DIAL_FORMAT_V3 /app/api/services/telephony/providers/ari/provider.py   # 1
```

Restart outside dialing hours if you can (see the restart caveat in
`deploy/dograh/README.md`). Run one campaign call and watch it:
`docker logs -f dograh-asterisk 2>&1 | grep -i vonage`.

If transfers already use direct transfer (`Local/...@hopwhistle-transfer`),
they are dialled as written and `DOGRAH_ARI_TRANSFER_TRUNK` doesn't matter.

## Rollback

```bash
# Dograh back to FracTEL: set DOGRAH_ARI_TRUNK: fractel, remove DOGRAH_ARI_DIAL_FORMAT, then
cd /opt/dograh && docker compose up -d --no-deps api
# caller IDs back
docker cp /root/vonage-pool-backup.json dograh-api-1:/tmp/vonage-pool-backup.json
docker exec dograh-api-1 python /tmp/set_caller_id_pool.py --restore /tmp/vonage-pool-backup.json --apply
# remove the trunk (optional)
python3 deploy/dograh/vonage-trunk/install_vonage_trunk.py --rollback --apply
```

## Tested

`deploy/dograh/tests/test_vonage_trunk.py` covers config generation, the
both-or-neither credential rule, redaction and the test-call dial string.
`deploy/dograh/tests/test_ari_trunk_patch.py` covers `DOGRAH_ARI_DIAL_FORMAT`.
It applies only to outbound US numbers and never to transfers. A prefix takes
precedence over it, and a V2 file is upgraded in place. None of this has been
run against the live Asterisk or Vonage yet, which is why each step starts with
a dry run or a test call.
