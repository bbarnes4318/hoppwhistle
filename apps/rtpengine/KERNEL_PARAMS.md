# Kernel Parameters for RTPEngine

RTPEngine requires specific kernel parameters to function properly, especially for high-performance RTP proxying and NAT traversal.

## Required Parameters

### UDP Buffer Sizes

```bash
# Maximum receive buffer size (16MB)
net.core.rmem_max = 16777216

# Maximum send buffer size (16MB)
net.core.wmem_max = 16777216

# Default receive buffer size (64KB)
net.core.rmem_default = 65536

# Default send buffer size (64KB)
net.core.wmem_default = 65536
```

### Network Buffer Sizes

```bash
# UDP memory limits (min, default, max in pages)
# 8388608 pages = ~32GB (adjust based on system)
net.ipv4.udp_mem = 8388608 8388608 8388608
```

### IP Forwarding

```bash
# Enable IP forwarding (required for NAT traversal)
net.ipv4.ip_forward = 1
```

### Connection Tracking

```bash
# Maximum number of connection tracking entries
# Increase for high-volume deployments
net.netfilter.nf_conntrack_max = 1000000
```

### ICMP Redirects (Security)

```bash
# Disable ICMP redirects (security best practice)
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
```

## Setting Parameters

### Temporary (Current Session)

```bash
sysctl -w net.core.rmem_max=16777216
sysctl -w net.core.wmem_max=16777216
sysctl -w net.ipv4.ip_forward=1
```

### Permanent (Persist Across Reboots)

Add to `/etc/sysctl.conf`:

```bash
# RTPEngine kernel parameters
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 65536
net.core.wmem_default = 65536
net.ipv4.udp_mem = 8388608 8388608 8388608
net.ipv4.ip_forward = 1
net.netfilter.nf_conntrack_max = 1000000
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
```

Then apply:

```bash
sysctl -p
```

### Docker

#### Via Docker Run

```bash
docker run --cap-add=NET_ADMIN --cap-add=SYS_ADMIN \
  --sysctl net.core.rmem_max=16777216 \
  --sysctl net.core.wmem_max=16777216 \
  --sysctl net.ipv4.ip_forward=1 \
  callfabric-rtpengine
```

#### Via Docker Compose

```yaml
services:
  rtpengine:
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    sysctls:
      - net.core.rmem_max=16777216
      - net.core.wmem_max=16777216
      - net.ipv4.ip_forward=1
      - net.netfilter.nf_conntrack_max=1000000
```

#### Host System

For Docker containers, some parameters may need to be set on the host:

```bash
# On host system
sudo sysctl -w net.core.rmem_max=16777216
sudo sysctl -w net.core.wmem_max=16777216
sudo sysctl -w net.ipv4.ip_forward=1
```

## Port Ranges

### RTP Media Ports

RTPEngine uses UDP ports 10000-20000 for RTP media by default.

**Firewall Rules:**

```bash
# Allow RTP ports
iptables -A INPUT -p udp --dport 10000:20000 -j ACCEPT
iptables -A OUTPUT -p udp --sport 10000:20000 -j ACCEPT
```

**Docker Port Mapping:**

```yaml
ports:
  - '10000-20000:10000-20000/udp'
```

### Control Port

RTPEngine control protocol uses port 22222 (UDP/TCP).

**Firewall Rules:**

```bash
# Allow control port
iptables -A INPUT -p udp --dport 22222 -j ACCEPT
iptables -A INPUT -p tcp --dport 22222 -j ACCEPT
```

## Verification

### Check Current Values

```bash
# UDP buffer sizes
sysctl net.core.rmem_max
sysctl net.core.wmem_max

# IP forwarding
sysctl net.ipv4.ip_forward

# Connection tracking
sysctl net.netfilter.nf_conntrack_max
```

### Check Port Availability

```bash
# Check if ports are in use
netstat -ulnp | grep -E "10000|22222"

# Check port ranges
ss -ulnp | grep -E "10000|20000"
```

### Test RTPEngine

```bash
# Ping RTPEngine
rtpengine-ctl -t 127.0.0.1:9900 ping

# List sessions
rtpengine-ctl -t 127.0.0.1:9900 list
```

## Performance Tuning

### High-Volume Deployments

For high-volume deployments, increase buffer sizes:

```bash
net.core.rmem_max = 33554432  # 32MB
net.core.wmem_max = 33554432  # 32MB
net.ipv4.udp_mem = 16777216 16777216 16777216  # 64GB
```

### Low-Latency Requirements

For low-latency requirements:

```bash
# Reduce buffer sizes
net.core.rmem_max = 8388608   # 8MB
net.core.wmem_max = 8388608   # 8MB
```

### Connection Tracking

For high concurrent call volumes:

```bash
# Increase connection tracking
net.netfilter.nf_conntrack_max = 2000000
```

## Troubleshooting

### Parameters Not Applied

```bash
# Check if running as root or with sudo
sudo sysctl -w net.ipv4.ip_forward=1

# Check if parameter exists
sysctl -a | grep net.core.rmem_max
```

### Docker Limitations

Some parameters cannot be set from within Docker containers:

```bash
# Set on host system instead
sudo sysctl -w net.ipv4.ip_forward=1
```

### Port Conflicts

```bash
# Check what's using the ports
sudo lsof -i :22222
sudo lsof -i :10000-20000

# Change port ranges in rtpengine.conf if needed
min-port = 20000
max-port = 30000
```
