#!/bin/bash
set -e

CFG_FILE="/etc/kamailio/kamailio.cfg"
DISPATCHER_FILE="/etc/kamailio/dispatcher.list"

# 1. Handle Public IP
if [ -z "$PUBLIC_IP" ]; then
    echo "PUBLIC_IP not set. Attempting detection..."
    PUBLIC_IP=$(curl -s ifconfig.me || echo "127.0.0.1")
fi
sed -i "s/PUBLIC_IP/$PUBLIC_IP/g" "$CFG_FILE"

# 2. Handle Database URL for Kamailio Modules
# Kamailio expects specific DB module parameters. We use the env var to populate them.
# This is a simplified replacement; for production, use specific modparam replacements.
if [ -n "$DATABASE_URL" ]; then
    # Replace a placeholder if you add one to cfg, or rely on env vars if modules support it.
    # Standard Kamailio docker images often use DBURL env var.
    echo "Database URL detected."
fi

# 3. Ensure dispatcher list
if [ ! -f "$DISPATCHER_FILE" ]; then
    touch "$DISPATCHER_FILE"
    echo "1 sip:freeswitch:5060" > "$DISPATCHER_FILE"
fi

echo "Starting Kamailio with Public IP: $PUBLIC_IP"
exec kamailio -DD -E -f "$CFG_FILE"