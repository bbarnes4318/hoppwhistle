# Carrier IP authorization

Every outbound trunk in this platform is terminated against, not registered to
(`register="false"` on each gateway in
`apps/freeswitch/conf/sip_profiles/external/`). The carrier therefore decides
whether to accept a call by looking at the **source IP of this host** — not at
a username, and not at anything in the gateway XML.

That makes carrier authorization a piece of infrastructure state that lives
outside the repository, and the one that a server migration silently breaks.

## Current production host

|               |                                 |
| ------------- | ------------------------------- |
| Public IP     | `178.156.223.97`                |
| Provider      | Hetzner                         |
| SIP signaling | UDP/TCP 5080 (external profile) |

The previous host was `45.32.213.201`. Documents written before the Hetzner
migration still name it; they carry a stale banner and are historical.

## What each carrier needs

| Carrier      | Authorization                                | Where                                      |
| ------------ | -------------------------------------------- | ------------------------------------------ |
| FracTEL      | Source IP on the STATIC device               | FracTEL portal, device `576613142989`      |
| Anveo Direct | Source IP **and** a tech prefix on each call | Anveo **Direct** portal → Configure Trunks |
| SignalWire   | SIP credentials (registers)                  | SignalWire Console → SIP credentials       |

Anveo Direct is a separate product and a separate account from the retail Anveo
service that `anveo-adapter.ts` uses for DID provisioning
(`https://www.anveo.com/api`). Holding retail DIDs does not give you a Direct
termination trunk; the retail API marks Direct-only features explicitly (see
`ANVEO.DIRECT.TRUNK.UPDATE` and the `TRUNK` call-forward type).

### Tech prefixes

An authorized IP is not sufficient on its own for a carrier that identifies the
trunk by a **tech prefix** — digits dialed ahead of the destination. Anveo
Direct does: the prefix is what selects which of your outbound trunks a call
belongs to, so an INVITE from an authorized IP without the prefix still matches
nothing and is refused.

The prefix lives on the gateway, in `carrier_gateways.techPrefix`, and is
prepended to whatever `numberFormat` produces:

```
techPrefix "012345" + NANP11  →  sofia/gateway/anveo/0123451XXXXXXXXXX
techPrefix null     + NANP11  →  sofia/gateway/fractel1/1XXXXXXXXXX
```

Delete the prefix in the carrier's portal and every call on that trunk stops
routing, so it is not a leftover to clean up. Change it there and it has to
change here too:

```
PATCH /api/v1/carrier-routing/gateways/:gatewayId  { "techPrefix": "012345" }
```

Digits only; send `""` to clear it for a carrier that does not use one.

## Recognizing an authorization failure

A carrier that does not recognize the source IP rejects the INVITE outright
rather than timing out. The rejection is fast and specific, so it is worth
reading rather than treating as a dead trunk:

```
SIP/2.0 404 Not Found ipp      # Anveo: no matching IP peer
SIP/2.0 403 Forbidden          # most carriers: IP not authorized
SIP/2.0 407 Proxy Auth Req'd   # carrier wants credentials, not an IP
```

FreeSWITCH surfaces the first of these as `UNALLOCATED_NUMBER`, which reads
like a bad destination and is not — the number is fine, the peer is not
recognized.

To see the raw response for a single carrier, with no softphone or dialplan in
the way:

```bash
dc() { docker compose --env-file .env -f infra/docker/docker-compose.dev.yml "$@"; }

dc exec freeswitch fs_cli -x "sofia status gateway anveo"
dc exec freeswitch fs_cli -x "sofia profile external siptrace on"
dc exec freeswitch fs_cli -x "originate {origination_caller_id_number=<a DID this carrier issued>,progress_timeout=10}sofia/gateway/anveo/1XXXXXXXXXX &echo"
dc logs freeswitch --tail 400 | grep -B3 -A12 "SIP/2.0 4"
dc exec freeswitch fs_cli -x "sofia profile external siptrace off"
```

`sofia status gateway <name>` also reports `CallsOUT` and `FailedCallsOUT`
since the last restart, which distinguishes "the carrier is refusing us" from
"nothing has ever reached this carrier".

## After moving the server

Re-authorizing every carrier is part of the migration, not a follow-up. A
waterfall hides this: calls keep completing on whichever carrier was
re-authorized, and the others fail silently at the bottom of the chain until
they are promoted. Check each trunk with the `originate` above before trusting
the settings UI.
