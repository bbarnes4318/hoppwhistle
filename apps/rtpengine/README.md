# RTPEngine Docker Configuration

Production-ready RTPEngine configuration for RTP proxying, NAT traversal, and SRTP support.

## Features

- **RTP Proxying**: Full proxy mode for media handling
- **NAT Traversal**: Automatic NAT detection and handling
- **SRTP Support**: Secure RTP encryption/decryption
- **Multi-Interface**: Supports multiple network interfaces
- **Recording**: Optional media recording support
- **Statistics**: Real-time RTP statistics

## Configuration

### Environment Variables

```bash
# Network interface (auto-detect if not set)
RTPENGINE_INTERFACE=eth0

# Port ranges (configured in rtpengine.conf)
# Default: 10000-20000
```

### Kernel Parameters

RTPEngine requires certain kernel parameters to be set. The entrypoint script sets these automatically:

```bash
# UDP buffer sizes
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.rmem_default=65536
net.core.wmem_default=65536

# Network buffer sizes
net.ipv4.udp_mem=8388608 8388608 8388608

# IP forwarding (for NAT)
net.ipv4.ip_forward=1

# Connection tracking (for NAT)
net.netfilter.nf_conntrack_max=1000000
```

**Note**: In Docker, these may need to be set on the host system or via `--sysctl` flags.

### Port Ranges

- **Control Port**: 22222 (UDP/TCP) - ng protocol for Kamailio communication
- **RTP Media Ports**: 10000-20000 (UDP) - Dynamic allocation for RTP streams

### Multi-Interface Configuration

For multi-interface environments, specify interfaces in `rtpengine.conf`:

```ini
interface = eth0;eth1;eth2
```

Or use `auto` to auto-detect:

```ini
interface = auto
```

## Usage

### Build

```bash
docker build -t callfabric-rtpengine apps/rtpengine
```

### Run with Docker Compose

```bash
cd infra/docker
docker-compose up rtpengine
```

### Run with Kernel Parameters

```bash
docker run --cap-add=NET_ADMIN --cap-add=SYS_ADMIN \
  --sysctl net.core.rmem_max=16777216 \
  --sysctl net.core.wmem_max=16777216 \
  --sysctl net.ipv4.ip_forward=1 \
  -p 22222:22222/udp -p 22222:22222/tcp \
  -p 10000-20000:10000-20000/udp \
  callfabric-rtpengine
```

## Integration with Kamailio

RTPEngine is integrated with Kamailio via the `rtpproxy` module:

```kamailio
modparam("rtpproxy", "rtpproxy_sock", "udp:rtpengine:22222")
```

Kamailio automatically manages RTPEngine sessions for NAT traversal and media proxying.

## Testing

### Check Status

```bash
# Connect to RTPEngine CLI
docker-compose exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 ping

# List active sessions
docker-compose exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 list

# Show statistics
docker-compose exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 stats
```

### Test Media Flow

```bash
# Run test script
docker-compose exec rtpengine /usr/local/bin/test-media-flow.sh

# Or use sipp (see TESTING.md for detailed scenarios)
sipp -sn uac -s 1001 localhost:5060 -sf sipp-scenarios/uac_audio.xml
```

See `TESTING.md` for complete sipp test scripts and scenarios.

## Troubleshooting

### RTPEngine won't start

```bash
# Check logs
docker-compose logs rtpengine

# Check kernel parameters
docker-compose exec rtpengine sysctl net.core.rmem_max
```

### No media flow

1. Check RTPEngine is running: `rtpengine-ctl ping`
2. Check Kamailio can reach RTPEngine: `telnet rtpengine 22222`
3. Check port ranges are open: `netstat -ulnp | grep 10000`
4. Check NAT rules: `iptables -t nat -L`

### High CPU usage

- Reduce `num-threads` if auto-detection is incorrect
- Check `max-sessions` limit
- Review statistics for bottlenecks

## Production Notes

- Set kernel parameters on host system or via Docker sysctls
- Configure proper firewall rules for RTP ports
- Monitor session counts and statistics
- Use SRTP in production for secure media
- Configure recording if needed
- Set appropriate `max-sessions` based on capacity
