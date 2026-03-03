# Hopwhistle Softphone — Complete Setup Guide

> **Version**: 1.0 — February 2026
> **Audience**: Developers deploying and integrating the Hopwhistle browser-based softphone with VoIP carriers.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Network & Port Reference](#2-network--port-reference)
3. [Layer 1 — VoIP Carrier (Anveo Direct)](#3-layer-1--voip-carrier-anveo-direct)
4. [Layer 2 — FreeSWITCH (SIP PBX)](#4-layer-2--freeswitch-sip-pbx)
5. [Layer 3 — Docker Infrastructure](#5-layer-3--docker-infrastructure)
6. [Layer 4 — SSL/TLS for WebSocket Security](#6-layer-4--ssltls-for-websocket-security)
7. [Layer 5 — Frontend SIP.js Client](#7-layer-5--frontend-sipjs-client)
8. [Layer 6 — Backend API (Call Tracking)](#8-layer-6--backend-api-call-tracking)
9. [Firewall Rules](#9-firewall-rules)
10. [Verification & Diagnostics](#10-verification--diagnostics)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Architecture Overview

The softphone is a browser-based WebRTC phone that sits in the bottom-right corner of the Hopwhistle web application. Calls flow through five layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Agent)                              │
│   SIP.js UserAgent ──WSS:7443──► FreeSWITCH (internal profile)     │
│                                        │                            │
│                                        │ SIP INVITE                 │
│                                        ▼                            │
│                              FreeSWITCH Dialplan                    │
│                              (default context)                      │
│                                        │                            │
│                                        │ sofia/gateway/anveo        │
│                                        ▼                            │
│                              Anveo Direct SBC                       │
│                              (sbc.anveo.com)                        │
│                                        │                            │
│                                        ▼                            │
│                                     PSTN                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Technology Stack:**

| Component      | Technology             | Purpose                               |
| :------------- | :--------------------- | :------------------------------------ |
| Browser Client | SIP.js `0.21.x`        | WebRTC SIP User Agent                 |
| SIP PBX        | FreeSWITCH `1.10.12`   | SIP signaling, media transcoding      |
| Transport      | WebSocket Secure (WSS) | Browser → FreeSWITCH signaling        |
| Media          | SRTP over UDP          | Encrypted audio (RTP)                 |
| VoIP Carrier   | Anveo Direct           | PSTN termination & origination        |
| API Backend    | Fastify (Node.js)      | Call state tracking, CDR persistence  |
| State Cache    | Redis                  | Real-time agent status, call metadata |

---

## 2. Network & Port Reference

| Port            | Protocol | Direction | Service                                    |
| :-------------- | :------- | :-------- | :----------------------------------------- |
| **7443**        | WSS/TCP  | Inbound   | Browser WebSocket → FreeSWITCH (SIP.js)    |
| **8083**        | WS/TCP   | Inbound   | Dev/insecure WebSocket (local dev only)    |
| **5060**        | UDP/TCP  | Internal  | SIP signaling (internal profile, agents)   |
| **5080**        | UDP/TCP  | Inbound   | SIP signaling (external profile, carriers) |
| **5070**        | UDP/TCP  | Inbound   | SIP signaling (Vapi AI, isolated)          |
| **8021**        | TCP      | Internal  | FreeSWITCH Event Socket Layer (ESL)        |
| **16384–16484** | UDP      | Both      | RTP media (audio)                          |
| **3001**        | TCP      | Internal  | API server (Fastify)                       |
| **3000**        | TCP      | Inbound   | Web frontend (Next.js)                     |

---

## 3. Layer 1 — VoIP Carrier (Anveo Direct)

Anveo Direct is the primary PSTN carrier. Authentication is **IP-based** (no SIP registration required).

### 3.1 Anveo Dashboard Setup

1. **Sign up** at [anveo.com](https://www.anveo.com).
2. **Whitelist your server IP**: Go to _Account → Security → Authorized IPs_ and add your server's public IP (e.g., `45.32.213.201`).
3. **Purchase a DID**: Go to _Phone Numbers → Order_ and acquire a number.
4. **Configure DID routing**: Point the DID's destination to your server:
   ```
   sip:<DID_E164>@<YOUR_SERVER_IP>:5080
   ```
   Example: `sip:18652809894@45.32.213.201:5080`

### 3.2 Outbound Call Prefix

Anveo requires a **tech prefix** for outbound routing. All outbound calls must be prefixed with `0123451` (country code `1` for US):

```
0123451 + <10-digit-number>
```

Example: To call `(555) 332-6220`, FreeSWITCH dials `01234515553326220`.

### 3.3 API Credentials (for DID provisioning)

The API provisioning service uses these environment variables:

```bash
ANVEO_API_KEY=<your-user-token>
ANVEO_EMAIL=<your-anveo-email>
ANVEO_SECURE_PHRASE=<your-secure-phrase>
```

API endpoint: `https://www.anveo.com/api/v3.asp`

---

## 4. Layer 2 — FreeSWITCH (SIP PBX)

FreeSWITCH handles SIP signaling, codec transcoding, and media bridging. Configuration lives in `apps/freeswitch/conf/`.

### 4.1 Global Variables (`conf/vars.xml`)

Environment variables are injected at container startup via `docker-entrypoint.sh`:

```xml
<include>
  <X-PRE-PROCESS cmd="set" data="global_codec_prefs=OPUS,G722,PCMU,PCMA,H264,VP8"/>
  <X-PRE-PROCESS cmd="set" data="outbound_codec_prefs=OPUS,G722,PCMU,PCMA,H264,VP8"/>

  <!-- Public IP for RTP media - set via environment variable -->
  <X-PRE-PROCESS cmd="set" data="public_ip=${PUBLIC_IP}"/>
  <!-- Domain MUST be set for SIP registration to work -->
  <X-PRE-PROCESS cmd="set" data="domain=${PUBLIC_IP}"/>
  <X-PRE-PROCESS cmd="set" data="api_url=${API_URL}"/>
  <X-PRE-PROCESS cmd="set" data="api_key=${API_KEY}"/>

  <X-PRE-PROCESS cmd="set" data="outbound_caller_id=${OUTBOUND_CALLER_ID}"/>
  <X-PRE-PROCESS cmd="set" data="esl_password=${FREESWITCH_ESL_PASSWORD}"/>
</include>
```

> **Critical**: `domain` and `public_ip` must be set to your server's public IP. SIP.js registers using `sip:1000@<PUBLIC_IP>` and FreeSWITCH must match this domain for registration to succeed.

### 4.2 Internal SIP Profile (`conf/sip_profiles/internal.xml`)

This profile accepts WebRTC connections from the browser:

```xml
<include>
  <profile name="internal">
    <settings>
      <param name="debug" value="0"/>
      <param name="sip-trace" value="false"/>

      <!-- Network Settings -->
      <param name="sip-ip" value="$${local_ip_v4}"/>
      <param name="ext-sip-ip" value="$${public_ip}"/>
      <param name="sip-port" value="5060"/>
      <param name="rtp-ip" value="$${local_ip_v4}"/>
      <param name="ext-rtp-ip" value="$${public_ip}"/>

      <!-- WebSocket Bindings for WebRTC -->
      <param name="ws-binding" value=":8083"/>
      <param name="wss-binding" value=":7443"/>

      <!-- TLS Settings for WSS (Let's Encrypt certs) -->
      <param name="tls-cert-dir" value="/etc/freeswitch/letsencrypt"/>
      <param name="tls-version" value="tlsv1.2"/>

      <!-- SIP Settings -->
      <param name="dialplan" value="XML"/>
      <param name="context" value="default"/>

      <!-- Codec Settings -->
      <param name="inbound-codec-prefs" value="OPUS,G722,PCMU,PCMA"/>
      <param name="outbound-codec-prefs" value="OPUS,G722,PCMU,PCMA"/>

      <!-- WebRTC to PSTN compatibility -->
      <param name="inbound-late-negotiation" value="true"/>
      <param name="inbound-zrtp-passthru" value="true"/>

      <!-- Authentication -->
      <param name="challenge-realm" value="auto_from"/>
      <param name="auth-calls" value="false"/>

      <!-- NAT Traversal -->
      <param name="aggressive-nat-detection" value="true"/>
      <param name="local-network-acl" value="localnet.auto"/>
      <param name="apply-nat-acl" value="nat.auto"/>

      <!-- Registration -->
      <param name="accept-blind-reg" value="true"/>
      <param name="accept-blind-auth" value="true"/>

      <!-- RTP Settings -->
      <param name="rtp-timeout-sec" value="300"/>
      <param name="rtp-hold-timeout-sec" value="1800"/>
    </settings>
  </profile>
</include>
```

**Key points:**

- `wss-binding` on port **7443** is the secure WebSocket endpoint for SIP.js.
- `tls-cert-dir` must contain valid SSL certificates (Let's Encrypt recommended).
- `inbound-late-negotiation` is required for WebRTC-to-PSTN codec bridging.
- `accept-blind-reg` and `accept-blind-auth` are `true` — authentication is relaxed for the internal profile.

### 4.3 External SIP Profile (`conf/sip_profiles/external.xml`)

This profile handles carrier-facing traffic (Anveo inbound/outbound):

```xml
<profile name="external">
  <settings>
    <param name="debug" value="0"/>
    <param name="sip-trace" value="false"/>

    <param name="sip-ip" value="$${local_ip_v4}"/>
    <param name="sip-port" value="5080"/>
    <param name="rtp-ip" value="$${local_ip_v4}"/>
    <param name="ext-rtp-ip" value="45.32.213.201"/>
    <param name="ext-sip-ip" value="45.32.213.201"/>

    <param name="dialplan" value="XML"/>
    <param name="context" value="public"/>
    <param name="rtp-timeout-sec" value="300"/>
    <param name="rtp-hold-timeout-sec" value="1800"/>

    <param name="codec-prefs" value="OPUS,G722,PCMU,PCMA"/>
    <param name="auth-calls" value="false"/>
    <param name="aggressive-nat-detection" value="true"/>
    <param name="apply-nat-acl" value="nat.auto"/>
  </settings>

  <gateways>
    <X-PRE-PROCESS cmd="include" data="external/*.xml"/>
  </gateways>
</profile>
```

### 4.4 Anveo Gateway (`conf/sip_profiles/external/anveo.xml`)

```xml
<include>
    <gateway name="anveo">
        <param name="proxy" value="sbc.anveo.com"/>
        <param name="register" value="false"/>
        <param name="caller-id-in-from" value="true"/>
    </gateway>
</include>
```

- `register` is `false` because Anveo uses **IP-based authentication** (your server IP must be whitelisted in the Anveo dashboard).
- `caller-id-in-from` passes the caller ID in the SIP `From` header as Anveo requires.

### 4.5 SIP Directory User (`conf/directory/default/demo-agent.xml`)

This defines the SIP user that the browser client authenticates as:

```xml
<include>
  <user id="demo-agent">
    <params>
      <param name="password" value="1"/>
    </params>
    <variables>
      <variable name="toll_allow" value="domestic,international,local"/>
      <variable name="accountcode" value="demo-agent"/>
      <variable name="user_context" value="internal"/>
      <variable name="effective_caller_id_name" value="Demo Agent"/>
      <variable name="effective_caller_id_number" value="1000"/>
    </variables>
  </user>
</include>
```

> **Note**: The browser SIP.js client connects as user `1000` with password `1234` (hardcoded in `phone-provider.tsx`). You can customize these credentials by creating a new directory XML file.

### 4.6 Outbound Dialplan (`conf/dialplan/default.xml`)

This routes calls from the browser agent out through the Anveo gateway:

```xml
<include>
  <context name="default">
    <!-- Outbound calls - use Anveo with tech prefix -->
    <extension name="outbound-to-anveo">
      <condition field="destination_number" expression="^(\d{10,11})$">
        <action application="log" data="INFO [DEFAULT] Outbound call to ${destination_number}"/>
        <action application="set" data="effective_caller_id_number=18652809894"/>
        <action application="set" data="effective_caller_id_name=Hopwhistle"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <!-- Force PSTN-compatible codecs for Anveo -->
        <action application="set" data="absolute_codec_string=PCMU,PCMA"/>
        <action application="export" data="nolocal:absolute_codec_string=PCMU,PCMA"/>
        <!-- Anveo requires tech prefix 012345 + country code + number -->
        <action application="bridge" data="sofia/gateway/anveo/0123451${destination_number}"/>
      </condition>
    </extension>

    <!-- Fallback for any unmatched -->
    <extension name="unmatched">
      <condition field="destination_number" expression="^.+$">
        <action application="log" data="WARNING Unmatched: ${destination_number}"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>
  </context>
</include>
```

**Key points:**

- `effective_caller_id_number` sets the outbound caller ID (your DID).
- `absolute_codec_string=PCMU,PCMA` forces G.711 codecs for PSTN compatibility.
- The bridge URI: `sofia/gateway/anveo/0123451${destination_number}` prepends the Anveo tech prefix.

### 4.7 Inbound Dialplan (`conf/dialplan/public.xml`)

Routes incoming PSTN calls to the agent's browser extension:

```xml
<include>
  <context name="public">
    <!-- Inbound to Call Center DID (865-280-9894) -->
    <extension name="inbound-call-center">
      <condition field="destination_number" expression="^(\+?1?8652809894)$">
        <action application="log" data="INFO [PUBLIC] Inbound call to Call Center DID"/>
        <action application="set" data="domain_name=45.32.213.201"/>
        <action application="set" data="call_direction=inbound"/>
        <!-- Ring the Call Center agent via internal profile -->
        <action application="bridge" data="${sofia_contact(internal/1000@45.32.213.201)}"/>
      </condition>
    </extension>

    <!-- Default: reject unknown inbound -->
    <extension name="unmatched-inbound">
      <condition field="destination_number" expression="^.+$">
        <action application="log" data="WARNING [PUBLIC] Unmatched inbound: ${destination_number}"/>
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>
  </context>
</include>
```

- `${sofia_contact(internal/1000@<IP>)}` dynamically resolves to the currently registered WebRTC endpoint, so the call reaches the browser.
- Replace `8652809894` with your actual DID and `45.32.213.201` with your server IP.

### 4.8 Access Control Lists (`conf/autoload_configs/acl.conf.xml`)

```xml
<configuration name="acl.conf" description="Network Lists">
  <network-lists>
    <!-- Anveo Direct Signaling IPs -->
    <list name="anveo_direct" default="deny">
      <node type="allow" cidr="169.48.232.158/32"/>
      <node type="allow" cidr="204.216.109.55/32"/>
      <node type="allow" cidr="176.9.39.206/32"/>
      <node type="allow" cidr="72.9.149.25/32"/>
    </list>
    <list name="domains" default="deny">
      <!-- Docker Network -->
      <node type="allow" cidr="172.18.0.0/16"/>
      <node type="allow" cidr="172.16.0.0/12"/>
      <node type="allow" cidr="192.168.0.0/16"/>
      <node type="allow" cidr="10.0.0.0/8"/>
      <node type="allow" cidr="127.0.0.1/32"/>
      <!-- Allow Public Internet for WebRTC -->
      <node type="allow" cidr="0.0.0.0/0"/>
    </list>
  </network-lists>
</configuration>
```

### 4.9 Loaded Modules (`conf/autoload_configs/modules.conf.xml`)

Critical modules for the softphone:

```xml
<configuration name="modules.conf" description="Modules">
  <modules>
    <load module="mod_console"/>
    <load module="mod_logfile"/>
    <load module="mod_event_socket"/>   <!-- ESL for API control -->
    <load module="mod_sofia"/>          <!-- SIP engine -->
    <load module="mod_commands"/>
    <load module="mod_conference"/>     <!-- 3-way calling -->
    <load module="mod_dptools"/>
    <load module="mod_dialplan_xml"/>
    <load module="mod_opus"/>           <!-- OPUS codec for WebRTC -->
    <load module="mod_spandsp"/>
    <load module="mod_sndfile"/>
    <load module="mod_tls"/>            <!-- TLS/SRTP for secure media -->
  </modules>
</configuration>
```

### 4.10 Event Socket (`conf/autoload_configs/event_socket.conf.xml`)

Allows the API to control FreeSWITCH programmatically (merge calls, etc.):

```xml
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="listen-ip" value="0.0.0.0"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="$${esl_password}"/>
    <param name="apply-inbound-acl" value="domains"/>
  </settings>
</configuration>
```

---

## 5. Layer 3 — Docker Infrastructure

### 5.1 FreeSWITCH Dockerfile (`apps/freeswitch/Dockerfile`)

```dockerfile
FROM safarov/freeswitch:1.10.12

RUN mkdir -p /recordings

# Copy custom configs into the base image
COPY apps/freeswitch/conf/autoload_configs/*.xml /usr/share/freeswitch/conf/vanilla/autoload_configs/
COPY apps/freeswitch/conf/sip_profiles/*.xml /usr/share/freeswitch/conf/vanilla/sip_profiles/
COPY apps/freeswitch/conf/sip_profiles/external/ /usr/share/freeswitch/conf/vanilla/sip_profiles/external/
COPY apps/freeswitch/conf/dialplan/*.xml /usr/share/freeswitch/conf/vanilla/dialplan/
COPY apps/freeswitch/conf/directory/default/*.xml /usr/share/freeswitch/conf/vanilla/directory/default/
COPY apps/freeswitch/conf/vars.xml /usr/share/freeswitch/conf/vanilla/vars.xml

COPY apps/freeswitch/scripts/ /usr/share/freeswitch/scripts/
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
RUN chmod +x /usr/share/freeswitch/scripts/*.sh 2>/dev/null || true

EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 7443/tcp 8021/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-c"]
```

### 5.2 Docker Entrypoint (`apps/freeswitch/docker-entrypoint.sh`)

Handles environment variable injection and RTP port restriction:

```bash
#!/bin/sh
set -e

VANILLA_CONF="/usr/share/freeswitch/conf/vanilla"
FS_CONF="/etc/freeswitch"

# Create symlinks from /etc/freeswitch to the actual config directory
if [ ! -f "$FS_CONF/freeswitch.xml" ]; then
    mkdir -p "$FS_CONF"
    for file in "$VANILLA_CONF"/*; do
        if [ -e "$file" ]; then
            filename=$(basename "$file")
            if [ -e "$FS_CONF/$filename" ] && [ ! -L "$FS_CONF/$filename" ]; then
                rm -rf "$FS_CONF/$filename"
            fi
            if [ ! -e "$FS_CONF/$filename" ]; then
                ln -s "$file" "$FS_CONF/$filename"
            fi
        fi
    done
fi

# Inject environment variables into vars.xml
if [ -f "$VANILLA_CONF/vars.xml" ]; then
    sed -i "s|\${PUBLIC_IP}|${PUBLIC_IP:-auto}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_PROXY}|${OUTBOUND_SIP_PROXY:-sip.telnyx.com}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_CALLER_ID}|${OUTBOUND_CALLER_ID:-}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${FREESWITCH_ESL_PASSWORD}|${FREESWITCH_ESL_PASSWORD:-ClueCon}|g" "$VANILLA_CONF/vars.xml"
fi

# CRITICAL: Restrict RTP ports to Docker-exposed range
SWITCH_CONF="$VANILLA_CONF/autoload_configs/switch.conf.xml"
if [ -f "$SWITCH_CONF" ]; then
    sed -i 's|<!-- *<param name="rtp-start-port" value="[0-9]*"/> *-->|<param name="rtp-start-port" value="16384"/>|g' "$SWITCH_CONF"
    sed -i 's|<!-- *<param name="rtp-end-port" value="[0-9]*"/> *-->|<param name="rtp-end-port" value="16484"/>|g' "$SWITCH_CONF"
fi

exec "$@"
```

> **Critical**: The RTP port patching (16384–16484) is mandatory. FreeSWITCH defaults to a much wider range (16384–32768), but Docker can only expose ports that are explicitly mapped. If RTP ports fall outside the mapped range, **you will have no audio**.

### 5.3 Docker Compose — FreeSWITCH Service

```yaml
freeswitch:
  build:
    context: ../../
    dockerfile: apps/freeswitch/Dockerfile
  ports:
    - '5080:5080/udp' # External SIP (carrier inbound)
    - '5080:5080/tcp'
    - '7443:7443/tcp' # WSS for WebRTC SIP (softphone)
    - '8083:8083/tcp' # WS for dev (insecure)
    - '8021:8021/tcp' # ESL (API control)
    - '16384-16484:16384-16484/udp' # RTP audio
  environment:
    - PUBLIC_IP=45.32.213.201
    - FREESWITCH_ESL_PASSWORD=ClueCon
    - API_URL=http://api:3001
    - API_KEY=${API_KEY:-demo-key}
  volumes:
    - freeswitch_recordings:/recordings
    # SSL certs for WSS on port 7443
    - /etc/letsencrypt:/etc/letsencrypt:ro
    - /etc/letsencrypt/live/hopwhistle.com:/etc/freeswitch/letsencrypt:ro
  restart: unless-stopped
```

**Customization checklist:**

- Replace `45.32.213.201` with your server's public IP.
- Replace `hopwhistle.com` with your domain for SSL cert paths.
- Set `API_KEY` to match your API service.

---

## 6. Layer 4 — SSL/TLS for WebSocket Security

The browser requires a **secure WebSocket (WSS)** connection. FreeSWITCH serves WSS natively on port 7443.

### 6.1 Obtain SSL Certificates

```bash
# Install certbot
apt-get install certbot

# Get certificates for your domain
certbot certonly --standalone -d yourdomain.com
```

### 6.2 Mount Certificates into FreeSWITCH

The internal SIP profile reads certs from `/etc/freeswitch/letsencrypt/`:

```yaml
# In docker-compose.yml
volumes:
  - /etc/letsencrypt/live/yourdomain.com:/etc/freeswitch/letsencrypt:ro
```

FreeSWITCH expects these files in the `tls-cert-dir`:

- `fullchain.pem` — Certificate + intermediate chain
- `privkey.pem` — Private key

### 6.3 Certificate Renewal

Set up a cron job and restart FreeSWITCH after renewal:

```bash
0 0 1 * * certbot renew --quiet && docker restart docker-freeswitch-1
```

---

## 7. Layer 5 — Frontend SIP.js Client

The browser-based softphone is implemented in `apps/web/src/components/phone/phone-provider.tsx`. It wraps the entire app in a React context that exposes telephony actions.

### 7.1 Dependencies

```bash
npm install sip.js@0.21.1
```

### 7.2 SIP Configuration (from `phone-provider.tsx`)

```typescript
// SIP credentials (must match FreeSWITCH directory user)
const sipUser = '1000';
const sipPass = '1234';

// SIP realm must match FreeSWITCH's configured domain (the server's public IP)
const sipDomain = process.env.NEXT_PUBLIC_IP || '45.32.213.201';

// WebSocket URL — uses the browser hostname for SSL cert validation
const wsHost = window.location.hostname;
const isSecure = window.location.protocol === 'https:';

// Port 7443: FreeSWITCH native WSS (production)
// Port 8083: Plain WS (local dev only)
const sipWsUrl = isSecure ? `wss://${wsHost}:7443` : `ws://${sipDomain}:8083`;
```

### 7.3 UserAgent Initialization

```typescript
import { UserAgent, Registerer, Inviter, Invitation, SessionState } from 'sip.js';

const uri = UserAgent.makeURI(`sip:${sipUser}@${sipDomain}`);

const ua = new UserAgent({
  uri,
  transportOptions: {
    server: sipWsUrl, // e.g., wss://hopwhistle.com:7443
  },
  authorizationUsername: sipUser,
  authorizationPassword: sipPass,
  delegate: {
    onConnect: () => {
      console.log('[Phone] SIP Transport Connected');
    },
    onDisconnect: error => {
      console.log('[Phone] SIP Transport Disconnected', error);
    },
    onInvite: (invitation: Invitation) => {
      // Handle incoming calls
      handleIncomingSipCall(invitation);
    },
  },
});

// Start the UA and register
await ua.start();
const registerer = new Registerer(ua);
await registerer.register();
console.log('[Phone] SIP Registered');
```

### 7.4 Making an Outbound Call

```typescript
async function makeCall(phoneNumber: string) {
  // 1. Track the call via the API
  const response = await fetch('/api/v1/agent/call/originate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });

  // 2. Create SIP INVITE
  const sipTargetDomain = process.env.NEXT_PUBLIC_IP || '45.32.213.201';
  const target = UserAgent.makeURI(`sip:${phoneNumber}@${sipTargetDomain}`);
  const inviter = new Inviter(userAgent, target);

  // 3. Listen for session state changes
  inviter.stateChange.addListener(newState => {
    if (newState === SessionState.Established) {
      // Call answered — set up remote audio
      setupRemoteAudio(inviter);
    } else if (newState === SessionState.Terminated) {
      // Call ended
    }
  });

  // 4. Send the INVITE
  await inviter.invite();
}
```

### 7.5 Handling Remote Audio

```typescript
function setupRemoteAudio(session: Session) {
  const stream = new MediaStream();
  const pc = session.sessionDescriptionHandler?.peerConnection;

  pc?.getReceivers().forEach(receiver => {
    if (receiver.track) {
      stream.addTrack(receiver.track);
    }
  });

  // Attach to a hidden <audio> element
  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;
  audioElement.srcObject = stream;
  document.body.appendChild(audioElement);
}
```

### 7.6 Environment Variables (Next.js `.env`)

```bash
# API URL — used for call tracking, must be accessible from browser
NEXT_PUBLIC_API_URL=https://hopwhistle.com

# Server public IP — used for SIP URI construction
NEXT_PUBLIC_IP=45.32.213.201

# API key for authenticated requests
NEXT_PUBLIC_API_KEY=demo-key
```

### 7.7 Component Tree

```
PhoneProvider (Context)           ← Wraps entire app
  └─ AgentPhonePanel              ← Bottom-right floating panel
       ├─ AgentStatusSelector     ← Available/Away/DND dropdown
       ├─ DialPad                 ← Number input + call button
       ├─ CallControls            ← Mute/Hold/Transfer/Merge
       ├─ IncomingCallModal       ← Accept/Reject overlay
       ├─ ScreenPop               ← Caller info display
       ├─ CustomerDetailsPanel    ← Expanded prospect data
       └─ ScreenPopSettings       ← Configure visible fields
```

---

## 8. Layer 6 — Backend API (Call Tracking)

The API server tracks call state in PostgreSQL and Redis. Relevant file: `apps/api/src/routes/agent-phone.ts`.

### 8.1 Key Endpoints

| Method | Endpoint                            | Purpose                    |
| :----- | :---------------------------------- | :------------------------- |
| POST   | `/api/v1/agent/call/originate`      | Track outbound call start  |
| POST   | `/api/v1/agent/call/:callId/answer` | Mark call answered         |
| POST   | `/api/v1/agent/call/:callId/hangup` | End call, record duration  |
| POST   | `/api/v1/agent/call/:callId/hold`   | Toggle hold state          |
| POST   | `/api/v1/agent/call/merge`          | 3-way conference merge     |
| POST   | `/api/v1/agent/call/incoming`       | Webhook for inbound calls  |
| GET    | `/api/v1/agent/webrtc/credentials`  | Get WebRTC/SIP credentials |
| PUT    | `/api/v1/agent/status`              | Update agent availability  |
| GET    | `/api/v1/agent/calls`               | Call history               |

### 8.2 API Environment Variables

```bash
DATABASE_URL=postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric
REDIS_URL=redis://redis:6379
FREESWITCH_HOST=freeswitch
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=ClueCon
PUBLIC_IP=45.32.213.201
```

---

## 9. Firewall Rules

Open these ports on your server firewall (UFW/iptables/Vultr Firewall):

```bash
# WebSocket Secure for SIP.js (browser softphone)
ufw allow 7443/tcp

# SIP signaling for carriers (Anveo inbound)
ufw allow 5080/udp
ufw allow 5080/tcp

# RTP media (audio) — MUST be open for call audio
ufw allow 16384:16484/udp

# HTTPS for web app (Nginx)
ufw allow 443/tcp
ufw allow 80/tcp
```

---

## 10. Verification & Diagnostics

### 10.1 Check FreeSWITCH is Running

```bash
docker exec docker-freeswitch-1 fs_cli -x "status"
```

### 10.2 Check Gateway Registration

```bash
docker exec docker-freeswitch-1 fs_cli -x "sofia status gateway anveo"
```

Expected output should show `State: NOREG` (normal for IP-auth gateways).

### 10.3 Check Registered Extensions

```bash
docker exec docker-freeswitch-1 fs_cli -x "sofia status profile internal reg"
```

When the browser is connected, you should see the SIP.js user agent registered here.

### 10.4 Enable SIP Tracing (Debug)

```bash
# Trace internal profile (browser → FS)
docker exec docker-freeswitch-1 fs_cli -x "sofia profile internal siptrace on"

# Trace external profile (FS → carrier)
docker exec docker-freeswitch-1 fs_cli -x "sofia profile external siptrace on"

# View live logs
docker logs -f docker-freeswitch-1
```

### 10.5 Test Outbound Connectivity to Carrier

```bash
docker exec docker-freeswitch-1 nc -zvw3 sbc.anveo.com 5060
```

### 10.6 Verify API Health

```bash
curl -s http://localhost:3001/health
# Expected: {"status":"ok","service":"hopwhistle-api","version":"1.0.0"}
```

---

## 11. Troubleshooting

| Symptom                          | Cause                                                  | Fix                                                                                  |
| :------------------------------- | :----------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **No audio (one-way or silent)** | RTP ports not exposed in Docker, or `ext-rtp-ip` wrong | Check `docker-compose` maps `16384-16484/udp`, verify `ext-rtp-ip` = public IP       |
| **WebSocket connection refused** | Port 7443 not open, or SSL certs missing/expired       | Check firewall (`ufw allow 7443/tcp`), verify certs in `/etc/freeswitch/letsencrypt` |
| **SIP 488 Not Acceptable**       | Codec mismatch between WebRTC and PSTN                 | Ensure `absolute_codec_string=PCMU,PCMA` in dialplan for outbound bridge             |
| **SIP 403 Forbidden**            | Server IP not whitelisted at carrier                   | Add your IP to Anveo's _Authorized IPs_ in dashboard                                 |
| **SIP 404 Not Found**            | Destination number doesn't match dialplan              | Check `default.xml` regex pattern matches the dialed number format                   |
| **Registration fails**           | SIP domain mismatch                                    | Ensure `NEXT_PUBLIC_IP` matches `domain` in FreeSWITCH `vars.xml`                    |
| **Call drops after 30sec**       | NAT timeout                                            | Verify `aggressive-nat-detection` is enabled, check `rtp-timeout-sec`                |
| **"Phone not connected" in UI**  | SIP.js failed to register                              | Open browser DevTools → Console, look for `[Phone]` logs. Check WSS URL.             |
| **API returns 500 on originate** | Database or tenant record missing                      | Ensure `Tenant` and `User` records exist for `default-tenant-id` / `demo-agent`      |

---

## Quick Start Checklist

- [ ] **Server**: Linux VPS with public IP and Docker installed
- [ ] **Domain**: DNS A record pointing to server IP
- [ ] **SSL**: Let's Encrypt certificates for your domain
- [ ] **Carrier**: Anveo account with IP whitelisted, DID purchased and routed
- [ ] **Firewall**: Ports 7443/tcp, 5080/udp+tcp, 16384-16484/udp open
- [ ] **Docker**: `docker compose up -d freeswitch api web redis`
- [ ] **Environment**: `PUBLIC_IP`, `NEXT_PUBLIC_IP`, carrier credentials set
- [ ] **Browser**: Open app on HTTPS, check phone panel in bottom-right corner
- [ ] **Test**: Dial a number, verify audio in both directions
