# SignalWire Integration Setup

This guide walks you through connecting SignalWire DIDs to your Hopwhistle SBC using LaML Bins and number import.

## Overview

- **LaML Bin (XML)**: Routes calls from SignalWire to your SBC over SIP
- **JSON/CSV Import**: Seeds your database with number inventory
- **Result**: Inbound calls flow: SignalWire → Kamailio SBC → FreeSWITCH

## 1. Environment Configuration

The voice stack uses a separate `.env` file because it runs independently from the main application stack.

**On Windows PowerShell:**

```powershell
# Copy the example file (it's already in the right place)
Copy-Item "infra\docker\env.voice.example" "infra\docker\.env.voice"
```

**On Linux/Mac:**

```bash
cp infra/docker/env.voice.example infra/docker/.env.voice
```

Then edit `infra/docker/.env.voice` and replace the placeholder values:

```bash
PUBLIC_IP=203.0.113.10
PRIVATE_IP=10.0.0.5

SBC_DOMAIN=sbc.yourdomain.com
MEDIA_DOMAIN=media.yourdomain.com

RTP_START=10000
RTP_END=20000

SIGNALWIRE_SIP_DOMAIN=yourspace.sip.signalwire.com
SIGNALWIRE_SIP_REGION=us-east
SIGNALWIRE_SIP_USERNAME=sw_trunk_user
SIGNALWIRE_SIP_PASSWORD=REPLACE_ME_STRONG
SIGNALWIRE_OUTBOUND_PROXY=sip.us-east.yourspace.sip.signalwire.com

TLS_ENABLE=false
TLS_CERT_FILE=/etc/kamailio/tls/server.crt
TLS_KEY_FILE=/etc/kamailio/tls/server.key

RECORDINGS_PATH=/var/recordings
API_BASE_URL=https://api.yourdomain.com
API_ADMIN_TOKEN=REPLACE_WITH_BEARER_TOKEN

FS_ESL_PASSWORD=ClueCon
```

**Replace:**

- `PUBLIC_IP` with your server's public IP
- `SBC_DOMAIN` and `MEDIA_DOMAIN` with your actual domains
- SignalWire credentials from your SignalWire console
- `API_ADMIN_TOKEN` with a valid bearer token

**Note:** If you enable TLS later, set `TLS_ENABLE=true` and place certificates at `kamailio/tls/`.

## 2. SignalWire LaML Bin Setup

### 2a. Create LaML Bin

1. Go to SignalWire Console → LaML Bins
2. Create a new bin named "Route to SBC"
3. Copy the XML from `docs/voice/signalwire-laml-bin.xml` and replace `sbc.yourdomain.com` with your actual SBC domain

**Example XML:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20">
    <Sip>sip:inbound@sbc.example.com</Sip>
  </Dial>
</Response>
```

**Important:** Replace `sbc.example.com` with your actual `SBC_DOMAIN` from `.env.voice` (e.g., if `SBC_DOMAIN=sbc.myserver.com`, use `sip:inbound@sbc.myserver.com`)

### 2b. Assign Bin to DID

1. Go to SignalWire Console → Phone Numbers
2. Select your DID
3. Go to Call Handling
4. Set: **When a call comes in → LaML Bin → "Route to SBC"**

**Alternative:** Use SignalWire REST API to create and assign the bin programmatically.

## 3. Number Import (CSV)

The numbers import tool uses CSV format. The example file is already created at `apps/api/src/cli/examples/numbers-signalwire.csv`.

**Before importing, make sure:**

1. Database is running and accessible
2. `apps/api/.env` has correct `DATABASE_URL`

**Import numbers:**

```bash
cd apps/api
pnpm numbers:import --file=src/cli/examples/numbers-signalwire.csv
```

**Note:** The CSV file uses these columns:

- `number` - Phone number in E.164 format (+15551234567)
- `provider` - Provider name (signalwire, telnyx, bandwidth, local)
- `status` - Number status (assigned, available, active, inactive)
- `tenant_id` - Tenant UUID (optional, uses default if empty)
- `campaign_id` - Campaign UUID (optional)
- `tags` - Semicolon-separated tags ("demo;inbound")

## 5. Kamailio Configuration

The Kamailio config already includes support for the `inbound` user from LaML Bins. The routing logic checks for `$rU == "inbound"` and dispatches to FreeSWITCH.

If you need to customize this, edit `kamailio/kamailio.cfg` - the relevant section is already configured.

## 6. Start Services

**Prerequisites:**

- Docker and Docker Compose installed
- `infra/docker/.env.voice` file created and configured

**Start the voice stack:**

From the repo root:

```bash
docker compose --env-file infra/docker/.env.voice -f infra/docker/docker-compose.voice.yml up -d --build
```

**Check status:**

```bash
docker compose -f infra/docker/docker-compose.voice.yml ps
```

**View logs:**

```bash
docker compose -f infra/docker/docker-compose.voice.yml logs -f
```

## 7. Verification

1. **SignalWire Console:**
   - Confirm SIP trunk user exists and is permitted
   - Verify DID is assigned to "Route to SBC" LaML Bin

2. **Test Call:**
   - Place a test call to your DID (e.g., +1-555-123-4567)
   - Check Kamailio logs for INVITE
   - Verify FreeSWITCH answers and plays IVR
   - Confirm recording is saved to `${RECORDINGS_PATH}`

## Troubleshooting

- **No INVITE received:** Check firewall rules, ensure ports 5060/5061 are open
- **Kamailio not routing:** Verify `SBC_DOMAIN` matches your DNS
- **FreeSWITCH not answering:** Check dispatcher.list contains correct FreeSWITCH IP
- **Recordings not saving:** Verify `RECORDINGS_PATH` exists and is writable

## Next Steps

- Configure FreeSWITCH dialplan for your use case
- Set up webhook callbacks for call events
- Enable TLS for production (requires certificates)
- Configure rate limiting and DoS protection
