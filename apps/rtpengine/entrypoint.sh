#!/bin/bash
set -e

# Signal handler for graceful shutdown
cleanup() {
    echo "Received shutdown signal, stopping RTPEngine..."
    if [ -f /run/rtpengine.pid ]; then
        kill -TERM $(cat /run/rtpengine.pid) 2>/dev/null || true
    fi
    exit 0
}

# Trap SIGTERM and SIGINT for graceful shutdown
trap cleanup SIGTERM SIGINT

# 1. Detect Public IP if not set
if [ -z "$PUBLIC_IP" ]; then
  echo "PUBLIC_IP env var not set. Attempting auto-detection..."
  PUBLIC_IP=$(curl -s ifconfig.me)
  echo "Detected Public IP: $PUBLIC_IP"
fi

# 2. Detect Local Interface IP (eth0 inside Docker)
# We need this to tell rtpengine which interface to listen on locally
LOCAL_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}')

if [ -z "$LOCAL_IP" ]; then
    echo "Could not detect local IP on eth0, defaulting to 0.0.0.0"
    LOCAL_IP="0.0.0.0"
fi

echo "Starting RTPEngine..."
echo "Local IP: $LOCAL_IP"
echo "Advertised Public IP: $PUBLIC_IP"

# 3. Construct Interface Flag
# Syntax: interface_name/local_ip!public_ip
# This binds to local_ip but writes public_ip in SDP packets
INTERFACE_FLAG="internal/$LOCAL_IP!$PUBLIC_IP"

# 4. Run RTPEngine
# --interface: Defines the listening interface and advertised address
# --listen-ng: The control port Kamailio connects to (22222)
# --port-min/max: The UDP port range for audio (must match docker-compose ports)
exec rtpengine \
    --table=0 \
    --interface="$INTERFACE_FLAG" \
    --listen-ng=22222 \
    --pidfile=/run/rtpengine.pid \
    --port-min=10000 \
    --port-max=10100 \
    --foreground \
    --log-level=7
