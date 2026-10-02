# Three-way calling: live FreeSWITCH check

Runs the softphone's real merge code (`FreeSwitchService.mergeCalls` in
`apps/api`) against the production FreeSWITCH image, with real SIP calls and
real audio. It checks what a unit test with a fake switch can't: that
FreeSWITCH does what the merge expects.

```sh
pnpm install                                  # once, at the repo root
apps/freeswitch/tests/three-way/run.sh        # builds the image, runs everything
apps/freeswitch/tests/three-way/run.sh inbound   # or: outbound | guard
```

Set `SKIP_BUILD=1 IMAGE=<tag>` to reuse an image you already built from
`apps/freeswitch/Dockerfile`. Needs Docker. Takes about a minute.

## What it sets up

There are two containers on a private network:

- **sw** is the switch under test. It runs the production image and config
  (`mod_conference`, the `hopwhistle-3way` profile, the Lua stack). Only
  `public.xml` is swapped for `sw-public.xml`, which mirrors the two ways a
  customer call reaches an agent:
  - `out-*` is shaped like `outbound-to-bulkvs`. The agent's leg runs the
    dialplan, records, and bridges out with `hangup_after_bridge=true`.
  - `in-lua` runs `rig_inbound.lua`, an excerpt of `inbound_route.lua`'s
    bridge and post-bridge logic, including the agent-leg rescue that calls
    `session:hangup()` once the bridge returns.
- **ph** plays every phone: the agent's browser, the customer, and the third
  party. It answers `customer`, `thirdparty` and `agentin`, and rings
  `slowparty` for 8 seconds before answering.

The SIP Call-ID the driver hands to `mergeCalls` is read off the `ph` leg of
each call. That leg is the same dialog the browser holds, so it is exactly what
`getSipCallId()` sends from the softphone.

## What it checks

It checks both directions: a customer the agent dialled, and a customer who
called in. For each one:

- After the merge, the customer, third party and agent are all in one
  conference, and the agent's held leg is released.
- Everyone hears everyone. A tone is played from each party, and each listener
  is recorded and checked for that tone.
- When the agent hangs up, the customer and third party stay connected.
- When the third party then leaves, the customer is hung up and not left alone
  in an empty room.

It also checks the guard rails. A channel UUID in place of a SIP Call-ID is
refused. Merging before the third party answers is refused. Neither refusal
touches the calls.
