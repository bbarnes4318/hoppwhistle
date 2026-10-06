# Dograh AI outbound calls over Vonage, beside FracTEL

Dograh places AI calls from its own Asterisk (`dograh-asterisk`) through ARI. They
never pass through Hopwhistle's FreeSWITCH, so switching Vonage on for the
**Dograh AI Auto Dialer** waterfall in Settings → Carrier Routing does **not**
move them. This kit sends a call over Vonage when its caller ID is one of your
Vonage numbers. Every other call goes out exactly as before:

```
caller ID is a Vonage number → PJSIP/1XXXXXXXXXX@vonage → sip.nexmo.com
any other caller ID          → unchanged (ARI_PJSIP_DEFAULT_TRUNK, e.g. fractel)
```

Each Dograh campaign uses one telephony configuration, and each configuration
has its own caller-ID pool. A separate **Vonage** configuration holds only the
Vonage numbers. A campaign on it dials over Vonage, while campaigns on the
FracTEL configuration keep their numbers and carrier, at the same time.

## One command

On the server as root:

```bash
cd /opt/hopwhistle && git pull origin main && python3 deploy/dograh/vonage-trunk/setup_vonage.py
```

It asks for the Vonage API key and secret, then:

1. Checks the key and secret against Vonage and lists the account's US numbers.
2. Writes the `VONAGE_*` settings into `/opt/hopwhistle/.env`. The backup goes in `/root`.
3. Adds the `vonage` trunk to Dograh's Asterisk and lets Vonage through the firewall.
4. Places a test call to your phone. Answer it and you hear yourself echoed back.
5. Prepares Dograh without touching running campaigns:
   - patches its ARI provider with `../ari-trunk/apply_caller_trunk_patch.py` and mounts it;
   - sets `DOGRAH_ARI_CALLER_TRUNKS` in the compose override;
   - creates the **Vonage** telephony configuration as a copy of the FracTEL one, holding only the Vonage numbers.
6. Restarts the Dograh API (after asking). This drops AI calls in progress, so pause campaigns first. If Dograh doesn't come back with the routing in place, the override is put back and it restarts again.
7. Moves the campaign you pick onto the Vonage configuration, with same-state caller ID off for it.

It's safe to run again, for example after you buy more Vonage numbers. It picks
them up and updates the routing.

Each AI call holds one caller ID until it hangs up. A Vonage campaign therefore
runs at most as many calls at once as you have Vonage numbers.

## Pieces

| File | Role |
| --- | --- |
| `setup_vonage.py` | The one command above. |
| `install_vonage_trunk.py` | The `vonage` PJSIP trunk, test call (`--test-call`), `--status`, `--rollback`. |
| `vonage_config.py` | Runs in `dograh-api-1`. Creates the Vonage configuration, moves numbers, and assigns or restores a campaign. |
| `../ari-trunk/apply_caller_trunk_patch.py` | Per-call trunk from the caller ID (`DOGRAH_ARI_CALLER_TRUNKS`). |
| `../anveo-trunk/set_caller_id_pool.py` | Loads the Vonage numbers into the Vonage configuration. |

## Rollback

```bash
# A campaign back to FracTEL (its previous configuration and settings):
docker exec dograh-api-1 python /tmp/vonage_config.py restore --backup /tmp/vonage-campaign-backup.json
# Caller-ID routing off: remove DOGRAH_ARI_CALLER_TRUNKS (and the provider.py mount) from
# /opt/dograh/docker-compose.override.yaml, then
cd /opt/dograh && docker compose up -d --no-deps api
# Remove the trunk (optional)
python3 /opt/hopwhistle/deploy/dograh/vonage-trunk/install_vonage_trunk.py --rollback --apply
```

## Tested

- `deploy/dograh/tests/test_caller_trunk_patch.py` runs the patch against a stand-in of the deployed `provider.py`. It checks that:
  - Vonage callers go to `@vonage` as `1XXXXXXXXXX`;
  - other callers and transfers are unchanged;
  - a malformed setting changes nothing;
  - the patch refuses other Dograh releases.
- `deploy/dograh/tests/test_vonage_setup.py` covers the override edit (map and list styles, reruns, valid YAML) and the configuration copy.
- `deploy/dograh/tests/test_vonage_trunk.py` covers the trunk.
- The trunk and the echo test call have been confirmed on production. The caller-ID routing has not been run on production yet.
