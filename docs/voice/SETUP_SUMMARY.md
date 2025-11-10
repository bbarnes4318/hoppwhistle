# Voice Infrastructure Setup Summary

This document provides an overview of the complete voice stack infrastructure that has been created.

## What Was Created

### Core Infrastructure

1. **Kamailio SBC** (`kamailio/`)
   - Dockerfile with Kamailio and required modules
   - `kamailio.cfg` - Main configuration with topology hiding, DoS protection
   - `dispatcher.list` - Routes to FreeSWITCH
   - `docker-entrypoint.sh` - Environment variable substitution
   - `tls/` - Directory for TLS certificates

2. **RTPEngine** (`rtpengine/`)
   - Dockerfile with RTPEngine
   - `rtpengine.conf` - RTP proxy configuration
   - `docker-entrypoint.sh` - Environment variable substitution

3. **FreeSWITCH** (`freeswitch/`)
   - Dockerfile with FreeSWITCH and modules
   - `vars.xml` - FreeSWITCH variables
   - `autoload_configs/` - Configuration files:
     - `sofia.conf.xml` - SIP profiles and SignalWire gateway
     - `rtp.conf.xml` - RTP settings
     - `modules.conf.xml` - Module loading
     - `xml_cdr.conf.xml` - CDR and webhook configuration
     - `event_socket.conf.xml` - ESL configuration
   - `dialplan/` - Call routing:
     - `public.xml` - Inbound call handling with recording
     - `default.xml` - Default routing
   - `scripts/` - Utility scripts:
     - `post_recording_webhook.sh` - Webhook notification script
   - `docker-entrypoint.sh` - Environment variable substitution

4. **Docker Compose** (`infra/docker/`)
   - `docker-compose.voice.yml` - Complete stack orchestration
   - `env.voice.example` - Environment variable template

5. **Documentation** (`docs/voice/`)
   - `README.md` - Complete documentation
   - `QUICKSTART.md` - Quick start guide
   - `signalwire_trunk_setup.md` - SignalWire configuration guide
   - `sip_firewall_ports.md` - Firewall requirements
   - `go_live_checklist.md` - Production deployment checklist

6. **Scripts** (`scripts/`)
   - `smoke_call_test.sh` - Health check script
   - `rollback.sh` - Rollback script

## Architecture Flow

```
Inbound Call Flow:
SignalWire → Kamailio (5060) → FreeSWITCH (5080) → RTPEngine → Recording → API Webhook

Outbound Call Flow:
FreeSWITCH → SignalWire Gateway (registered) → PSTN
```

## Key Features

- **Security**: TLS support, topology hiding, DoS protection
- **NAT Traversal**: RTPEngine handles RTP proxying
- **Recording**: Automatic call recording with webhook notifications
- **High Availability Ready**: Can be scaled horizontally
- **Production Ready**: Includes monitoring, logging, and rollback capabilities

## Quick Start Commands

```bash
# 1. Configure environment
cp infra/docker/env.voice.example infra/docker/.env.voice
# Edit .env.voice with your values

# 2. Generate TLS certificates (if using TLS)
cd kamailio/tls
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes \
  -subj "/CN=sbc.yourdomain.com"

# 3. Configure firewall (see sip_firewall_ports.md)
# Open ports: 5060 UDP/TCP, 5061 TCP (TLS), 10000-20000 UDP (RTP)

# 4. Start services
docker compose --env-file infra/docker/.env.voice \
  -f infra/docker/docker-compose.voice.yml up -d --build

# 5. Verify
./scripts/smoke_call_test.sh
docker logs -f sbc-kamailio freeswitch rtpengine
```

## Environment Variables

All environment variables are documented in `infra/docker/env.voice.example`.

**Critical variables:**

- `PUBLIC_IP` - Your server's public IP (required)
- `SIGNALWIRE_*` - SignalWire SIP credentials (required)
- `API_BASE_URL` - Webhook endpoint (required)
- `RTP_START`/`RTP_END` - RTP port range (default: 10000-20000)

## File Structure

```
kamailio/
├── Dockerfile
├── docker-entrypoint.sh
├── kamailio.cfg
├── dispatcher.list
└── tls/
    ├── README.md
    ├── server.crt (generate)
    └── server.key (generate)

rtpengine/
├── Dockerfile
├── docker-entrypoint.sh
└── rtpengine.conf

freeswitch/
├── Dockerfile
├── docker-entrypoint.sh
├── vars.xml
├── autoload_configs/
│   ├── sofia.conf.xml
│   ├── rtp.conf.xml
│   ├── modules.conf.xml
│   ├── xml_cdr.conf.xml
│   └── event_socket.conf.xml
├── dialplan/
│   ├── public.xml
│   └── default.xml
└── scripts/
    └── post_recording_webhook.sh

infra/docker/
├── docker-compose.voice.yml
└── env.voice.example

docs/voice/
├── README.md
├── QUICKSTART.md
├── SETUP_SUMMARY.md (this file)
├── signalwire_trunk_setup.md
├── sip_firewall_ports.md
└── go_live_checklist.md

scripts/
├── smoke_call_test.sh
└── rollback.sh
```

## Next Steps

1. **Read the Quick Start**: `docs/voice/QUICKSTART.md`
2. **Configure SignalWire**: Follow `docs/voice/signalwire_trunk_setup.md`
3. **Set up Firewall**: See `docs/voice/sip_firewall_ports.md`
4. **Production Deployment**: Use `docs/voice/go_live_checklist.md`

## Support

- Check logs: `docker logs <service-name>`
- Run smoke test: `./scripts/smoke_call_test.sh`
- Review troubleshooting in `docs/voice/README.md`
- Consult SignalWire documentation for carrier-specific issues

## Notes

- All configuration files support environment variable substitution via entrypoint scripts
- TLS certificates must be generated separately (see `kamailio/tls/README.md`)
- Recording path must exist and be writable by FreeSWITCH user
- FreeSWITCH uses native `${env:VAR}` syntax for environment variables in XML configs
- Kamailio and RTPEngine use `${VAR}` syntax substituted by entrypoint scripts
