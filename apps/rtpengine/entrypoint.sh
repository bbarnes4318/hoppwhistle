#!/bin/bash
# RTPEngine entrypoint script

set -e

# Set kernel parameters for RTPEngine
# These are required for proper RTP proxying

# Increase UDP buffer sizes
sysctl -w net.core.rmem_max=16777216 || true
sysctl -w net.core.wmem_max=16777216 || true
sysctl -w net.core.rmem_default=65536 || true
sysctl -w net.core.wmem_default=65536 || true

# Increase network buffer sizes
sysctl -w net.ipv4.udp_mem="8388608 8388608 8388608" || true

# Enable IP forwarding (required for NAT traversal)
sysctl -w net.ipv4.ip_forward=1 || true

# Disable ICMP redirects (security)
sysctl -w net.ipv4.conf.all.send_redirects=0 || true
sysctl -w net.ipv4.conf.default.send_redirects=0 || true

# Enable connection tracking (for NAT)
sysctl -w net.netfilter.nf_conntrack_max=1000000 || true

# Set interface (from environment or auto-detect)
INTERFACE="${RTPENGINE_INTERFACE:-auto}"

# Start RTPEngine with proper arguments
exec rtpengine \
    --config-file=/etc/rtpengine/rtpengine.conf \
    --interface=$INTERFACE \
    --log-stderr \
    --log-level=6 \
    --pidfile=/var/run/rtpengine.pid

