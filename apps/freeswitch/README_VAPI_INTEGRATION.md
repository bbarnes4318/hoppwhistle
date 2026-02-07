# Vapi Integration with FreeSWITCH

## Overview

This integration allows Vapi to make outbound PSTN calls through our FreeSWITCH server via Anveo Direct. The integration is **strictly isolated** from existing call flows.

## Architecture

```
Vapi Cloud → FreeSWITCH (vapi profile :5070) → vapi_outbound dialplan → anveo_vapi gateway → Anveo SBC → PSTN
```

**Isolation guarantees:**

- Uses dedicated SIP profile on port 5070 (existing external on 5080 unchanged)
- Uses dedicated gateway `anveo_vapi` (existing `anveo` gateway unchanged)
- Uses dedicated dialplan context `vapi_outbound` (no fallthrough to other contexts)
- ACL restricts access to Vapi IPs only

---

## Configuration Values

| Setting                 | Value                                  |
| ----------------------- | -------------------------------------- |
| FreeSWITCH Public IP    | `45.32.213.201`                        |
| Vapi SIP Port           | `5070`                                 |
| SIP Username            | `vapi`                                 |
| SIP Password            | `VapiFS_5070_StrongPass!9xQ2`          |
| Vapi Assistant ID       | `37e1c497-0d84-4b53-aac0-b95881714cbb` |
| From Number (Anveo DID) | `+18652809894`                         |
| Carrier                 | Anveo Direct (`sbc.anveo.com:5060`)    |

---

## Files Added (Additive Only)

| File                                   | Purpose                           |
| -------------------------------------- | --------------------------------- |
| `sip_profiles/vapi.xml`                | New SIP profile on port 5070      |
| `sip_profiles/external/anveo_vapi.xml` | Vapi-dedicated Anveo gateway      |
| `dialplan/vapi_outbound.xml`           | Isolated dialplan for Vapi calls  |
| `directory/default/vapi.xml`           | SIP auth user for Vapi            |
| `autoload_configs/acl.conf.xml`        | Added `vapi_sip_sources` ACL list |

**No existing files were modified except appending ACL list.**

---

## Deployment Steps

### 1. Rebuild and Restart FreeSWITCH Container

```bash
cd /opt/hopwhistle/infra/docker
git pull origin main
docker compose build freeswitch --no-cache
docker compose up -d freeswitch --no-deps
```

### 2. Verify Configuration (inside container)

```bash
# Enter container
docker exec -it hopwhistle-freeswitch-dev fs_cli

# Reload XML configuration
reloadxml

# Start Vapi profile (if not auto-started)
sofia profile vapi start

# Verify profiles are running
sofia status

# Expected output should show:
# - internal (5060)
# - external (5080)
# - vapi (5070)

# Verify gateways
sofia status gateway

# Expected: anveo, anveo_vapi (plus others)

# Verify ACL
acl show vapi_sip_sources
```

### 3. Test SIP Registration/Connectivity

From Vapi, configure the BYO SIP trunk to point to:

- Host: `45.32.213.201`
- Port: `5070`
- Username: `vapi`
- Password: `VapiFS_5070_StrongPass!9xQ2`

---

## Using the Provisioning Script

```bash
cd /opt/hopwhistle/scripts

# Set API token (or it uses default)
export VAPI_API_TOKEN=b8c9e434-32ca-4cbc-ae39-b6c4583622c2

# Place a test call
node vapi_provision_and_call.js +18653969104
```

The script will:

1. Create BYO SIP trunk credential (or reuse existing)
2. Create BYO phone number +18652809894 (or reuse existing)
3. Place outbound call to the destination

---

## Debug Runbook

### Enable SIP Trace for Vapi Profile Only

```bash
# Enter fs_cli
docker exec -it hopwhistle-freeswitch-dev fs_cli

# Enable trace
sofia profile vapi siptrace on

# Watch logs
sofia loglevel all 7

# Disable when done
sofia profile vapi siptrace off
```

### Grep Logs for Vapi Calls

```bash
# Inside container
docker exec -it hopwhistle-freeswitch-dev sh

# Search logs
grep -i "accountcode=vapi" /var/log/freeswitch/freeswitch.log
grep -i "X-Provider.*Vapi" /var/log/freeswitch/freeswitch.log
grep -i "\[VAPI\]" /var/log/freeswitch/freeswitch.log
```

### What a Successful Flow Looks Like

```
INVITE from Vapi (44.229.228.186) -> :5070
  ↓
100 Trying
  ↓
401 Unauthorized (challenge)
  ↓
INVITE with Auth
  ↓
100 Trying -> 180 Ringing
  ↓
Dialplan: vapi_outbound matched
  ↓
Bridge to sofia/gateway/anveo_vapi/18653969104
  ↓
INVITE to sbc.anveo.com:5060
  Headers: X-Attestation-Level: A
  ↓
200 OK (call connected)
  ↓
RTP media flowing
```

### Detect Issues

| Symptom       | Check                                                    |
| ------------- | -------------------------------------------------------- |
| 403 Forbidden | ACL blocking - verify source IP is in `vapi_sip_sources` |
| 401 loop      | Wrong password - verify `vapi` user credentials          |
| 404 Not Found | Dialplan miss - check `vapi_outbound` context matching   |
| 503 Service   | Gateway down - check `sofia status gateway anveo_vapi`   |
| No audio      | RTP issue - check firewall for UDP 16384-32768           |

---

## Rollback Plan

If issues occur, remove Vapi integration completely:

```bash
# Enter container
docker exec -it hopwhistle-freeswitch-dev sh

# Stop Vapi profile
fs_cli -x "sofia profile vapi stop"

# Remove new files
rm /etc/freeswitch/sip_profiles/vapi.xml
rm /etc/freeswitch/sip_profiles/external/anveo_vapi.xml
rm /etc/freeswitch/dialplan/vapi_outbound.xml
rm /etc/freeswitch/directory/default/vapi.xml

# Reload (ACL will have orphan entry but won't cause issues)
fs_cli -x "reloadxml"

# Verify vapi profile is gone
fs_cli -x "sofia status"
```

To fully rollback ACL changes, revert `acl.conf.xml` to remove the `vapi_sip_sources` list.

---

## Validation Checklist

- [ ] Existing WebRTC/SIP calls work unchanged
- [ ] `sofia status` shows vapi profile on 5070
- [ ] `sofia status gateway` shows anveo_vapi
- [ ] Vapi calls appear in logs with `accountcode=vapi`
- [ ] Outbound SIP INVITE includes `X-Attestation-Level: A`
- [ ] Calls route through `anveo_vapi` gateway (not `anveo`)
- [ ] Non-Vapi IPs are rejected by ACL

---

## Port Reference

| Port | Protocol | Profile  | Purpose                 |
| ---- | -------- | -------- | ----------------------- |
| 5060 | UDP/TCP  | internal | Internal SIP            |
| 5080 | UDP/TCP  | external | External SIP (existing) |
| 5070 | UDP/TCP  | vapi     | Vapi SIP (NEW)          |
| 7443 | WSS      | verto    | WebRTC                  |
| 8021 | TCP      | ESL      | Event Socket            |
