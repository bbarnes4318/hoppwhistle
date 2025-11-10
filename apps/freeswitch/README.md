# FreeSWITCH Docker Configuration

Production-ready FreeSWITCH container with modular SIP profiles, dialplan templates, and S3 recording uploads.

## Features

- **Modular SIP Profiles**: Internal and external profiles with TLS/SRTP support
- **XML Dialplan**: Complete dialplan with trunk auth, DID lookup, recording, events, routing, DTMF handling
- **Event Socket (ESL)**: Secure Event Socket Listener for real-time events
- **Recording**: Automatic recording with S3 upload support (Wasabi/Spaces compatible)
- **API Integration**: Full integration with CallFabric API for routing and events

## Configuration

### Environment Variables

```bash
# ESL Configuration
FREESWITCH_ESL_PASSWORD=ClueCon

# API Configuration
API_URL=http://api:3001
API_KEY=demo-key

# S3 Configuration (optional)
S3_ENDPOINT=https://s3.wasabisys.com
S3_BUCKET=recordings
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1

# Recording Configuration
RECORDINGS_FORMAT=wav  # or opus

# TLS/SRTP (optional)
ENABLE_TLS=false
ENABLE_SRTP=optional
TRUNK_AUTH_IP=
```

### SIP Profiles

- **Internal** (`conf/sip_profiles/internal.xml`): Port 5080, for internal phones
- **External** (`conf/sip_profiles/external.xml`): Port 5060, for trunk connections

### Dialplan

The dialplan (`conf/dialplan/default.xml`) handles:

1. **Trunk Authentication**: Validates trunk connections via API
2. **DID Lookup**: Looks up destination number via API
3. **Recording**: Starts media recording (wav or opus)
4. **Events**: Emits call events to API via mod_curl or ESL
5. **Routing**: Executes routing steps from API
6. **DTMF**: Handles DTMF input for IVR
7. **Failover**: Routes to voicemail or hangs up on failure

## Usage

### Build

```bash
docker build -t callfabric-freeswitch apps/freeswitch
```

### Run with Docker Compose

```bash
cd infra/docker
docker-compose up freeswitch
```

### Test ESL Connection

```bash
# Connect via telnet
telnet localhost 8021

# Authenticate
auth ClueCon

# Check status
status
```

### Test Call Flow

1. Register a SIP client to port 5080 (internal profile)
2. Make a call to a DID number
3. Check API logs for events
4. Check recordings directory for files

## Recording Upload

Recordings are automatically uploaded to S3 when calls end. The script:

- Uploads to `s3://bucket/recordings/YYYY/MM/DD/call_id.ext`
- Notifies API about upload completion
- Optionally cleans up local files

## Health Checks

The container includes health checks that verify:

- FreeSWITCH is running
- Event Socket is accessible
- Status command responds

## Ports

- **5060**: External SIP (UDP/TCP)
- **5080**: Internal SIP (UDP/TCP)
- **5061**: TLS SIP (TCP)
- **8021**: Event Socket (TCP)

## Volumes

- `/recordings`: Recording storage
- `/usr/local/freeswitch/conf`: Configuration files

## Troubleshooting

### Check Logs

```bash
docker-compose logs -f freeswitch
```

### Connect to FreeSWITCH CLI

```bash
docker-compose exec freeswitch fs_cli
```

### Test API Connection

```bash
# From inside container
curl http://api:3001/health
```

## Security Notes

- Change `FREESWITCH_ESL_PASSWORD` in production
- Use TLS for external SIP in production
- Restrict trunk authentication IPs
- Use secure S3 credentials
- Enable SRTP for secure media
