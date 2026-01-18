#!/bin/sh
set -e

# Substitute environment variables using sed (envsubst may not be available)
FS_CONF="/etc/freeswitch"

# Apply substitution to vars.xml
if [ -f "$FS_CONF/vars.xml.template" ]; then
    cp "$FS_CONF/vars.xml.template" "$FS_CONF/vars.xml"
fi

if [ -f "$FS_CONF/vars.xml" ]; then
    sed -i "s|\${PUBLIC_IP}|${PUBLIC_IP:-auto}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${MEDIA_DOMAIN}|${MEDIA_DOMAIN:-}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_PROXY}|${OUTBOUND_SIP_PROXY:-sip.telnyx.com}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_USER}|${OUTBOUND_SIP_USER:-}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_PASS}|${OUTBOUND_SIP_PASS:-}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_CALLER_ID}|${OUTBOUND_CALLER_ID:-}|g" "$FS_CONF/vars.xml"
    sed -i "s|\${FREESWITCH_ESL_PASSWORD}|${FREESWITCH_ESL_PASSWORD:-ClueCon}|g" "$FS_CONF/vars.xml"
fi

# Execute the main command
exec "$@"

