# Kamailio SIP Proxy & Load Balancer

Production-ready Kamailio configuration for Session Border Controller (SBC) role with load balancing, security, and NAT traversal.

## Features

- **Load Balancing**: Dispatches to multiple FreeSWITCH nodes
- **Topology Hiding**: Masks internal infrastructure details
- **Anti-Fraud**: Blacklist/whitelist, From header validation
- **Rate Limiting**: Pike module for DoS protection
- **NAT Traversal**: RTPProxy integration, NAT detection
- **mDNS/DoS Guard**: Blocks multicast DNS and flood attacks
- **Per-Tenant Throttling**: Rate limits based on API headers

## Configuration

### Environment Variables

```bash
# FreeSWITCH cluster nodes (comma-separated)
FREESWITCH_NODES=freeswitch:5080,freeswitch2:5080

# RTPEngine
RTPENGINE_SOCK=udp:rtpengine:22222

# Database (optional, for dispatcher persistence)
DB_URL=mysql://user:pass@host/db
```

### Dispatcher Configuration

FreeSWITCH nodes are configured in `dispatcher.list`:

```
1 sip:freeswitch:5080 0 0 "" "FreeSWITCH Node 1"
1 sip:freeswitch2:5080 0 0 "" "FreeSWITCH Node 2"
```

### Per-Tenant Throttling

The SBC checks `X-Tenant-ID` header and applies throttles:

- Throttle limits are set via API (stored in htable)
- Counters reset periodically
- Returns 429 "Too Many Requests" when exceeded

## Usage

### Build

```bash
docker build -t callfabric-kamailio apps/kamailio
```

### Run with Docker Compose

```bash
cd infra/docker
docker-compose up kamailio
```

### Test OPTIONS Forwarding

```bash
# Send OPTIONS to Kamailio
sipsak -s sip:test@kamailio:5060

# Check logs
docker-compose logs kamailio | grep OPTIONS
```

### Check Dispatcher Status

```bash
# Connect to Kamailio control
docker-compose exec kamailio kamctl dispatcher list
```

## Security Features

### Topology Hiding

- Masks Via headers
- Prefixes Call-ID with "CF-"
- Hides internal server details

### Anti-Fraud

- IP blacklist/whitelist
- From header validation
- Rate limiting per IP

### DoS Protection

- Pike module: 16 requests per 2 seconds
- mDNS blocking
- Max forward hop limit

### NAT Traversal

- Automatic NAT detection
- RTPProxy integration
- Contact header fixing

## Load Balancing

Kamailio uses the dispatcher module to:

- Distribute load across FreeSWITCH nodes
- Health check nodes with OPTIONS
- Remove failed nodes automatically
- Round-robin distribution

## Monitoring

### Check Status

```bash
# Kamailio status
docker-compose exec kamailio kamctl stats

# Dispatcher status
docker-compose exec kamailio kamctl dispatcher list

# Pike statistics
docker-compose exec kamailio kamctl pike list
```

### Logs

```bash
# View logs
docker-compose logs -f kamailio

# Filter by type
docker-compose logs kamailio | grep "L_WARN"
docker-compose logs kamailio | grep "L_ERR"
```

## Troubleshooting

### Kamailio won't start

```bash
# Check configuration
docker-compose exec kamailio kamailio -c -f /etc/kamailio/kamailio.cfg

# Check logs
docker-compose logs kamailio
```

### OPTIONS not forwarding

```bash
# Check dispatcher
docker-compose exec kamailio kamctl dispatcher list

# Test connectivity
docker-compose exec kamailio ping freeswitch
```

### Rate limiting too aggressive

Adjust Pike parameters in `kamailio.cfg`:

```
modparam("pike", "reqs_density_per_unit", 16)  # Increase for more requests
```

## Production Notes

- Enable TLS for secure SIP
- Configure database for dispatcher persistence
- Set up proper blacklist/whitelist management
- Monitor Pike statistics for DoS detection
- Configure proper logging levels
- Use health checks for FreeSWITCH nodes
