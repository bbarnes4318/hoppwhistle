# Vonage as a SIP carrier

Vonage is a downstream SIP carrier, in exactly the role FracTEL, BulkVS, Telnyx,
Anveo, SignalWire and Twilio play:

```
Browser SIP.js / worker originate
  → Hoppwhistle FreeSWITCH
  → carrier waterfall for the call type (Settings → Carrier Routing)
  → sofia/gateway/vonage/1XXXXXXXXXX   (when Vonage is selected)
  → PSTN
```

The browser never talks to Vonage, no Vonage Client SDK is involved, and no Vapi
component is in the path. Vonage is reached only because the carrier-routing
resolver (`packages/shared/src/carrier-routing`) resolves a `vonage` gateway.

**Dograh AI calls do not use this path.** Dograh dials from its own Asterisk
(`dograh-asterisk`) straight to a carrier trunk; they never reach FreeSWITCH, so
switching Vonage on in the `DOGRAH_AI` waterfall does not move them. (That
waterfall serves the FreeSWITCH `vapi` profile on 5070, which the host firewall
closes.) To send Dograh's AI calls over Vonage, add the `vonage` trunk to
Dograh's Asterisk: see `deploy/dograh/vonage-trunk/README.md`.

## What carries a Vonage call

| Piece | Where |
| --- | --- |
| Carrier, gateway (`vonage`, `NANP11`), steps on every waterfall (disabled) | `apps/api/prisma/sql/carrier-catalog.sql`, applied at API boot |
| SIP trunk | `apps/freeswitch/conf/sip_profiles/external/vonage.xml`, rendered by `apps/freeswitch/scripts/vonage-gateway.sh` |
| Waterfall resolution | API: `services/carrier-routing.ts`; worker: `services/carrier-routing.ts` (own Prisma client) |
| Per-leg health and attribution | `apps/freeswitch/scripts/carrier_leg_result.lua` → `GET /api/v1/freeswitch/carrier-result?mode=leg` |
| Number provisioning | `apps/api/src/services/provisioning/adapters/vonage-adapter.ts` |
| Inbound | Vonage SIP forwarding → FreeSWITCH `public` context → `inbound_route.lua` → `/api/v1/freeswitch/lookup` |
| Diagnostics | `pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <id>` |

## Vonage dashboard setup

1. **API credentials.** Dashboard → API settings: the API key and secret go in
   `VONAGE_API_KEY` / `VONAGE_API_SECRET` (API container).
2. **Outbound (termination).** Vonage Programmable SIP terminates at
   `sip.nexmo.com` (or the regional endpoint your account shows). Authenticate
   either way:
   - **IP allow-list:** authorise this host's public SIP IP for SIP in the
     dashboard, and leave `VONAGE_SIP_USERNAME`/`VONAGE_SIP_PASSWORD` unset.
   - **Digest:** set both `VONAGE_SIP_USERNAME` (API key) and
     `VONAGE_SIP_PASSWORD` (API secret) on the FreeSWITCH container.
   The destination is sent as `1XXXXXXXXXX` (no `+`); the caller ID must be a
   Vonage number on the account, which the `POOL` caller-ID strategy guarantees.
3. **Inbound.** Numbers forward by SIP to this platform's external profile
   (port 5080). With `VONAGE_NUMBER_ROUTING_MODE=sip` and
   `VONAGE_SIP_URI=sip:<your-freeswitch-host>:5080`, buying or re-configuring a
   number sets it to forward to `sip:<msisdn>@<your-freeswitch-host>:5080`, so
   the called number arrives as FreeSWITCH's `destination_number`. Numbers
   bought in the dashboard instead: set the same forwarding there, and make
   sure they are **not** linked to a Voice Application (an application link
   takes the call away from SIP forwarding).
4. **Firewall.** Allow Vonage's SIP signalling and RTP to reach UDP 5080 and
   the RTP range FreeSWITCH uses (16384–16484). `scripts/install-persistent-sip-firewall.sh`
   allows Vonage's ranges (216.147.0.0/18, 168.100.64.0/18) on 5080, and on 5062
   for the Dograh trunk.

## Configuration

API container:

| Variable | Purpose |
| --- | --- |
| `VONAGE_API_KEY`, `VONAGE_API_SECRET` | Numbers API |
| `VONAGE_NUMBER_ROUTING_MODE` | `sip` (default for this platform) or `application`. Never inferred from `VONAGE_APPLICATION_ID` |
| `VONAGE_SIP_URI` | `sip:<host>:5080` or `sip:{msisdn}@<host>:5080`; a fixed user part is refused |
| `VONAGE_APPLICATION_ID` | `application` mode only |
| `VONAGE_DEFAULT_COUNTRY` | Country fallback when releasing a number (default `US`) |
| `CARRIER_LEG_REPORTING` | Default on; `off` stops per-leg reports (API and worker) |

FreeSWITCH container: `VONAGE_SIP_PROXY` (default `sip.nexmo.com`),
`VONAGE_SIP_REALM` (default: the proxy), `VONAGE_SIP_USERNAME` and
`VONAGE_SIP_PASSWORD` (both or neither). The worker needs no Vonage variables.
Nothing Vonage-related is exposed to the web bundle.

Routing-mode rules, enforced at purchase/configure time and logged at API boot:

| `VONAGE_NUMBER_ROUTING_MODE` | `VONAGE_SIP_URI` | `VONAGE_APPLICATION_ID` | Result |
| --- | --- | --- | --- |
| `sip` | set | any | SIP into FreeSWITCH |
| `application` | any | set | Voice Application |
| unset | set | unset | SIP into FreeSWITCH |
| unset | set | set | refused (ambiguous) |
| unset | unset | set | refused (never attached implicitly) |

## Turning Vonage on

Every tenant already has Vonage on all six waterfalls, switched **off**. In
**Settings → Carrier Routing**:

1. In **Carriers**, check Vonage shows eligible caller-ID numbers. `0` means
   buy or import Vonage numbers (provider `vonage`) first. Leave attestation at
   "Carrier signs (no header)" unless your Vonage account asks for a
   `P-Attestation-Indicator`.
2. On each waterfall (Inbound, CC manual, CC power dialer, softphone,
   predictive, Dograh AI) independently: switch Vonage on, and use the arrows
   to make it primary or a fallback. Each waterfall is saved on its own; the
   "Now dialing" line shows the effective order.
3. Watch the gateway health line under Vonage: attempts, carrier faults, last
   fault, last connected, circuit state. "restore" clears a demotion.

## Behaviour worth knowing

- **Caller ID.** Vonage is `POOL` against `vonage` numbers: a call already
  presenting one of the tenant's ACTIVE, caller-ID-eligible Vonage numbers keeps
  it (an agent's own DID survives); otherwise one is rotated in for the Vonage
  leg only. The next carrier in the chain applies its own strategy. Another
  tenant's numbers are never candidates.
- **Formats.** Vonage legs dial `1XXXXXXXXXX`; Twilio/Telnyx/SignalWire `+1…`;
  Anveo `<prefix>1…`. One chain mixes them freely.
- **Failover.** Legs are tried strictly in sequence (`|`). A leg that sends no
  180/183 within 10 s (`progress_timeout`) is abandoned for the next carrier.
- **Health.** Each leg reports its own hangup cause. Carrier faults (auth
  refusal, 5xx, timeouts, network, no route, no progress, gateway not loaded)
  count; busy, no-answer and caller cancel never do. Five in a row demote the
  gateway to the back of every chain for 120 s, for that tenant only.
- **Attribution.** An answered leg writes `calls.metadata.carrier =
  { gateway, carrierCode, routeType }` on API-created calls. Inbound CDRs record
  `metadata.carrier.inboundProvider` (who delivered the DID) and the gateway of
  the answered forward leg.

## Verifying a deployment

```
pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <tenantId>
pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <tenantId> --check-numbers
pnpm --filter @hopwhistle/api vonage:diagnose -- --tenant <tenantId> --test-call 1NXXNXXXXXX --yes
```

It checks the gateway is loaded and pinging, every Vonage-enabled waterfall's
format and caller ID, the tenant's Vonage DIDs and their inbound routes, (with
`--check-numbers`) each number's forwarding at Vonage, recent calls attributed
to `vonage`, and (with `--test-call … --yes`) places one real call through the
`vonage` gateway only. It needs a real FreeSWITCH and credentials; CI never runs
it.

## Rollback

- **Stop sending traffic to Vonage:** switch it off on each waterfall, or set
  the carrier inactive in the Carriers section. Takes effect on the next call.
- **Stop per-leg reporting:** `CARRIER_LEG_REPORTING=off` on API and worker.
  The dialplan's whole-chain report still records total failures.
- **Code:** revert the release. No schema change was made; the only data
  written is `carrier_gateways` health counters and `calls.metadata.carrier`.
