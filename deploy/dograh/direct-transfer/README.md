# Dograh → Hopwhistle direct transfer (no FracTEL hop)

## What changes

Today the Dograh transfer tool's destination is `PJSIP/+1<DID>@fractel`. Asterisk
dials the campaign DID out through FracTEL, and FracTEL delivers the call back to
FreeSWITCH on this same host. That has three costs:

- **Carrier charges twice**: every transfer is billed outbound and inbound.
- **FracTEL dependency**: if FracTEL fails, every AI transfer fails with it.
- **Wrong number**: the call reaches Hopwhistle with Dograh's rotating outbound
  caller ID rather than the lead's own number. The litigator check, state
  routing, agent licence gating and CRM matching all key on that number.

After this change, Asterisk hands the call straight to FreeSWITCH on this host.
FreeSWITCH receives an ordinary inbound call to the same campaign DID, **from the
lead's number**, and runs the same campaign routing. Nothing in Hopwhistle
changes and nothing needs redeploying there.

```
before:  Dograh ─ Asterisk ─► FracTEL ─► FracTEL ─► FreeSWITCH (caller = Dograh's DID)
after:   Dograh ─ Asterisk ─────────────────────────► FreeSWITCH (caller = the lead)
```

## Rollout

On the server, from `/opt/hopwhistle` after pulling `main`.

**1. Dry run.** This prints the configuration it would add, and where. It changes nothing.

```bash
python3 deploy/dograh/direct-transfer/install_direct_transfer.py
```

It refuses to continue if `/etc/asterisk/pjsip.conf` or `extensions.conf` in
`dograh-asterisk` is not a file on the host, because a change made only inside
the container would be lost on restart. It addresses FreeSWITCH at
`SIP_PUBLIC_IP` (or `PUBLIC_IP`) from `/opt/hopwhistle/.env`, which is the address
FreeSWITCH already advertises. Override it with `--fs-host`. If Asterisk has more
than one PJSIP transport, add `--transport <name>`.

**2. Install.**

```bash
python3 deploy/dograh/direct-transfer/install_direct_transfer.py --apply
```

This writes a marked block into each file, keeping a `.bak-hopwhistle-direct-transfer`
copy of the original. It then runs `module reload res_pjsip.so` and
`dialplan reload`. Neither command touches calls in progress, and no container
restarts.

At the end it prints a status check. Look for **"FreeSWITCH answers OPTIONS on the
trunk: reachable."** Qualify runs every 30 seconds, so if it doesn't say reachable
yet, re-check with `--status`.

**3. Test one call without touching Dograh.** Replace the DID with a campaign DID
and the second number with a phone you have in hand:

```bash
docker exec dograh-asterisk asterisk -rx \
  "channel originate Local/+1<CAMPAIGN_DID>*+1<YOUR_CELL>@hopwhistle-transfer/n application Wait 60"
```

Hopwhistle routes this as a lead calling from `<YOUR_CELL>`: the campaign's
agents or buyers ring. In FreeSWITCH's log (`docker logs hopwhistle-freeswitch-dev`),
`[INBOUND-ROUTE] Inbound call:` should show your number, not a Dograh DID.

**4. Point Dograh at it.** In Dograh, open the workflow's **Transfer Call** tool and
set the destination to:

```
Local/{{transfer_destination}}*{{called_number}}@hopwhistle-transfer/n
```

- `transfer_destination` is the campaign DID. It is already set per campaign by
  the dispatcher patch in `deploy/dograh/patches`.
- `called_number` is the lead Dograh dialled.
- `/n` stops Asterisk optimising the Local channel away, so Dograh keeps
  tracking the transfer leg it originated.

Change one workflow first and place a real AI call to a phone you control. When
the transfer works, change the rest.

`transfer_destination` must be the bare DID (for example `+14233398241`). If a
campaign's value is a full dial string such as `PJSIP/+1…@fractel`, change it to
the bare number.

## What the agent sees

The call arrives at Hopwhistle from the lead's number, so routing, screening,
the call record and the CRM match all use the right person.

Agent phones still show the campaign DID. That comes from
`inbound_route.lua`, which stamps the DID on every leg because carriers reject a
forwarded caller ID on PSTN legs. Showing the lead's number on softphone legs of
these transfers is a separate FreeSWITCH change, and it needs a FreeSWITCH
rebuild. The transfers are marked `X-Hopwhistle-Source: dograh-transfer` so that
change can recognise them.

## Firewall

No change is needed. Asterisk and FreeSWITCH are on the same host, so this
traffic never arrives on `eth0`, which is the only interface the telephony
firewall filters. FracTEL stays the only public source allowed on 5062.

## Rollback

Put the Dograh transfer tool's destination back to its previous value. That
alone returns transfers to FracTEL. To also remove the Asterisk configuration:

```bash
python3 deploy/dograh/direct-transfer/install_direct_transfer.py --rollback --apply
```

## Tested

`deploy/dograh/tests/test_direct_transfer.py` covers config generation,
idempotent re-runs, rollback and mount discovery.

The generated configuration was also loaded into Asterisk 20 against a SIP
responder standing in for FreeSWITCH. Transfers arrived as
`INVITE sip:+1<DID>@…`, with the lead's number in From and P-Asserted-Identity
and the `X-Hopwhistle-Source` header, which matches the FreeSWITCH `public`
dialplan pattern. 10-digit numbers were normalised. A missing lead number was
logged and still dialled. A malformed DID was refused.
