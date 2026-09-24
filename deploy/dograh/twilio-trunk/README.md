# Dograh AI outbound calls over Twilio

Dograh places AI calls through `dograh-asterisk`, which today dials
`PJSIP/<number>@fractel`. This adds a `twilio` PJSIP trunk pointed at a Twilio
Elastic SIP Trunking termination URI. A Dograh telephony configuration then
sends its calls to Twilio with the dial template `PJSIP/{number}@twilio`.
Campaigns, the state-matched caller-ID pool and transfers are unchanged.

## 1. In Twilio

Go to **Elastic SIP Trunking → your trunk → Termination** and set up:

- **Termination SIP URI**, for example `pvn.pstn.twilio.com`.
- **Authentication**, either one or both:
  - an **IP Access Control List** containing this host's public IP. This is the
    preferred option.
  - a **Credential List**. Put `username:password` on one line in a root-only
    file, for example `/root/twilio-sip.cred` with mode `600`, and pass it as
    `--auth-file`.

Caller ID: Twilio rejects the call with `403` and `X-Twilio-Error: 32204 Invalid
Caller ID` unless the caller ID is a number in the Twilio account, or a Verified
Caller ID on it (**Phone Numbers → Manage → Verified Caller IDs**). A caller-ID
pool of numbers bought from another carrier therefore has to be ported to
Twilio, verified one by one, or kept on that carrier's trunk.

## 2. On the host

```bash
cd /opt/hopwhistle
python3 deploy/dograh/twilio-trunk/install_twilio_trunk.py --termination pvn.pstn.twilio.com
python3 deploy/dograh/twilio-trunk/install_twilio_trunk.py --termination pvn.pstn.twilio.com --apply
# add --auth-file /root/twilio-sip.cred if Twilio uses a credential list
```

The first command is a dry run. The second writes a marked block into
`pjsip.conf` and `extensions.conf`, keeps a `.bak-hopwhistle-twilio` copy of
each, and runs only `module reload res_pjsip.so` and `dialplan reload`. Calls in
progress are unaffected.

Place a test call to your own phone, using a caller ID Twilio will accept:

```bash
python3 deploy/dograh/twilio-trunk/install_twilio_trunk.py --test-call +1YOURCELL --caller-id +1CALLERID
```

## 3. In Dograh

In the ARI telephony configuration that the campaign uses, set the dial template
(`dial_string_template`) to:

```
PJSIP/{number}@twilio
```

To run Twilio alongside FracTEL, create a second ARI configuration with this
template and assign the campaigns you want on Twilio to it.

## Rollback

Set the dial template back to `PJSIP/{number}@fractel`. To also remove the trunk:

```bash
python3 deploy/dograh/twilio-trunk/install_twilio_trunk.py --rollback --apply
```

## Tested

`deploy/dograh/tests/test_twilio_trunk.py` covers config generation, credential
parsing and redaction, and idempotent apply and rollback.

The generated configuration was also loaded into Asterisk 20 with a stand-in
SIP server. A test call arrived as `INVITE sip:+15551234567@…`, with the caller
ID `+18652757300` in both From and P-Asserted-Identity, and with outbound auth
attached.

## Verifying our own numbers as Twilio caller IDs

Twilio doesn't charge for Verified Caller IDs. To verify one, Twilio calls the
number and waits for a code. Our DIDs ring into FreeSWITCH, so
`verify_caller_ids.py` handles both sides of that. It asks Twilio to verify the
number and passes the code to FreeSWITCH. `inbound_route.lua` answers Twilio's
call on that DID, keys in the code and deletes it. Other calls on the number
route as usual.

This needs a FreeSWITCH image built from a checkout that includes
`inbound_route.lua` step 0.

```bash
# AccountSid:AuthToken from the Twilio console, root-only
printf '%s\n' 'ACxxxxxxxx:your_auth_token' > /root/twilio-api.cred && chmod 600 /root/twilio-api.cred

cd /opt/hopwhistle/deploy/dograh/twilio-trunk
python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh                    # counts only
python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh --apply --limit 1  # one number
python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh --apply --limit 5000 --concurrency 4
```

It skips numbers that are already verified, so you can stop it and run it again
at any point.

Verified numbers that Twilio doesn't host are signed with STIR/SHAKEN
attestation B, not A.
