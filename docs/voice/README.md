# Voice Infrastructure Stack

Production-ready SIP/media path with SignalWire → Kamailio SBC → FreeSWITCH + RTPEngine.

## Architecture

```
SignalWire (SIP Trunk)
    ⇄ Internet ⇄
Kamailio (edge SBC, TLS/DoS/topology hide)
    ⇄
FreeSWITCH (media/recording/IVR)
    ⇄
RTPEngine (RTP proxy/NAT)
```

## Quick Start

### 1. Prerequisites

- Docker and Docker Compose installed
- Public IP address for your server
- SignalWire account with SIP credentials
- Firewall access to configure ports (see `sip_firewall_ports.md`)

### 2. Configuration

1. Copy the environment template:

   ```bash
   cp infra/env/.env.voice.example infra/env/.env.voice
   ```

2. Edit `infra/env/.env.voice` and fill in all values:
   - `PUBLIC_IP`: Your server's public IP address
   - `SBC_DOMAIN` and `MEDIA_DOMAIN`: Your DNS domains (or use IPs)
   - `SIGNALWIRE_*`: Your SignalWire SIP credentials
   - `API_BASE_URL`: Your API endpoint for webhooks
   - `API_ADMIN_TOKEN`: Authentication token for webhooks

3. Generate TLS certificates (if using TLS):
   ```bash
   cd kamailio/tls
   openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes \
     -subj "/CN=sbc.yourdomain.com"
   ```

### 3. Configure Firewall

Open the required ports (see `docs/voice/sip_firewall_ports.md`):

- **SIP Signaling**: UDP/TCP 5060 (and 5061 for TLS)
- **RTP Media**: UDP 10000-20000 (or your configured range)
- **FreeSWITCH Internal**: UDP/TCP 5080 (restrict to Kamailio IP)

### 4. Start Services

```bash
docker compose --env-file infra/env/.env.voice -f infra/docker/docker-compose.voice.yml up -d --build
```

### 5. Verify Deployment

Run the smoke test:

```bash
./scripts/smoke_call_test.sh
```

Check service logs:

```bash
docker logs -f sbc-kamailio
docker logs -f freeswitch
docker logs -f rtpengine
```

### 6. Configure SignalWire

Follow the guide in `docs/voice/signalwire_trunk_setup.md` to:

- Create SIP credentials
- Configure SIP endpoint/trunk
- Assign DIDs for inbound routing
- Verify gateway registration

### 7. Test a Call

Place a test call to your SignalWire DID. You should:

- Hear the FreeSWITCH IVR greeting
- See call logs in all three services
- Find recording file in `${RECORDINGS_PATH}`
- Receive `recording.ready` webhook at your API

## Project Structure

```
kamailio/              # Kamailio SBC configuration
  ├── Dockerfile
  ├── kamailio.cfg     # Main Kamailio config
  ├── dispatcher.list  # FreeSWITCH routing
  ├── docker-entrypoint.sh
  └── tls/             # TLS certificates

rtpengine/             # RTPEngine configuration
  ├── Dockerfile
  ├── rtpengine.conf   # RTPEngine config
  └── docker-entrypoint.sh

freeswitch/            # FreeSWITCH configuration
  ├── Dockerfile
  ├── vars.xml         # FreeSWITCH variables
  ├── autoload_configs/
  │   ├── sofia.conf.xml      # SIP profiles
  │   ├── rtp.conf.xml        # RTP settings
  │   ├── modules.conf.xml     # Module loading
  │   ├── xml_cdr.conf.xml    # CDR/webhook config
  │   └── event_socket.conf.xml
  ├── dialplan/
  │   ├── public.xml   # Inbound call routing
  │   └── default.xml
  └── scripts/
      └── post_recording_webhook.sh

infra/
  ├── env/
  │   └── .env.voice.example  # Environment template
  └── docker/
      └── docker-compose.voice.yml

docs/voice/
  ├── README.md                    # This file
  ├── signalwire_trunk_setup.md    # SignalWire configuration
  ├── sip_firewall_ports.md        # Firewall requirements
  └── go_live_checklist.md         # Production checklist

scripts/
  ├── smoke_call_test.sh   # Health check script
  └── rollback.sh          # Rollback script
```

## Environment Variables

See `infra/env/.env.voice.example` for all available variables.

Key variables:

- `PUBLIC_IP`: Server public IP (required)
- `RTP_START`/`RTP_END`: RTP port range (default: 10000-20000)
- `SIGNALWIRE_*`: SignalWire SIP credentials
- `API_BASE_URL`: Webhook endpoint
- `RECORDINGS_PATH`: Recording storage path

## Monitoring

### Check Service Status

```bash
docker ps | grep -E 'kamailio|rtpengine|freeswitch'
```

### View Logs

```bash
# All services
docker logs -f sbc-kamailio freeswitch rtpengine

# Individual service
docker logs -f freeswitch
```

### FreeSWITCH CLI

```bash
docker exec -it freeswitch fs_cli

# Common commands:
# sofia status
# sofia status gateway signalwire
# show channels
# show calls
```

### Kamailio Control

```bash
docker exec -it sbc-kamailio kamcmd dispatcher.list
docker exec -it sbc-kamailio kamcmd pike.list
```

## Troubleshooting

### Services Won't Start

1. Check Docker logs: `docker logs <container-name>`
2. Verify environment variables: `docker exec <container> env | grep -E 'PUBLIC_IP|SIGNALWIRE'`
3. Check port conflicts: `netstat -tuln | grep -E '5060|5080'`
4. Verify file permissions on mounted volumes

### Registration Fails

1. Verify SignalWire credentials in `.env.voice`
2. Check firewall allows outbound SIP (port 5060)
3. Verify `SIGNALWIRE_OUTBOUND_PROXY` matches your region
4. Check FreeSWITCH logs: `docker logs freeswitch | grep -i register`

### One-Way Audio

1. Verify RTP ports (10000-20000 UDP) are open
2. Check `PUBLIC_IP` matches actual server IP
3. Verify RTPEngine is running: `docker logs rtpengine`
4. Check NAT traversal settings in FreeSWITCH

### Recordings Not Created

1. Verify recording path exists: `docker exec freeswitch ls -la /var/recordings`
2. Check disk space: `docker exec freeswitch df -h`
3. Verify dialplan recording configuration
4. Check FreeSWITCH logs for recording errors

### Webhooks Not Received

1. Verify `API_BASE_URL` is correct and reachable
2. Check `API_ADMIN_TOKEN` is valid
3. Test webhook endpoint manually: `curl -X POST ${API_BASE_URL}/voice/recording-ready -H "Authorization: Bearer ${API_ADMIN_TOKEN}"`
4. Check FreeSWITCH logs: `docker logs freeswitch | grep -i cdr`

## Rollback

To stop all services:

```bash
./scripts/rollback.sh
```

Or manually:

```bash
docker compose -f infra/docker/docker-compose.voice.yml down
```

## Production Considerations

1. **Security**:
   - Use TLS for SIP (port 5061)
   - Restrict FreeSWITCH ports to Kamailio IP only
   - Rotate passwords regularly
   - Monitor for unauthorized access

2. **High Availability**:
   - Deploy multiple Kamailio instances behind load balancer
   - Use shared storage for recordings
   - Implement health checks and auto-restart

3. **Monitoring**:
   - Set up log aggregation (ELK, Loki, etc.)
   - Monitor call quality metrics
   - Alert on service downtime
   - Track recording storage usage

4. **Backup**:
   - Backup configuration files
   - Backup TLS certificates securely
   - Implement recording retention policy
   - Test restore procedures

## Documentation

- [SignalWire Trunk Setup](signalwire_trunk_setup.md)
- [SIP Firewall Ports](sip_firewall_ports.md)
- [Go-Live Checklist](go_live_checklist.md)

## Support

For issues:

1. Check logs: `docker logs <service-name>`
2. Review troubleshooting section above
3. Consult SignalWire documentation
4. Check FreeSWITCH/Kamailio documentation

## License

[Your License Here]
