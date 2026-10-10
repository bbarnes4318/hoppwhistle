# AI callbacks → a Dograh agent

## The problem

The Dograh AI dials out from our FracTEL DIDs. When a lead misses that call and
dials the number back, FracTEL delivers the call to Hopwhistle's FreeSWITCH like
any other inbound call. It then rang whoever that DID was routed to, often a
person's phone.

## What this does

Callbacks to the AI's caller-ID numbers are answered by a Dograh agent instead
(for example agent 15, _Final Expense - Alex (Inbound Callback Live Transfer)_).
The call never leaves the server:

```
lead ─► FracTEL ─► FreeSWITCH ─► Dograh Asterisk ─► Dograh agent
                  (lookup says          (Stasis, the number's
                   "AI callback")        inbound agent answers)
```

- **Hopwhistle API**: `GET /api/v1/freeswitch/lookup` answers `aiAgentBridge`
  for a DID marked `phone_numbers.metadata.dograhCallback`, ahead of any other
  route the DID has. The litigator check still runs first. Setup marks exactly
  the numbers Dograh has the agent on, including numbers assigned to a person,
  so nothing is sent to Dograh that it would refuse.
  Code: `apps/api/src/services/dograh-callback-routing.ts`.
- **FreeSWITCH**: `inbound_route.lua` bridges those calls to Asterisk, keeping
  the lead's number as caller ID. No Hopwhistle CDR is written for them; Dograh
  logs and records the call as an inbound run.
- **Dograh**: the caller-ID numbers get the agent as `inbound_workflow_id`, and
  Asterisk gets an endpoint that accepts FreeSWITCH's calls and a
  `dograh-ai-callback` context that hands them to Dograh's Stasis app.

Loop guards: a call Dograh transferred to us (`X-Hopwhistle-Source:
dograh-transfer`, see `../direct-transfer`) is never sent back, nor is a call
whose caller ID is itself an AI caller ID (an AI transfer through FracTEL).

Off until `DOGRAH_CALLBACK_BRIDGE` is set in the API environment.

## Set up (on the server)

```bash
cd /opt/hopwhistle && git pull
./setup-ai-callbacks.sh 15            # dry run
./setup-ai-callbacks.sh 15 --apply
```

The dry run shows how many numbers the agent will answer, the Asterisk config
and the `DOGRAH_CALLBACK_BRIDGE` value. `--apply` writes them, rebuilds and
restarts the API, marks those numbers in Hopwhistle, and copies
`inbound_route.lua` into FreeSWITCH (the next call uses it; nothing is dropped).

Then call one of the AI's caller-ID numbers from your cell. The API log shows
`[FS-LOOKUP] AI callback: did=… → Dograh` and the call appears in Dograh as an
inbound run of agent 15.

### If it does not work

- **Still rings the old phone; no `AI callback` log line.** Check the setup
  output: `notInHopwhistle` numbers have no Hopwhistle record (calls to them are
  not routed at all yet).
- **`AI callback to Dograh failed` in the FreeSWITCH log.** Asterisk refused the
  call. `docker logs dograh-asterisk` names the reason. If Asterisk sees
  FreeSWITCH from an address other than `SIP_PUBLIC_IP`, add it:
  `python3 deploy/dograh/inbound-callback/install_inbound_callback.py --agent-id 15 --match <ip> --apply`.
- **Asterisk takes it, Dograh hangs up.** `docker logs dograh-api-1 | grep "Inbound call"`
  says why (no matching number, no agent, quota).
- **Numbers on another agent**: `setup-ai-callbacks.sh` moves them to the
  callback agent (`--replace`), so every caller-ID number goes to the one agent.
  Run the installer directly without `--replace` to leave them where they are.

Status: `python3 deploy/dograh/inbound-callback/install_inbound_callback.py --status`.

## Undo

```bash
./setup-ai-callbacks.sh 15 --rollback
```

Removes `DOGRAH_CALLBACK_BRIDGE` and restarts the API (callbacks go back to
their normal routes), then removes the Asterisk config and the agent from the
numbers.

## Tested

`deploy/dograh/tests/test_inbound_callback.py` (config generation, transport
discovery, agent assignment plan), `apps/api/src/services/__tests__/dograh-callback-routing.test.ts`
(which calls are AI callbacks) and `apps/api/src/__tests__/inbound-route-ai-callback.test.ts`
(the FreeSWITCH script, run in the Lua harness). Not yet tested against the
live Asterisk and Dograh: do the test call above before relying on it.
