#!/bin/bash
set -e

# Substitute environment variables in vars.xml if template exists
if [ -f /etc/freeswitch/vars.xml.template ]; then
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN}' < /etc/freeswitch/vars.xml.template > /etc/freeswitch/vars.xml
elif [ -f /etc/freeswitch/vars.xml ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP} ${MEDIA_DOMAIN}' < /etc/freeswitch/vars.xml > /tmp/vars.xml.tmp
    mv /tmp/vars.xml.tmp /etc/freeswitch/vars.xml
fi

# Execute the main command
exec "$@"

