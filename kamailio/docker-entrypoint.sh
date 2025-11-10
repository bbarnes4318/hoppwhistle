#!/bin/bash
set -e

# Substitute environment variables in kamailio.cfg if template exists
if [ -f /etc/kamailio/kamailio.cfg.template ]; then
    envsubst '${PUBLIC_IP} ${SBC_DOMAIN}' < /etc/kamailio/kamailio.cfg.template > /etc/kamailio/kamailio.cfg
elif [ -f /etc/kamailio/kamailio.cfg ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP} ${SBC_DOMAIN}' < /etc/kamailio/kamailio.cfg > /tmp/kamailio.cfg.tmp
    mv /tmp/kamailio.cfg.tmp /etc/kamailio/kamailio.cfg
fi

# Substitute environment variables in dispatcher.list if template exists
if [ -f /etc/kamailio/dispatcher.list.template ]; then
    envsubst '${PUBLIC_IP}' < /etc/kamailio/dispatcher.list.template > /etc/kamailio/dispatcher.list
elif [ -f /etc/kamailio/dispatcher.list ]; then
    # If no template, do in-place substitution on the actual file
    envsubst '${PUBLIC_IP}' < /etc/kamailio/dispatcher.list > /tmp/dispatcher.list.tmp
    mv /tmp/dispatcher.list.tmp /etc/kamailio/dispatcher.list
fi

# Execute the main command
exec "$@"

