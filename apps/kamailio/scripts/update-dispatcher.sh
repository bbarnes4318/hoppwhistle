#!/bin/bash
# Script to update dispatcher list from API or environment

set -e

API_URL="${API_URL:-http://api:3001}"
API_KEY="${API_KEY:-}"

# Get FreeSWITCH nodes from API or environment
if [ -n "$API_URL" ] && [ -n "$API_KEY" ]; then
    # Fetch nodes from API
    NODES=$(curl -s -H "X-API-Key: ${API_KEY}" "${API_URL}/api/v1/freeswitch/nodes" 2>/dev/null | jq -r '.nodes[] | "\(.host):\(.port)"' 2>/dev/null || echo "")
fi

# Fallback to environment variable
if [ -z "$NODES" ]; then
    NODES="${FREESWITCH_NODES:-freeswitch:5080}"
fi

# Update dispatcher list
cat > /etc/kamailio/dispatcher.list <<EOF
# FreeSWITCH Dispatcher List
# Auto-generated at $(date)
EOF

setid=1
for node in $(echo $NODES | tr ',' ' '); do
    echo "1 sip:${node} 0 0 \"\" \"FreeSWITCH Node ${setid}\"" >> /etc/kamailio/dispatcher.list
    setid=$((setid + 1))
done

# Reload dispatcher (if Kamailio is running)
if command -v kamctl &> /dev/null; then
    kamctl dispatcher reload 2>/dev/null || true
fi

echo "Dispatcher updated with nodes: $NODES"

