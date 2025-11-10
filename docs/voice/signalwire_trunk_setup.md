# SignalWire SIP Trunk Setup

This guide walks through configuring SignalWire as your SIP trunk provider for inbound and outbound PSTN calls.

## Prerequisites

- SignalWire account with space created
- Public IP address for your SBC (Kamailio)
- DNS records configured (optional but recommended)

## Step 1: Create SIP Credentials

1. Log into SignalWire Console
2. Navigate to **SIP** → **Credentials**
3. Click **Create SIP Credential**
4. Set:
   - **Username**: `sw_sip_user` (or your preferred username)
   - **Password**: Generate a strong password
   - **Space**: Select your SignalWire space
5. Save the credentials and note them for your `.env.voice` file

## Step 2: Configure SIP Endpoint/Trunk

1. Navigate to **SIP** → **Endpoints** (or **Trunks**)
2. Create a new endpoint/trunk:
   - **Name**: `Production SBC`
   - **SIP URI**: `sip:YOUR_PUBLIC_IP:5060` (or `sip:sbc.yourdomain.com:5060` if DNS configured)
   - **Transport**: UDP (or TCP/TLS if configured)
   - **Allowed IPs**: Add your SBC public IP address
   - **Authentication**: Use the SIP credentials created in Step 1

## Step 3: Assign DIDs for Inbound Routing

1. Navigate to **Phone Numbers** → **Manage Numbers**
2. Select your DID(s)
3. Configure routing:
   - **Type**: SIP
   - **SIP URI**: `sip:YOUR_PUBLIC_IP:5060` (or your SBC domain)
   - **Transport**: UDP
4. Save the routing configuration

## Step 4: Outbound Configuration

FreeSWITCH will register to SignalWire's outbound proxy using the gateway configured in `sofia.conf.xml`.

The gateway registration status can be checked:

- In SignalWire Console: **SIP** → **Registrations**
- In FreeSWITCH: `fs_cli -x "sofia status gateway signalwire"`

## Step 5: Verify Registration

1. Start your voice stack: `docker compose -f infra/docker/docker-compose.voice.yml up -d`
2. Check FreeSWITCH logs: `docker logs -f freeswitch`
3. Look for gateway registration success:
   ```
   sofia_reg.c:xxxx Registration successful for signalwire
   ```

## Troubleshooting

### Registration Fails

- Verify SIP credentials are correct
- Check firewall allows outbound SIP (5060 UDP/TCP)
- Ensure `SIGNALWIRE_OUTBOUND_PROXY` matches SignalWire's regional proxy
- Check FreeSWITCH logs for authentication errors

### Inbound Calls Not Reaching FreeSWITCH

- Verify DID routing points to your SBC IP
- Check Kamailio logs: `docker logs -f sbc-kamailio`
- Ensure firewall allows inbound SIP on port 5060
- Verify dispatcher.list contains correct FreeSWITCH IP/port

### One-Way Audio

- Ensure RTP ports (10000-20000 UDP) are open on firewall
- Verify `PUBLIC_IP` matches your actual public IP
- Check RTPEngine is running: `docker logs -f rtpengine`

## SignalWire Regional Proxies

Common SignalWire SIP proxy formats:

- US East: `sip.us-east.sip.signalwire.com`
- US West: `sip.us-west.sip.signalwire.com`
- EU: `sip.eu.sip.signalwire.com`

Update `SIGNALWIRE_OUTBOUND_PROXY` in `.env.voice` to match your region.

## Security Notes

- Use TLS for SIP if possible (port 5061)
- Restrict allowed IPs in SignalWire endpoint configuration
- Rotate SIP passwords regularly
- Monitor for unauthorized registration attempts
