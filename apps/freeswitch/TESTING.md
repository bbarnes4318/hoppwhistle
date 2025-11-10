# FreeSWITCH Testing Guide

## Quick Start

```bash
# Start FreeSWITCH with docker-compose
cd infra/docker
docker-compose up freeswitch

# Check logs
docker-compose logs -f freeswitch

# Connect to FreeSWITCH CLI
docker-compose exec freeswitch fs_cli
```

## Testing Call Flow

### 1. Start Services

```bash
# Start API and FreeSWITCH
docker-compose up api freeswitch
```

### 2. Test ESL Connection

```bash
# Connect via telnet
telnet localhost 8021

# Authenticate
auth ClueCon

# Check status
status

# Subscribe to events
event plain ALL
```

### 3. Test Trunk Authentication

The dialplan will call `/api/v1/trunks/auth` when an inbound call arrives. Check API logs:

```bash
docker-compose logs -f api | grep "trunk.auth"
```

### 4. Test DID Lookup

The dialplan will call `/api/v1/numbers/lookup` to find the flow for a DID. Check API logs:

```bash
docker-compose logs -f api | grep "did.lookup"
```

### 5. Test Recording Upload

When a call ends, the recording upload script runs. Check logs:

```bash
docker-compose logs freeswitch | grep "upload-recording"
```

## Mock API Endpoints

The API includes mock endpoints for testing:

- `POST /api/v1/trunks/auth` - Trunk authentication (always returns authenticated)
- `POST /api/v1/numbers/lookup` - DID lookup (returns default flow)
- `POST /api/v1/recordings/uploaded` - Recording upload notification

## Expected Log Flow

When a call comes in, you should see:

1. **FreeSWITCH**: "Inbound call from X to Y"
2. **API**: "Trunk authentication request"
3. **FreeSWITCH**: "Trunk authenticated"
4. **FreeSWITCH**: "Looking up DID: Y"
5. **API**: "DID lookup request"
6. **FreeSWITCH**: "Executing flow..."
7. **FreeSWITCH**: "Hanging up call..."
8. **FreeSWITCH**: "Recording uploaded to S3" (if S3 configured)

## Troubleshooting

### FreeSWITCH won't start

```bash
# Check configuration
docker-compose exec freeswitch fs_cli -x "reloadxml"

# Check logs
docker-compose logs freeswitch
```

### API calls failing

```bash
# Check API is running
curl http://localhost:3001/health

# Check network connectivity from FreeSWITCH
docker-compose exec freeswitch curl http://api:3001/health
```

### Recordings not uploading

```bash
# Check S3 credentials
docker-compose exec freeswitch env | grep S3

# Test upload script manually
docker-compose exec freeswitch /usr/local/freeswitch/scripts/upload-recording.sh /recordings/test.wav test-call-123
```

## Health Check

The container includes a health check that verifies FreeSWITCH is running:

```bash
# Check health status
docker-compose ps freeswitch
```

The health check runs `fs_cli -x "status"` every 30 seconds.
