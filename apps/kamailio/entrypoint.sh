#!/bin/bash
set -e

# Configuration paths
CFG_FILE="/etc/kamailio/kamailio.cfg"
DISPATCHER_FILE="/etc/kamailio/dispatcher.list"

# 1. Handle Public IP Substitution
if [ -z "$PUBLIC_IP" ]; then
    echo "PUBLIC_IP not set. Attempting detection..."
    PUBLIC_IP=$(curl -s ifconfig.me || echo "127.0.0.1")
    echo "Detected Public IP: $PUBLIC_IP"
fi

# Replace placeholder in kamailio.cfg so 'advertise PUBLIC_IP' works
sed -i "s/PUBLIC_IP/$PUBLIC_IP/g" "$CFG_FILE"

# 2. Ensure dispatcher list exists for FreeSWITCH connection
if [ ! -f "$DISPATCHER_FILE" ]; then
    touch "$DISPATCHER_FILE"
    # Set 1, destination sip:freeswitch:5060
    echo "1 sip:freeswitch:5060" > "$DISPATCHER_FILE"
fi

echo "Starting Kamailio with Public IP: $PUBLIC_IP"

# Execute Kamailio
exec kamailio -DD -E -f "$CFG_FILE"