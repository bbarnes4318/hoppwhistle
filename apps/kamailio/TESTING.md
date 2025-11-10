# Kamailio Testing Guide

## Quick Start

```bash
# Start Kamailio with docker-compose
cd infra/docker
docker-compose up kamailio

# Check logs
docker-compose logs -f kamailio

# Connect to Kamailio control
docker-compose exec kamailio kamctl
```

## Testing OPTIONS Forwarding

### 1. Start Services

```bash
# Start FreeSWITCH and Kamailio
docker-compose up freeswitch kamailio
```

### 2. Test OPTIONS Request

```bash
# Send OPTIONS to Kamailio (will forward to FreeSWITCH)
sipsak -s sip:test@localhost:5060

# Or use curl
curl -X OPTIONS sip:test@localhost:5060

# Or use sipp
sipp -sn uac -s test localhost:5060 -m 1
```

### 3. Verify Forwarding

Check logs to see OPTIONS being forwarded:

```bash
# Kamailio logs
docker-compose logs kamailio | grep OPTIONS

# FreeSWITCH logs
docker-compose logs freeswitch | grep OPTIONS
```

Expected output:

```
Kamailio: "OPTIONS request from X.X.X.X:5060 to sip:test@..."
Kamailio: "Forwarding OPTIONS to FreeSWITCH: sip:freeswitch:5080"
FreeSWITCH: "OPTIONS request received"
```

## Testing Load Balancing

### 1. Check Dispatcher Status

```bash
docker-compose exec kamailio kamctl dispatcher list
```

Should show FreeSWITCH nodes:

```
ID: 1 (set 1)
        URI: sip:freeswitch:5080
        FLAGS: AP
        PRIORITY: 0
        ATTRS:
        DESCRIPTION: FreeSWITCH Node 1
```

### 2. Test Multiple Requests

```bash
# Send multiple requests and verify load balancing
for i in {1..10}; do
  sipsak -s sip:test@localhost:5060
  sleep 1
done
```

### 3. Check Distribution

```bash
# Check dispatcher statistics
docker-compose exec kamailio kamctl dispatcher stats
```

## Testing Rate Limiting

### 1. Test Pike Protection

```bash
# Send rapid requests (should be blocked after threshold)
for i in {1..20}; do
  sipsak -s sip:test@localhost:5060 &
done
```

Check logs for Pike blocking:

```bash
docker-compose logs kamailio | grep "Pike blocking"
```

### 2. Verify Rate Limit

After exceeding threshold, should see:

```
"Pike blocking OPTIONS from X.X.X.X:5060"
503 Service Unavailable
```

## Testing Topology Hiding

### 1. Send INVITE

```bash
sipsak -s sip:test@localhost:5060 -M INVITE
```

### 2. Check Headers

In FreeSWITCH logs, verify:

- Via header is masked
- Call-ID is prefixed with "CF-"
- Internal server details are hidden

## Testing NAT Traversal

### 1. Test NAT Detection

```bash
# Register from behind NAT
sipsak -U -s sip:user@localhost:5060 -a password -e 3600
```

### 2. Verify Contact Fixing

Check logs for NAT detection:

```bash
docker-compose logs kamailio | grep "NAT detected"
```

## Testing Per-Tenant Throttling

### 1. Send Request with Tenant Header

```bash
sipsak -s sip:test@localhost:5060 \
  -H "X-Tenant-ID: tenant-123"
```

### 2. Exceed Throttle Limit

```bash
# Send multiple requests (should be throttled)
for i in {1..100}; do
  sipsak -s sip:test@localhost:5060 \
    -H "X-Tenant-ID: tenant-123" &
done
```

### 3. Verify Throttling

Check logs:

```bash
docker-compose logs kamailio | grep "throttle limit exceeded"
```

Should see:

```
"Tenant tenant-123 throttle limit exceeded"
429 Too Many Requests
```

## Testing Anti-Fraud

### 1. Test Blacklist

```bash
# Add IP to blacklist (via kamctl or API)
docker-compose exec kamailio kamctl address add 192.168.1.100 32 0 blacklist
```

### 2. Test Request from Blacklisted IP

```bash
# Should be rejected
sipsak -s sip:test@localhost:5060
```

Check logs:

```bash
docker-compose logs kamailio | grep "blacklisted IP"
```

## Health Checks

### 1. Check Kamailio Health

```bash
docker-compose ps kamailio
```

### 2. Test Health Endpoint

```bash
docker-compose exec kamailio kamctl ping
```

Should return: `Pong`

## Troubleshooting

### Kamailio won't start

```bash
# Check configuration syntax
docker-compose exec kamailio kamailio -c -f /etc/kamailio/kamailio.cfg

# Check logs
docker-compose logs kamailio
```

### OPTIONS not forwarding

```bash
# Check dispatcher
docker-compose exec kamailio kamctl dispatcher list

# Test FreeSWITCH connectivity
docker-compose exec kamailio ping freeswitch
docker-compose exec kamailio telnet freeswitch 5080
```

### Rate limiting issues

```bash
# Check Pike statistics
docker-compose exec kamailio kamctl pike list

# Adjust limits in kamailio.cfg if needed
```
