#!/bin/bash
set -e

# Substitute environment variables using sed (envsubst may not be available)
FS_CONF="/etc/freeswitch"

# Function to substitute environment variables in a file
substitute_vars() {
    local file="$1"
    if [ -f "$file" ]; then
        sed -i "s|\${PUBLIC_IP}|${PUBLIC_IP:-auto}|g" "$file"
        sed -i "s|\${MEDIA_DOMAIN}|${MEDIA_DOMAIN:-}|g" "$file"
        sed -i "s|\${OUTBOUND_SIP_PROXY}|${OUTBOUND_SIP_PROXY:-sip.telnyx.com}|g" "$file"
        sed -i "s|\${OUTBOUND_SIP_USER}|${OUTBOUND_SIP_USER:-}|g" "$file"
        sed -i "s|\${OUTBOUND_SIP_PASS}|${OUTBOUND_SIP_PASS:-}|g" "$file"
        sed -i "s|\${OUTBOUND_CALLER_ID}|${OUTBOUND_CALLER_ID:-}|g" "$file"
        sed -i "s|\${FREESWITCH_ESL_PASSWORD}|${FREESWITCH_ESL_PASSWORD:-ClueCon}|g" "$file"
    fi
}

# Apply substitution to vars.xml
if [ -f "$FS_CONF/vars.xml.template" ]; then
    cp "$FS_CONF/vars.xml.template" "$FS_CONF/vars.xml"
    substitute_vars "$FS_CONF/vars.xml"
elif [ -f "$FS_CONF/vars.xml" ]; then
    substitute_vars "$FS_CONF/vars.xml"
fi

# Execute the main command
exec "$@"
