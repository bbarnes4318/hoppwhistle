# BulkVS STIR/SHAKEN Cutover — Ops Runbook

**Date**: March 2026
**Change**: Route outbound Vapi calls through BulkVS with local STIR/SHAKEN signing

---

## What Changed

| File | Change |
|------|--------|
| `apps/freeswitch/conf/sip_profiles/external/bulkvs.xml` | **NEW** — BulkVS SIP gateway (IP-auth, no registration) |
| `apps/freeswitch/scripts/local_shaken.lua` | **NEW** — Real ES256 PASSporT signing + CID validation |
| `apps/freeswitch/conf/dialplan/vapi_outbound.xml` | **REWRITE** — Routes through BulkVS, invokes local signer, removes Anveo/fake headers |
| `apps/freeswitch/conf/autoload_configs/acl.conf.xml` | **MODIFIED** — Added `bulkvs_sip_sources` ACL list |

### What Was Removed
- Fake `sip_h_X-Attestation-Level=A` header (not real STIR/SHAKEN signing)
- Anveo tech prefix (`012345`) and `anveo_vapi` gateway routing
- Hardcoded Anveo CID (`18652809894`)

### What Was Added
- Real RFC 8225 PASSporT `Identity` header, signed with PVN LLC's ES256 private key
- CID validated against BulkVS DID pool before signing
- Fail-open design: signing errors never drop calls

---

## Why Local Signing Is the Source of Truth

BulkVS is our outbound carrier, but we sign calls ourselves because:
1. **We are PVN LLC** — a licensed carrier with our own STIR/SHAKEN certificate
2. **Full A-attestation** — we originate the call and own the CID
3. **No API dependency** — local signing eliminates the BulkVS STI-AS API as a runtime dependency
4. **Single Identity header** — BulkVS passes our header through without re-signing

---

## BulkVS Carrier-Side Requirement

> **BulkVS must be configured to pass through our `Identity` header and NOT re-sign outbound calls.**

If BulkVS auto-signs, the INVITE will have two `Identity` headers → carrier rejection (`400 Multiple Identity headers`).

Contact BulkVS support to confirm: "Our trunk sends pre-signed STIR/SHAKEN calls with Full A-attestation. Please configure our account to pass through the existing Identity header without adding a second signature."

---

## Verification Steps

### 1. Verify OpenSSL in Container
```bash
docker exec docker-freeswitch-1 which openssl
# Expected: /usr/bin/openssl
```

### 2. Verify Private Key Is Mounted
```bash
docker exec docker-freeswitch-1 ls -la /etc/freeswitch/stir-shaken/private.key
# Expected: file exists, non-zero size
```

### 3. Verify BulkVS Gateway Is Loaded
```bash
docker exec docker-freeswitch-1 fs_cli -x 'sofia status gateway bulkvs'
# Expected: Status NOREG, State UP
```

### 4. Verify Dialplan Is Correct
```bash
docker exec docker-freeswitch-1 fs_cli -x 'xml_locate dialplan' | grep -B2 -A5 'local_shaken'
# Expected: shows lua action before bridge to bulkvs gateway
```

### 5. Verify ACL Loaded
```bash
docker exec docker-freeswitch-1 fs_cli -x 'reloadacl'
docker exec docker-freeswitch-1 fs_cli -x 'acl show bulkvs_sip_sources'
# Expected: lists the 5 BulkVS IP ranges
```

### 6. Test Call with SIP Trace (Confirm Exactly One Identity Header)
```bash
# Enable tracing
docker exec docker-freeswitch-1 fs_cli -x 'sofia profile external siptrace on'

# Trigger test call
node scripts/vapi_provision_and_call.js +1XXXXXXXXXX

# Check logs for Identity header
docker logs docker-freeswitch-1 2>&1 | grep -i "Identity:"
# Expected: exactly ONE Identity header per INVITE
# Format: <b64url>.<b64url>.<b64url>;info=<cert_url>;alg=ES256;ppt=shaken

# Count headers (must be 1, not 2)
docker logs docker-freeswitch-1 2>&1 | tail -200 | grep -c "sip_h_Identity"
```

### 7. Verify CID in Outbound INVITE
```bash
docker logs docker-freeswitch-1 2>&1 | grep "CID validated"
# Expected: [SHAKEN] CID validated: 12816989460
```

---

## Rollout Checklist

1. [ ] Merge changes to main branch
2. [ ] SSH to production server
3. [ ] `git pull` latest changes
4. [ ] Ensure private key is mounted: `ls -la /opt/hopwhistle/stir-shaken/private.key`
5. [ ] Rebuild FreeSWITCH container:
   ```bash
   docker compose build --no-cache freeswitch
   docker compose up -d freeswitch --force-recreate
   ```
6. [ ] Run verification steps 1-5 (above)
7. [ ] Make a test call (step 6)
8. [ ] Confirm with BulkVS that passthrough is working
9. [ ] Monitor for 30 minutes — check for `400 Multiple Identity` or `403` rejections

---

## Rollback

If calls fail after deployment:

```bash
# Revert to previous commit
git checkout HEAD~1 -- apps/freeswitch/conf/dialplan/vapi_outbound.xml
git checkout HEAD~1 -- apps/freeswitch/conf/sip_profiles/external/bulkvs.xml
git checkout HEAD~1 -- apps/freeswitch/conf/autoload_configs/acl.conf.xml

# Remove the signing script
rm apps/freeswitch/scripts/local_shaken.lua

# Rebuild
docker compose build --no-cache freeswitch
docker compose up -d freeswitch --force-recreate
```

This restores the previous Anveo routing with the `X-Attestation-Level` header.

---

## Key Files Reference

| Component | Path |
|-----------|------|
| Signing script | `apps/freeswitch/scripts/local_shaken.lua` |
| Private key | `/etc/freeswitch/stir-shaken/private.key` (mounted volume) |
| Public cert | `https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt` |
| BulkVS gateway | `apps/freeswitch/conf/sip_profiles/external/bulkvs.xml` |
| Dialplan | `apps/freeswitch/conf/dialplan/vapi_outbound.xml` |
| ACL config | `apps/freeswitch/conf/autoload_configs/acl.conf.xml` |
| DID pool | Hardcoded in `local_shaken.lua` (16 BulkVS TNs) |
| Default CID | `12816989460` |
