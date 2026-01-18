#!/bin/bash
set -e

# Substitute environment variables in vars.xml if template exists
FS_CONF="/usr/local/freeswitch/conf"
if [ -f "$FS_CONF/vars.xml.template" ]; then
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN} ${SIGNALWIRE_SIP_USERNAME} ${SIGNALWIRE_SIP_PASSWORD} ${SIGNALWIRE_SIP_DOMAIN} ${SIGNALWIRE_OUTBOUND_PROXY} ${FREESWITCH_ESL_PASSWORD}' < "$FS_CONF/vars.xml.template" > "$FS_CONF/vars.xml"
elif [ -f "$FS_CONF/vars.xml" ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN} ${SIGNALWIRE_SIP_USERNAME} ${SIGNALWIRE_SIP_PASSWORD} ${SIGNALWIRE_SIP_DOMAIN} ${SIGNALWIRE_OUTBOUND_PROXY} ${FREESWITCH_ESL_PASSWORD}' < "$FS_CONF/vars.xml" > /tmp/vars.xml.tmp
    mv /tmp/vars.xml.tmp "$FS_CONF/vars.xml"
fi

# Execute the main command
exec "$@"
