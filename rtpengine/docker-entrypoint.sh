#!/bin/bash
set -e

# Substitute environment variables in rtpengine.conf if template exists
if [ -f /etc/rtpengine/rtpengine.conf.template ]; then
    envsubst '${PUBLIC_IP} ${RTP_START} ${RTP_END}' < /etc/rtpengine/rtpengine.conf.template > /etc/rtpengine/rtpengine.conf
elif [ -f /etc/rtpengine/rtpengine.conf ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP} ${RTP_START} ${RTP_END}' < /etc/rtpengine/rtpengine.conf > /tmp/rtpengine.conf.tmp
    mv /tmp/rtpengine.conf.tmp /etc/rtpengine/rtpengine.conf
fi

# Execute the main command
exec "$@"

