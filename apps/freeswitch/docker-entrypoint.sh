#!/bin/bash
set -e

# Substitute environment variables in vars.xml if template exists
FS_CONF="/etc/freeswitch"
if [ -f "$FS_CONF/vars.xml.template" ]; then
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN} ${OUTBOUND_SIP_PROXY} ${OUTBOUND_SIP_USER} ${OUTBOUND_SIP_PASS} ${OUTBOUND_CALLER_ID} ${FREESWITCH_ESL_PASSWORD}' < "$FS_CONF/vars.xml.template" > "$FS_CONF/vars.xml"
elif [ -f "$FS_CONF/vars.xml" ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN} ${OUTBOUND_SIP_PROXY} ${OUTBOUND_SIP_USER} ${OUTBOUND_SIP_PASS} ${OUTBOUND_CALLER_ID} ${FREESWITCH_ESL_PASSWORD}' < "$FS_CONF/vars.xml" > /tmp/vars.xml.tmp
    mv /tmp/vars.xml.tmp "$FS_CONF/vars.xml"
fi

# Execute the main command
exec "$@"

