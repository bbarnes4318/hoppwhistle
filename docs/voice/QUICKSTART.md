# Voice Stack Quick Start Guide

Get your voice infrastructure running in 5 minutes.

## Prerequisites

- Docker and Docker Compose installed
- Public IP address for your server
- SignalWire account (sign up at [signalwire.com](https://signalwire.com))

## Step 1: Configure Environment

```bash
# Copy the environment template
cp infra/docker/env.voice.example infra/docker/.env.voice

# Edit with your values
nano infra/docker/.env.voice  # or use your preferred editor
```

**Required values to set:**

- `PUBLIC_IP`: Your server's public IP (find with `curl ifconfig.me`)
- `SIGNALWIRE_SIP_DOMAIN`: Your SignalWire space domain (e.g., `yourspace.sip.signalwire.com`)
- `SIGNALWIRE_SIP_USERNAME`: SIP username from SignalWire
- `SIGNALWIRE_SIP_PASSWORD`: SIP password from SignalWire
- `API_BASE_URL`: Your API endpoint for webhooks
- `API_ADMIN_TOKEN`: Authentication token for webhooks

## Step 2: Generate TLS Certificates (Optional)

If using TLS for SIP:

```bash
cd kamailio/tls
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes \
  -subj "/CN=sbc.yourdomain.com"
```

## Step 3: Configure Firewall

Open these ports on your server:

```bash
# SIP Signaling
sudo ufw allow 5060/udp
sudo ufw allow 5060/tcp
sudo ufw allow 5061/tcp  # if using TLS

# RTP Media (adjust range if different)
sudo ufw allow 10000:20000/udp
```

Or for cloud providers, configure security groups to allow:

- UDP/TCP 5060 (SIP)
- TCP 5061 (SIP TLS, if enabled)
- UDP 10000-20000 (RTP)

## Step 4: Start Services

```bash
docker compose --env-file infra/docker/.env.voice \
  -f infra/docker/docker-compose.voice.yml up -d --build
```

## Step 5: Verify Services

```bash
# Check containers are running
docker ps | grep -E 'kamailio|rtpengine|freeswitch'

# Run smoke test
./scripts/smoke_call_test.sh

# View logs
docker logs -f sbc-kamailio freeswitch rtpengine
```

## Step 6: Configure SignalWire

1. **Create SIP Credentials**:
   - Log into SignalWire Console
   - Navigate to SIP → Credentials
   - Create new credential with username/password
   - Use these in your `.env.voice` file

2. **Create SIP Endpoint**:
   - Navigate to SIP → Endpoints
   - Create endpoint pointing to `sip:YOUR_PUBLIC_IP:5060`
   - Allow your server's IP address

3. **Assign DID**:
   - Navigate to Phone Numbers
   - Select your DID
   - Route to SIP: `sip:YOUR_PUBLIC_IP:5060`

4. **Verify Registration**:
   ```bash
   docker logs freeswitch | grep -i register
   ```
   Should show: `Registration successful for signalwire`

## Step 7: Test a Call

1. Call your SignalWire DID from any phone
2. You should hear: "Welcome to FreeSWITCH"
3. Check recording: `ls -lh /var/recordings` (or your `RECORDINGS_PATH`)
4. Check API logs for `recording.ready` webhook

## Troubleshooting

### Services won't start

```bash
# Check logs
docker logs sbc-kamailio
docker logs freeswitch
docker logs rtpengine

# Verify environment variables
docker exec sbc-kamailio env | grep PUBLIC_IP
```

### Registration fails

- Verify SignalWire credentials in `.env.voice`
- Check firewall allows outbound SIP (port 5060)
- Verify `SIGNALWIRE_OUTBOUND_PROXY` matches your region
- Check FreeSWITCH logs: `docker logs freeswitch | grep -i signalwire`

### One-way audio

- Verify RTP ports (10000-20000 UDP) are open
- Check `PUBLIC_IP` matches actual server IP
- Verify RTPEngine is running: `docker logs rtpengine`

### No recordings

- Check recording path exists: `docker exec freeswitch ls -la /var/recordings`
- Verify disk space: `docker exec freeswitch df -h`
- Check FreeSWITCH logs for errors

## Next Steps

- Read [Full Documentation](README.md)
- Review [SignalWire Setup Guide](signalwire_trunk_setup.md)
- Check [Firewall Configuration](sip_firewall_ports.md)
- Follow [Go-Live Checklist](go_live_checklist.md) for production

## Rollback

To stop all services:

```bash
./scripts/rollback.sh
```

Or manually:

```bash
docker compose -f infra/docker/docker-compose.voice.yml down
```
